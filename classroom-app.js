import { store } from './classroom-store.js';
import { ClassroomPeer } from './classroom-rtc.js';
import { ClassroomBoard } from './classroom-board.js';
import { classroomConfig as config } from './classroom-config.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const role = params.get('role') === 'teacher' ? 'teacher' : 'student';
const teacher = role === 'teacher';
const code = (params.get('code') || '').trim();
const root = `liveClassrooms/${code}`;
const peers = new Map(), tiles = new Map();
let user, activation, participantId, sessionId, sessionPath, participantPath;
let media = {audio:null,camera:null,screen:null}, iceServers=config.iceServers;
let joined=false, joining=false, stopped=false, busyDevices=false, handUp=false, sharing=false;
let people=[], activity=null, responses=[], answerKey=null, answered=new Set();
let unsubs=[], heartbeat=null, sweep=null, board=null, roomInfo=null, soundBlocked=new Set();
function report(error) {
  const message = error?.code === 'permission-denied' ? 'Classroom access was denied. Ask your administrator to check the classroom database permissions.' : error?.message || String(error);
  $('notice').textContent=message; $('notice').hidden=false;
}
function safe(action) { return async (...args) => { try { await action(...args); } catch(e) { report(e); } }; }
function status(message) { $('roomStatus').textContent=message; }
function liveTrack(key) { const t=media[key]; return t?.readyState==='live' ? t : null; }
function cameraStream() { return new MediaStream(liveTrack('camera') ? [media.camera] : []); }
function buttonStates() {
  for(const [id,key,label] of [['mic','audio','Microphone'],['camera','camera','Camera']]){
    const enabled=!!liveTrack(key)?.enabled;
    $(id).textContent=label+(enabled?' on':' off'); $(id).setAttribute('aria-pressed',String(enabled));
  }
  $('selfStatus').textContent=liveTrack('camera')?.enabled?'Camera on':'Camera off';
}
async function play(element) {
  try { await element.play(); soundBlocked.delete(element); }
  catch { if (!element.muted) soundBlocked.add(element); }
  $('enableSound').hidden=soundBlocked.size===0;
}
$('enableSound').onclick=safe(async()=>{await Promise.all([...soundBlocked].map(play));});
function preview() {
  $('preview').srcObject=cameraStream(); $('selfVideo').srcObject=cameraStream();
  play($('preview')); play($('selfVideo')); buttonStates();
}
async function acquire(key, enabled) {
  const prior=liveTrack(key);
  if (!enabled) { if(prior) prior.enabled=false; return; }
  if(prior){prior.enabled=true;return;}
  if(!navigator.mediaDevices?.getUserMedia) throw Error('Camera and microphone require a supported browser on HTTPS.');
  const constraints=key==='audio'?{audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}:{video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:20,max:24},facingMode:'user'}};
  const stream=await navigator.mediaDevices.getUserMedia(constraints);
  const track=stream.getTracks()[0]; media[key]=track;
  track.addEventListener('ended',()=>{buttonStates();if(joined)publishPresence().catch(report);report(`${key==='audio'?'Microphone':'Camera'} disconnected. Use its button to reconnect it.`);});
  await Promise.all([...peers.values()].map(p=>p.replace(key,track)));
}
async function devices() {
  if(busyDevices) return;
  busyDevices=true; $('checkDevices').disabled=true;
  try {
    const errors=[];
    for(const [key,id] of [['audio','wantMic'],['camera','wantCamera']]){
      try { await acquire(key,$(id).checked); }
      catch(e){errors.push(`${key==='audio'?'Microphone':'Camera'}: ${e.name==='NotAllowedError'?'permission denied — allow access in browser settings':e.message}`);}
    }
    preview();
    $('deviceStatus').textContent=errors.length?errors.join('. '):'Devices checked. You are ready to join.';
    if(errors.length) report(errors.join('. ') + '. You can still join and receive the lesson.');
  } finally {busyDevices=false;$('checkDevices').disabled=false;}
}
$('checkDevices').onclick=safe(devices);
$('wantMic').checked=teacher;
$('backLink').href=teacher?'teacher.html':'student.html';
$('join').textContent=teacher?'Start classroom':'Join classroom';
$('displayName').value=teacher?'Teacher':sessionStorage.getItem('vocalclassStudentName')||params.get('name')||'Student';
$('classCode').textContent=code;
$('copyCode').onclick=safe(async()=>{await navigator.clipboard.writeText(code);status('Class code copied.');});

