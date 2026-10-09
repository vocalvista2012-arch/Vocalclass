import { LiveQuiz } from './classroom-quiz.js';
import { quizAPI } from './quiz-api.js';
import { LessonPresentation } from './classroom-presentation.js';
import { store } from './classroom-store.js';
import { ClassroomPeer } from './classroom-rtc.js';
import { createSignal } from './classroom-signaling.js';
import { ClassroomBoard } from './classroom-board.js';
import { classroomConfig as config } from './classroom-config.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const role = params.get('role') === 'teacher' ? 'teacher' : 'student';
const teacher = role === 'teacher';
const code = (params.get('code') || '').trim();
const root = `liveClassrooms/${code}`;
const peers = new Map(), tiles = new Map();
let liveQuiz=null,presentation=null,permissions={},shareOwner=null;const screenTracks=new Map();
let user, activation, participantId, sessionId, sessionPath, participantPath;
let media = {audio:null,camera:null,screen:null}, iceServers=config.iceServers;
let joined=false, joining=false, stopped=false, busyDevices=false, handUp=false, sharing=false;
let people=[];
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
  if(joined&&!teacher){$('mic').disabled=permissions[user.uid]?.microphone!==true;$('camera').disabled=permissions[user.uid]?.camera===false;$('share').hidden=permissions[user.uid]?.screenShare!==true;}
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
function initiates(remote){return teacher || (remote.role!=='teacher' && participantId.localeCompare(remote.id)<0);}
function signalFor(remote) {
 const initiator=initiates(remote),a=initiator?participantId:remote.id,b=initiator?remote.id:participantId;
 const call=`${sessionPath}/peerCalls/${a}__${b}`;
 return createSignal(store,{call,initiator,fromId:a,toId:b,uid:user.uid,remoteUid:remote.uid});
}
function tileFor(person) {
  if(tiles.has(person.id)) return tiles.get(person.id);
  const card=document.createElement('article');card.className='video-tile'+(person.role==='teacher'?' teacher':'');card.dataset.participant=person.id;
  const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
  const audio=document.createElement('audio');audio.autoplay=true;audio.muted=false;
  const label=document.createElement('div');label.className='tile-label';
  const name=document.createElement('span');name.textContent=person.name+(person.role==='teacher'?' · Teacher':'');
  const state=document.createElement('small');state.textContent='Connecting…';label.append(name,state);card.append(video,audio,label);(person.role==='teacher'?$('teacherVideoDock'):$('videoGrid')).append(card);
  const tile={card,video,audio,state};tiles.set(person.id,tile);return tile;
}
function closePeer(id) {
  peers.get(id)?.close();peers.delete(id);screenTracks.delete(id);
  const tile=tiles.get(id);if(tile){soundBlocked.delete(tile.audio);tile.audio.srcObject=null;tile.video.srcObject=null;tile.card.remove();tiles.delete(id);}
  $('enableSound').hidden=soundBlocked.size===0;
}
function connect(person) {
  if(peers.has(person.id)||stopped) return;
  const tile=tileFor(person);
  const peer=new ClassroomPeer({initiator:initiates(person),media,iceServers,signal:signalFor(person),
    onTrack:(key,track)=>{
      const stream=new MediaStream([track]);
      if(key==='audio'){tile.audio.srcObject=stream;play(tile.audio);}
      if(key==='camera'){tile.video.srcObject=stream;play(tile.video);}
      if(key==='screen'){screenTracks.set(person.id,track);refreshScreen();}
    },
    onState:state=>{tile.state.textContent=state==='connected'?'Connected':state; if(state==='connected')status('Connected to classroom · '+(teacher?'Teacher':'Student')); if(state==='failed')report('A video connection failed. Try Reconnect; this network may require the classroom relay service.');},
    onError:error=>{tile.state.textContent='Connection issue';report(error);}
  });
  peers.set(person.id,peer);
}
let peopleRenderKey="";
function reconcile() {
  if(!joined||stopped)return;
  const active=currentPeople();
  const studentsForVideo=active.filter(p=>p.role==='student'&&!permissions[p.uid]?.removed).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,config.maxStudents);
  const targets=[...active.filter(p=>p.id===roomInfo?.hostId&&p.role==='teacher'),...studentsForVideo].filter(p=>p.id!==participantId);
  for(const id of peers.keys()) if(!targets.some(p=>p.id===id))closePeer(id);
  targets.forEach(connect);
  const students=active.filter(p=>p.role==='student');$('peopleCount').textContent=`${students.length} student${students.length===1?'':'s'}`;
  const renderKey=JSON.stringify(active.map(p=>[p.id,p.uid,p.name,p.role,p.micOn,p.handUp,...['microphone','camera','whiteboard','screenShare','removed'].map(k=>permissions[p.uid]?.[k])]));
  if(renderKey!==peopleRenderKey){peopleRenderKey=renderKey;
  $('people').replaceChildren();
  for(const person of active){const li=document.createElement('li');li.dataset.uid=person.uid;li.textContent=`${person.name}${person.id===participantId?' (You)':''} · ${person.role} · ${person.micOn?'Mic on':'Muted'}${person.handUp?' · Hand raised':''}`;if(person.handUp)li.className='hand-up';if(teacher&&person.role==='student')addPermissionButtons(li,person);$('people').append(li);}
  liveQuiz?.setPeople(active);}
  applyRemotePermissions();
  const host=active.find(p=>p.id===roomInfo?.hostId);refreshScreen();
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
    if(!teacher){const access=await store.read(`${sessionPath}/permissions/${user.uid}`);if(access?.removed)throw Error('The teacher removed you from this lesson.');permissions[user.uid]=access||{};await acquire('audio',false);if(access?.camera===false)await acquire('camera',false);}
    await store.write(participantPath,{...presence(),joinedAt:store.timestamp()});
    joined=true;stopped=false;
    if(!teacher)store.write(`users/${user.uid}/classHistory/${code}_${sessionId}`,{
      code,sessionId,classroomName:activation.classroomName||'Classroom',teacherId:activation.teacherId,lastJoinedAt:store.timestamp()
    }).catch(()=>report(Error('You joined the classroom, but your class history could not be saved. Check dashboard permissions.')));
    $('lobby').hidden=true;$('classroom').hidden=false;
    for(const id of ['boardTools','share','exportAttendance','muteAll'])$(id).hidden=!teacher;
    $('hand').hidden=teacher;$('leave').textContent=teacher?'End class for everyone':'Leave classroom';
    status('Connected to classroom · '+(teacher?'Teacher':'Student'));preview();
    board=new ClassroomBoard($('board'),{editable:teacher,report,pointer:p=>store.write(`${sessionPath}/pointers/${user.uid}`,p).catch(report),save:async strokes=>{ $('boardStatus').textContent='Saving…';const result=await quizAPI.call('saveBoard',{code,sessionId,strokes,revision:board.revision});board.revision=result.revision;$('boardStatus').textContent='Saved to classroom'; }});
    watch(`${sessionPath}/state/board`,d=>board.receive(d?.strokes||[],d?.revision||0));
    list(`${sessionPath}/participants`,docs=>{people=docs;reconcile();});
    watch(root,d=>{roomInfo=d;if(!d?.active||d.sessionId!==sessionId){finishLocal();report(d?.active?'The teacher restarted the class. Return to the join page to reconnect.':'The teacher ended this class.');status('Class ended');}});
    watch(`activationCodes/${code}`,d=>{if(!d?.active){finishLocal();report('This classroom code was disabled.');status('Class disabled');}});
    list(`${sessionPath}/messages`,renderMessages,'at',100);
    liveQuiz=new LiveQuiz({code,sessionId,uid:user.uid,teacher,report});
    presentation=new LessonPresentation({code,sessionId,teacher,store,report});
    if(teacher)$('teacherVideoDock').append(document.querySelector('.video-tile.self'));
    if(!teacher)watch(`${sessionPath}/permissions/${user.uid}`,p=>{permissions[user.uid]=p||{};enforcePermissions().catch(report);});
    list(`${sessionPath}/permissions`,rows=>{permissions=Object.fromEntries(rows.map(p=>[p.id,p]));enforcePermissions().catch(report);reconcile();});
    watch(`${sessionPath}/state/shareOwner`,value=>{shareOwner=value?.uid||null;refreshScreen();if(sharing&&shareOwner!==user.uid)stopSharing().catch(report);});
    list(`${sessionPath}/pointers`,rows=>{const latest=rows.filter(p=>p.id!==user.uid).sort((a,b)=>b.at-a.at)[0];if(latest){board.remotePointer=latest;board.render();setTimeout(()=>board?.render(),1500);}});

    heartbeat=setInterval(()=>publishPresence().catch(report),config.heartbeatMs);
    sweep=setInterval(reconcile,5000);
  }catch(e){
    if(!joined&&createdSession){await store.write(root,{active:false},true).catch(report);await store.write(`activationCodes/${code}`,{live:false},true).catch(report);}
    report(e);
  }finally{joining=false;$('join').disabled=false;}
}
$('join').onclick=safe(join);
for(const [id,key] of [['mic','audio'],['camera','camera']])$(id).onclick=safe(async()=>{if(stopped)return;if(!teacher&&((key==='audio'&&permissions[user.uid]?.microphone!==true)||(key==='camera'&&permissions[user.uid]?.camera===false)))return;await acquire(key,!liveTrack(key)?.enabled);preview();await publishPresence();});
function showPane(which){$('boardPane').hidden=which!=='board';$('screenPane').hidden=which!=='screen';$('boardTools').hidden=(!teacher&&!board?.editable)||which!=='board';$('boardTab').setAttribute('aria-pressed',String(which==='board'));$('screenTab').setAttribute('aria-pressed',String(which==='screen'));board?.render();}
$('boardTab').onclick=()=>showPane('board');$('screenTab').onclick=()=>showPane('screen');
async function stopSharing(){
  const track=media.screen;media.screen=null;sharing=false;
  await Promise.all([...peers.values()].map(p=>p.replace('screen',null)));
  if(track){track.onended=null;track.stop();}
  $('sharedScreen').srcObject=null;$('share').textContent='Share screen';showPane('board');await publishPresence();
}
$('share').onclick=safe(async()=>{
  if(!teacher&&permissions[user.uid]?.screenShare!==true)throw Error('Ask your teacher for screen-sharing permission.');
  if(sharing)return stopSharing();
  if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing is not supported on this browser. Try a desktop browser.');
  let stream;
  try{stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});}catch(e){if(e.name==='NotAllowedError')return;throw e;}
  const track=stream.getVideoTracks()[0];
  try{await quizAPI.call('claimScreen',{code,sessionId});}catch(e){track.stop();throw e;}
  media.screen=track;sharing=true;
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

function addPermissionButtons(li,person){
 const controls=document.createElement('div');controls.className='permission-buttons';const access=permissions[person.uid]||{};
 for(const [key,label,on] of [['microphone',access.microphone?'Mute student':'Allow microphone',!access.microphone],['camera',access.camera===false?'Allow camera':'Disable camera',access.camera===false],['whiteboard',access.whiteboard?'Lock whiteboard':'Allow whiteboard',!access.whiteboard],['screenShare',access.screenShare?'Stop screen share':'Allow screen share',!access.screenShare],['removed','Remove student',true]]){
  const b=document.createElement('button');b.textContent=label;b.onclick=safe(async()=>{if(key==='removed'&&!confirm('Remove '+person.name+' from this lesson?'))return;b.disabled=true;try{await quizAPI.call('setPermission',{code,sessionId,studentUid:person.uid,permission:key,value:on});}finally{b.disabled=false;}});controls.append(b);
 }li.append(controls);
}
$('muteAll').onclick=safe(()=>quizAPI.call('setPermission',{code,sessionId,studentUid:'all',permission:'microphone',value:false}));
async function enforcePermissions(){
 if(!joined||teacher)return;const access=permissions[user.uid]||{};
 if(access.removed){finishLocal();report('The teacher removed you from this lesson.');return;}
 if(access.microphone!==true)await acquire('audio',false);if(access.camera===false)await acquire('camera',false);
 if(access.screenShare!==true&&sharing)await stopSharing();if(board)board.editable=access.whiteboard===true;$('boardTools').hidden=!board?.editable;
 for(const id of ['undo','redo','clearBoard'])$(id).disabled=true;buttonStates();await publishPresence();
}
function applyRemotePermissions(){for(const person of people){if(person.role==='teacher')continue;const access=permissions[person.uid]||{},tile=tiles.get(person.id);if(tile){tile.audio.muted=access.microphone!==true;tile.video.style.visibility=access.camera===false?'hidden':'visible';}}}
function refreshScreen(){
 const owner=people.find(p=>p.uid===shareOwner&&p.sharing&&!permissions[p.uid]?.removed);
 const allowed=owner&&(owner.role==='teacher'||permissions[owner.uid]?.screenShare===true);
 const track=allowed?(owner.id===participantId?media.screen:screenTracks.get(owner.id)):null;
 if(track&&track.readyState==='live'){if($('sharedScreen').srcObject?.getVideoTracks()[0]!==track){$('sharedScreen').srcObject=new MediaStream([track]);play($('sharedScreen'));showPane('screen');}$('screenEmpty').hidden=true;}
 else{$('sharedScreen').srcObject=null;$('screenEmpty').hidden=false;if(!$('screenPane').hidden)showPane('board');}
}
function csv(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
$('exportAttendance').onclick=()=>{const text=[['Name','Role','Joined','Online'],...people.map(p=>[p.name,p.role,new Date(timestampMs(p.joinedAt)).toISOString(),currentPeople().some(x=>x.id===p.id)?'Yes':'No'])].map(row=>row.map(csv).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`vocalclass-${code}-attendance.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function finishLocal(){
  liveQuiz?.destroy();liveQuiz=null;presentation?.destroy();presentation=null;
  stopped=true;joined=false;clearInterval(heartbeat);clearInterval(sweep);
  unsubs.forEach(off=>off());unsubs=[];for(const id of [...peers.keys()])closePeer(id);
  for(const track of Object.values(media))if(track){track.onended=null;track.stop();}
  media={audio:null,camera:null,screen:null};board?.destroy();if(board)board.editable=false;
  document.querySelectorAll('.controls button, #quizControls button, #chatForm button, #boardTools button').forEach(b=>b.disabled=true);
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
  const profile=await store.read(`users/${user.uid}/profiles/${role}`).catch(()=>null);
  $('displayName').value=(profile?.displayName||user.name||role).slice(0,40);
  $('className').textContent=activation.classroomName||'Live classroom';$('join').disabled=false;status(teacher?'Teacher device check':'Student device check');
}
initialize().catch(report);