async function loadIce() {
  if(!config.iceServerEndpoint) return config.iceServers;
  const url=new URL(config.iceServerEndpoint,location.href);
  if(url.protocol!=='https:') throw Error('The call relay service must use HTTPS.');
  const result=await fetch(url,{headers:{Authorization:`Bearer ${await user.token()}`},signal:AbortSignal.timeout(10000)});
  if(!result.ok) throw Error('The call relay service is unavailable. Please retry.');
  const data=await result.json();
  if(!Array.isArray(data.iceServers)||!data.iceServers.length) throw Error('The call relay service returned an invalid configuration.');
  return data.iceServers;
}
function watch(path,next) { const off=store.watch(path,next,report);unsubs.push(off);return off; }
function list(path,next,order=null,max=200) { const off=store.list(path,next,report,order,max);unsubs.push(off);return off; }
function presence() {
  return {uid:user.uid,name:$('displayName').value.trim().slice(0,40)||role,role,online:true,
    cameraOn:!!liveTrack('camera')?.enabled,micOn:!!liveTrack('audio')?.enabled,handUp,sharing,
    lastSeen:store.timestamp()};
}
function publishPresence() { return participantPath?store.write(participantPath,presence(),true):Promise.resolve(); }
function timestampMs(t) {return typeof t==='number'?t:t?.toMillis?.()||((t?.seconds||0)*1000);}
function currentPeople() {return people.filter(p=>p.online!==false&&(!p.lastSeen||Date.now()-timestampMs(p.lastSeen)<config.staleAfterMs));}
function signalFor(remote) {
  const guest=teacher?remote.id:participantId;
  const call=`${sessionPath}/calls/${guest}`;
  const side=teacher?'teacher':'student', other=teacher?'student':'teacher';
  const ready=teacher?store.write(call,{teacherUid:user.uid,studentUid:remote.uid},true):Promise.resolve();
  return {
    description: async message=>{await ready;return store.write(call,{[side]:message,teacherUid:teacher?user.uid:remote.uid,studentUid:teacher?remote.uid:user.uid},true);},
    candidate: async message=>{await ready;return store.add(`${call}/${side}Candidates`,message);},
    watchDescription: (next,error)=>store.watch(call,d=>{if(d?.[other])next(d[other]);},error),
    watchCandidates: (next,error)=>store.list(`${call}/${other}Candidates`,docs=>docs.forEach(d=>next(d.id,d)),error)
  };
}
function tileFor(person) {
  if(tiles.has(person.id)) return tiles.get(person.id);
  const card=document.createElement('article');card.className='video-tile'+(person.role==='teacher'?' teacher':'');card.dataset.participant=person.id;
  const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
  const audio=document.createElement('audio');audio.autoplay=true;audio.muted=false;
  const label=document.createElement('div');label.className='tile-label';
  const name=document.createElement('span');name.textContent=person.name+(person.role==='teacher'?' · Teacher':'');
  const state=document.createElement('small');state.textContent='Connecting…';label.append(name,state);card.append(video,audio,label);$('videoGrid').append(card);
  const tile={card,video,audio,state};tiles.set(person.id,tile);return tile;
}
function closePeer(id) {
  peers.get(id)?.close();peers.delete(id);
  const tile=tiles.get(id);if(tile){soundBlocked.delete(tile.audio);tile.audio.srcObject=null;tile.video.srcObject=null;tile.card.remove();tiles.delete(id);}
  $('enableSound').hidden=soundBlocked.size===0;
}
function connect(person) {
  if(peers.has(person.id)||stopped) return;
  const tile=tileFor(person);
  const peer=new ClassroomPeer({initiator:teacher,media,iceServers,signal:signalFor(person),
    onTrack:(key,track)=>{
      const stream=new MediaStream([track]);
      if(key==='audio'){tile.audio.srcObject=stream;play(tile.audio);}
      if(key==='camera'){tile.video.srcObject=stream;play(tile.video);}
      if(key==='screen'&&!teacher){$('sharedScreen').srcObject=stream;play($('sharedScreen'));}
    },
    onState:state=>{tile.state.textContent=state==='connected'?'Connected':state; if(state==='connected')status('Connected to classroom · '+(teacher?'Teacher':'Student')); if(state==='failed')report('A video connection failed. Try Reconnect; this network may require the classroom relay service.');},
    onError:error=>{tile.state.textContent='Connection issue';report(error);}
  });
  peers.set(person.id,peer);
}
function reconcile() {
  if(!joined||stopped)return;
  const active=currentPeople();
  const targets=teacher?active.filter(p=>p.role==='student').slice(0,config.maxStudents):active.filter(p=>p.id===roomInfo?.hostId&&p.role==='teacher');
  for(const id of peers.keys()) if(!targets.some(p=>p.id===id))closePeer(id);
  targets.forEach(connect);
  const students=active.filter(p=>p.role==='student');$('peopleCount').textContent=`${students.length} student${students.length===1?'':'s'}`;
  $('people').replaceChildren();
  for(const person of active){const li=document.createElement('li');li.textContent=`${person.name}${person.id===participantId?' (You)':''} · ${person.role} · ${person.micOn?'Mic on':'Muted'}${person.handUp?' · Hand raised':''}`;if(person.handUp)li.className='hand-up';$('people').append(li);}
  const host=active.find(p=>p.id===roomInfo?.hostId);
  $('screenEmpty').hidden=!!host?.sharing;
  if(!teacher && host?.sharing && !sharing){showPane('screen');sharing=true;}
  if(!teacher && !host?.sharing && sharing){showPane('board');sharing=false;}
  $('connectionHint').textContent=teacher?`Students connect directly to you. ${config.maxStudents} video seats supported.`:host?'Teacher video and sound appear here. Your microphone starts muted.':'Waiting for the teacher to connect…';
}
async function join() {
  if(joining||joined)return;
  joining=true;$('join').disabled=true;
  let createdSession=false;
  try {
    await devices();
    iceServers=await loadIce();
    activation=await store.read(`activationCodes/${code}`);
    if(!activation?.active)throw Error('This classroom is disabled.');
    participantId=user.uid+'-'+crypto.randomUUID();
    if(teacher){
      if(activation.teacherId!==user.uid)throw Error('This classroom belongs to another teacher.');
      const existing=await store.read(root);
      if(existing?.active&&existing.sessionId){
        const host=await store.read(`${root}/sessions/${existing.sessionId}/participants/${existing.hostId}`);
        if(host?.online&&Date.now()-timestampMs(host.lastSeen)<config.staleAfterMs)throw Error('Your classroom is already open in another tab. End that session before starting here.');
      }
      sessionId=crypto.randomUUID();sessionPath=`${root}/sessions/${sessionId}`;
      await store.write(sessionPath,{teacherUid:user.uid,hostId:participantId,createdAt:store.timestamp()});
      roomInfo={active:true,teacherId:user.uid,hostId:participantId,sessionId,startedAt:store.timestamp()};
      await store.write(root,roomInfo,true);
      createdSession=true;
      await store.write(`activationCodes/${code}`,{live:true},true);
    }else{
      roomInfo=await store.read(root);
      if(!roomInfo?.active||!roomInfo.sessionId)throw Error('The teacher has not started this classroom yet. Please retry in a moment.');
      if(roomInfo.teacherId!==activation.teacherId)throw Error('Classroom teacher could not be verified.');
      sessionId=roomInfo.sessionId;sessionPath=`${root}/sessions/${sessionId}`;
      const host=await store.read(`${sessionPath}/participants/${roomInfo.hostId}`);
      if(!host?.online||Date.now()-timestampMs(host.lastSeen)>=config.staleAfterMs)throw Error('The teacher is reconnecting. Please try joining again in a moment.');
    }
    participantPath=`${sessionPath}/participants/${participantId}`;
    await store.write(participantPath,{...presence(),joinedAt:store.timestamp()});
    joined=true;stopped=false;
    $('lobby').hidden=true;$('classroom').hidden=false;
    for(const id of ['boardTools','share','activityForm','exportAttendance'])$(id).hidden=!teacher;
    $('hand').hidden=teacher;$('leave').textContent=teacher?'End class for everyone':'Leave classroom';
    status('Connected to classroom · '+(teacher?'Teacher':'Student'));preview();
    board=new ClassroomBoard($('board'),{editable:teacher,report,save:async strokes=>{ $('boardStatus').textContent='Saving…';await store.write(`${sessionPath}/state/board`,{strokes,updatedAt:store.timestamp()});$('boardStatus').textContent='Saved to classroom'; }});
    watch(`${sessionPath}/state/board`,d=>board.receive(d?.strokes||[]));
    list(`${sessionPath}/participants`,docs=>{people=docs;reconcile();});
    watch(root,d=>{roomInfo=d;if(!d?.active||d.sessionId!==sessionId){finishLocal();report(d?.active?'The teacher restarted the class. Return to the join page to reconnect.':'The teacher ended this class.');status('Class ended');}});
    watch(`activationCodes/${code}`,d=>{if(!d?.active){finishLocal();report('This classroom code was disabled.');status('Class disabled');}});
    list(`${sessionPath}/messages`,renderMessages,'at',100);
    watch(`${sessionPath}/state/activity`,renderActivity);
    list(`${sessionPath}/answers`,docs=>{responses=docs;renderResults();});
    heartbeat=setInterval(()=>publishPresence().catch(report),config.heartbeatMs);
    sweep=setInterval(reconcile,5000);
  }catch(e){
    if(!joined&&createdSession){await store.write(root,{active:false},true).catch(report);await store.write(`activationCodes/${code}`,{live:false},true).catch(report);}
    report(e);
  }finally{joining=false;$('join').disabled=false;}
}
$('join').onclick=safe(join);
for(const [id,key] of [['mic','audio'],['camera','camera']])$(id).onclick=safe(async()=>{if(stopped)return;await acquire(key,!liveTrack(key)?.enabled);preview();await publishPresence();});
function showPane(which){$('boardPane').hidden=which!=='board';$('screenPane').hidden=which!=='screen';$('boardTools').hidden=!teacher||which!=='board';$('boardTab').setAttribute('aria-pressed',String(which==='board'));$('screenTab').setAttribute('aria-pressed',String(which==='screen'));board?.render();}
$('boardTab').onclick=()=>showPane('board');$('screenTab').onclick=()=>showPane('screen');
async function stopSharing(){
  const track=media.screen;media.screen=null;sharing=false;
  await Promise.all([...peers.values()].map(p=>p.replace('screen',null)));
  if(track){track.onended=null;track.stop();}
  $('sharedScreen').srcObject=null;$('share').textContent='Share screen / PDF';showPane('board');await publishPresence();
}
$('share').onclick=safe(async()=>{
  if(sharing)return stopSharing();
  if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing is not supported on this browser. Try a desktop browser.');
  let stream;
  try{stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});}catch(e){if(e.name==='NotAllowedError')return;throw e;}
  const track=stream.getVideoTracks()[0];media.screen=track;sharing=true;
  track.onended=safe(stopSharing);
  await Promise.all([...peers.values()].map(p=>p.replace('screen',track)));
  $('sharedScreen').srcObject=new MediaStream([track]);play($('sharedScreen'));$('share').textContent='Stop sharing';showPane('screen');await publishPresence();
});
$('hand').onclick=safe(async()=>{handUp=!handUp;$('hand').textContent=handUp?'Lower hand':'Raise hand';$('hand').setAttribute('aria-pressed',String(handUp));await publishPresence();});
$('reconnect').onclick=safe(async()=>{
  if(stopped){location.reload();return;}
  if(teacher)await Promise.all([...peers.values()].map(p=>p.restart()));
  else{ // New participant identity produces fresh signaling; no stale offers or ICE.
    await store.write(participantPath,{online:false,lastSeen:store.timestamp()},true);
    for(const id of [...peers.keys()])closePeer(id);
    participantId=user.uid+'-'+crypto.randomUUID();participantPath=`${sessionPath}/participants/${participantId}`;
    await store.write(participantPath,{...presence(),joinedAt:store.timestamp()});reconcile();
  }
  status('Reconnecting to classroom…');
});
$('fullscreen').onclick=safe(async()=>{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.stage').requestFullscreen();});
$('tool').onchange=()=>{if(board)board.tool=$('tool').value;};$('color').oninput=()=>{if(board)board.color=$('color').value;};$('size').oninput=()=>{if(board)board.size=+$('size').value;};
$('undo').onclick=()=>board?.undo();$('redo').onclick=()=>board?.redo();$('clearBoard').onclick=()=>{if(confirm('Clear the shared whiteboard for everyone?'))board?.clear();};$('downloadBoard').onclick=()=>board?.download();
function renderMessages(docs){
  const area=$('messages');const nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<60;
  area.replaceChildren();for(const m of docs){const el=document.createElement('div');el.className='message';const author=document.createElement('strong');author.textContent=m.name||'Participant';el.append(author,document.createTextNode(m.text||''));area.append(el);}
  if(nearBottom)area.scrollTop=area.scrollHeight;
}
$('chatForm').onsubmit=safe(async e=>{e.preventDefault();const input=$('chatInput'),text=input.value.trim();if(!text||!joined||stopped)return;const button=e.currentTarget.querySelector('button');button.disabled=true;try{await store.add(`${sessionPath}/messages`,{uid:user.uid,name:$('displayName').value.trim().slice(0,40),text:text.slice(0,500),at:store.timestamp()});input.value='';}finally{button.disabled=false;}});
$('activityType').onchange=()=>{$('correctLabel').hidden=$('activityType').value==='poll';};$('correctLabel').hidden=true;
$('activityForm').onsubmit=safe(async e=>{
  e.preventDefault();if(stopped)return;
  const id=crypto.randomUUID();const next={id,type:$('activityType').value,question:$('question').value.trim(),options:[$('optionA').value.trim(),$('optionB').value.trim()],open:true,startedAt:store.timestamp()};
  if(!next.question||next.options.some(x=>!x))return;
  answerKey=next.type==='quiz'?+$('correct').value:null;
  await store.write(`${sessionPath}/state/activity`,next);$('results').textContent='';
});
function renderActivity(data){
  activity=data;$('activity').replaceChildren();$('closeActivity').hidden=!teacher||!data?.open;
  if(!data){$('activityStatus').textContent='No activity yet';return;}
  $('activityStatus').textContent=data.open?'Open for answers':'Closed';
  const question=document.createElement('p');question.textContent=data.question;$('activity').append(question);
  data.options.forEach((option,i)=>{const button=document.createElement('button');button.textContent=String.fromCharCode(65+i)+'. '+option;button.disabled=teacher||!data.open||answered.has(data.id);button.onclick=safe(async()=>{
    $('activity').querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await store.write(`${sessionPath}/answers/${data.id}_${user.uid}`,{uid:user.uid,activityId:data.id,name:$('displayName').value.trim().slice(0,40),choice:i,at:store.timestamp()});answered.add(data.id);$('activityStatus').textContent='Answer submitted';}
    catch(e){renderActivity(activity);throw e;}
  });$('activity').append(button);});renderResults();
}
function renderResults(){
  const area=$('results');area.replaceChildren();if(!activity)return;
  const rows=responses.filter(r=>r.activityId===activity.id);
  if(rows.some(r=>r.uid===user.uid)){answered.add(activity.id);if(!teacher)$('activity').querySelectorAll('button').forEach(b=>b.disabled=true);}
  if(activity.open&&!teacher)return;
  const counts=activity.options.map((_,i)=>rows.filter(r=>r.choice===i).length);
  area.textContent=`${rows.length} response${rows.length===1?'':'s'} · A: ${counts[0]} · B: ${counts[1]}`;
  if(!activity.open&&activity.type==='quiz'&&Number.isInteger(activity.correct)){
    const result=document.createElement('p');result.textContent='Correct answer: '+activity.options[activity.correct];area.append(result);
    const correct=rows.filter(r=>r.choice===activity.correct).sort((a,b)=>timestampMs(a.at)-timestampMs(b.at));
    correct.slice(0,5).forEach((r,i)=>{const line=document.createElement('div');line.textContent=`${i+1}. ${r.name} · Correct`;area.append(line);});
  }
}
$('closeActivity').onclick=safe(async()=>{if(activity)await store.write(`${sessionPath}/state/activity`,{open:false,...(answerKey!==null?{correct:answerKey}:{})},true);});
function csv(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
$('exportAttendance').onclick=()=>{const text=[['Name','Role','Joined','Online'],...people.map(p=>[p.name,p.role,new Date(timestampMs(p.joinedAt)).toISOString(),currentPeople().some(x=>x.id===p.id)?'Yes':'No'])].map(row=>row.map(csv).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`vocalclass-${code}-attendance.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function finishLocal(){
  stopped=true;joined=false;clearInterval(heartbeat);clearInterval(sweep);
  unsubs.forEach(off=>off());unsubs=[];for(const id of [...peers.keys()])closePeer(id);
  for(const track of Object.values(media))if(track){track.onended=null;track.stop();}
  media={audio:null,camera:null,screen:null};board?.destroy();if(board)board.editable=false;
  document.querySelectorAll('.controls button, #activityForm button, #chatForm button, #boardTools button').forEach(b=>b.disabled=true);
  $('leave').disabled=false;$('leave').textContent='Return to dashboard';$('enableSound').hidden=true;
}
$('leave').onclick=safe(async()=>{
  if(stopped){location.href=teacher?'teacher.html':'student.html';return;}
  if(teacher&&!confirm('End this class for everyone?'))return;
  try{
    if(teacher){await store.write(root,{active:false,endedAt:store.timestamp()},true);await store.write(`activationCodes/${code}`,{live:false},true);}
    if(participantPath)await store.write(participantPath,{online:false,lastSeen:store.timestamp()},true);
  }finally{finishLocal();}
  location.href=teacher?'teacher.html':'student.html';
});
window.addEventListener('pagehide',()=>{if(participantPath)store.write(participantPath,{online:false,lastSeen:store.timestamp()},true).catch(()=>{});finishLocal();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
async function initialize(){
  if(!/^\d{6}$/.test(code))throw Error('Enter a valid six-digit classroom code from the join page.');
  user=await store.authenticate(role);activation=await store.read(`activationCodes/${code}`);
  if(!activation?.active)throw Error('This classroom code is invalid or disabled.');
  if(teacher&&activation.teacherId!==user.uid)throw Error('This classroom belongs to another teacher.');
  $('className').textContent=activation.classroomName||'Live classroom';$('join').disabled=false;status(teacher?'Teacher device check':'Student device check');
}
initialize().catch(report);
