const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const db=new Map([['activationCodes/123456',{active:true,live:false,teacherId:'teacher-test',classroomName:'Science · The live learning lab'}]]);
const services=require('./mock-classroom-services.cjs');
db.set('users/teacher-test/quizzes/example',{title:'Solar system',questions:[]});
const errors=[];
const server=require('./server.cjs');
const artifacts=require('node:path').join(__dirname,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
const mock=`export const store={
 authenticate:async(role)=>({uid:window.TEST_UID,name:role,token:async()=>'test-token'}),
 timestamp:()=>Date.now(),
 read:path=>window.testDB('read',path),
 write:(path,data,merge=false)=>window.testDB('write',path,data,merge),
 add:(path,data)=>window.testDB('add',path,data),
 remove:path=>window.testDB('remove',path),
 watch:(path,next,error)=>subscribe('read',path,next,error),
 list:(path,next,error,order=null,max=200)=>subscribe('list',path,next,error,order,max)
};
function subscribe(op,path,next,error,order,max){let active=true,last,timer;const poll=async()=>{try{const value=await window.testDB(op,path,null,false,order,max);const json=JSON.stringify(value);if(active&&json!==last){last=json;next(value);}}catch(e){if(active)error(e);}finally{if(active)timer=setTimeout(poll,250);}};poll();return()=>{active=false;clearTimeout(timer);};}
`;
function access(op,path,data,merge,order,max){
 const parts=path.split('/');assert.equal(parts.length%2,['add','list'].includes(op)?1:0,'Invalid Firestore path: '+path);
 if(op==='read')return db.get(path)||null;
 if(op==='remove'){db.delete(path);return;}
 if(op==='write'){db.set(path,merge?{...db.get(path),...data}:data);return;}
 if(op==='add'){db.set(path+'/'+crypto.randomUUID(),data);return;}
 if(op==='list'){let rows=[...db.entries()].filter(([p])=>p.startsWith(path+'/')&&p.split('/').length===parts.length+1).map(([p,d])=>({id:p.split('/').at(-1),...d}));if(order)rows.sort((a,b)=>(a[order]||0)-(b[order]||0));return order?rows.slice(-max):rows;}
}
async function until(fn,message,timeout=18000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out: '+message);}
async function received(page,kind){return page.evaluate(async kind=>{let packets=0;for(const pc of window.testPeers){if(pc.connectionState==='closed')continue;for(const r of (await pc.getStats()).values())if(r.type==='inbound-rtp'&&r.kind===kind)packets+=r.packetsReceived||0;}return packets;},kind);}
let activeBrowser;const testDeadline=setTimeout(()=>{console.error('Classroom browser test exceeded 150 seconds');activeBrowser?.close().finally(()=>process.exit(1));},150000);
(async()=>{
 console.log('Starting classroom regression');
 await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 activeBrowser=browser;console.log('Classroom browser ready');
 try {
 const pages=[];
 async function create(role,uid,denyMedia=false){
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['camera','microphone']});
  await context.route('**/classroom-store.js',route=>route.fulfill({contentType:'text/javascript',body:mock}));
  await context.route('**/quiz-api.js',route=>route.fulfill({contentType:'text/javascript',body:services.client}));
  await context.route('**/classroom-presentation.js',route=>route.fulfill({contentType:'text/javascript',body:'export class LessonPresentation{destroy(){}}'}));
  await context.exposeBinding('quizCall',(_,name,data)=>services.bind(db,uid)(name,data));
  await context.route('**/classroom-config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const classroomConfig={iceServers:[],iceServerEndpoint:null,maxStudents:8,heartbeatMs:1000,staleAfterMs:60000};'}));
  await context.exposeBinding('testDB',(_, ...args)=>access(...args));
  await context.addInitScript(({uid,denyMedia})=>{
    window.TEST_UID=uid;window.testPeers=[];
    if(denyMedia)navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};
    const originalPlay=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){if(this.tagName==='AUDIO'&&!window.audioUnlocked)return Promise.reject(new DOMException('Autoplay blocked','NotAllowedError'));return originalPlay.call(this);};
    document.addEventListener('click',e=>{if(e.target.id==='enableSound')window.audioUnlocked=true;},true);
    const Native=RTCPeerConnection;window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);window.testPeers.push(this);}};
    // A synthetic screen exercises the real separate RTP sender without an OS chooser.
    navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');let n=0;setInterval(()=>{ctx.fillStyle=n++%2?'#ffeeaa':'#aaffee';ctx.fillRect(0,0,640,360);ctx.fillStyle='black';ctx.font='40px Arial';ctx.fillText('Shared lesson '+n,20,100);},80);return c.captureStream(15);};
  },{uid,denyMedia});
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')console.log('Browser:',m.text());});
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('http://127.0.0.1:4175/classroom-room.html?role='+role+'&code=123456');
  await page.locator('#join').waitFor({state:'visible'});
  await until(()=>page.locator('#join').isEnabled(),'lobby initialized');
  return page;
 }
 const teacher=await create('teacher','teacher-test');console.log('Teacher lobby ready');
 await teacher.locator('#join').click();await teacher.locator('#classroom').waitFor({state:'visible'});
 console.log('Teacher joined');const student=await create('student','student-test');console.log('Student lobby ready');
 await student.locator('#displayName').fill('Maya');await student.locator('#join').click();await student.locator('#classroom').waitFor({state:'visible'});
 await until(()=>[...db.keys()].some(p=>p.startsWith('users/student-test/classHistory/')),'student class history recorded');
 assert.equal([...db.entries()].find(([p])=>p.startsWith('users/student-test/classHistory/'))[1].teacherId,'teacher-test');
 await until(async()=>await received(student,'audio')>20&&await received(student,'video')>10,'teacher audio and video reach student');
 try { await until(async()=>await received(teacher,'video')>10,'student video reaches teacher'); }
 catch(e) {
  for(const p of [teacher,student]) {
   console.log(JSON.stringify(await p.evaluate(()=>window.testPeers.map(pc=>({state:pc.connectionState,transceivers:pc.getTransceivers().map(t=>({mid:t.mid,dir:t.currentDirection,track:t.sender.track?.kind,enabled:t.sender.track?.enabled,ready:t.sender.track?.readyState})),local:pc.localDescription?.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g),remote:pc.remoteDescription?.sdp.match(/a=(sendrecv|sendonly|recvonly|inactive)/g)})))));
   console.log(await p.locator('#deviceStatus').innerText());
  }
  throw e;
 }
 assert(await student.locator('#mic').isDisabled());
 await teacher.getByRole('button',{name:'Allow microphone',exact:true}).first().click();await until(()=>student.locator('#mic').isEnabled(),'teacher grants microphone');
 await student.locator('#mic').click();
 await until(async()=>await received(teacher,'audio')>20,'student audio reaches teacher');
 console.log('PASS real WebRTC: two-way audio/video packets received');
 await student.locator('#enableSound').click();
 await until(()=>student.locator('#enableSound').isHidden(),'audio playback recovery');
 const audio=await student.locator('.video-tile.teacher audio').evaluate(e=>({muted:e.muted,paused:e.paused,tracks:e.srcObject.getAudioTracks().length}));
 assert.equal(audio.muted,false);assert.equal(audio.paused,false);assert.equal(audio.tracks,1);
 await student.locator('#hand').click();await until(async()=>await teacher.locator('#people').innerText().then(s=>s.includes('Hand raised')),'hand reaches teacher');
 await student.locator('#chatInput').fill('<img src=x onerror=alert(1)> Hello teacher');await student.locator('#chatForm button').click();
 await until(async()=>await teacher.locator('#messages').innerText().then(s=>s.includes('Hello teacher')),'chat');assert.equal(await teacher.locator('#messages img').count(),0);
 const canvas=teacher.locator('#board');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 await teacher.mouse.move(box.x+80,box.y+70);await teacher.mouse.down();await teacher.mouse.move(box.x+220,box.y+150,{steps:12});await teacher.mouse.up();
 const boardPath=()=>[...db.keys()].find(p=>p.endsWith('/state/board'));
 await until(()=>db.get(boardPath())?.strokes.length===1,'saved stroke');
 await teacher.locator('#undo').click();await until(()=>db.get(boardPath())?.strokes.length===0,'synced undo');
 await teacher.locator('#redo').click();await until(()=>db.get(boardPath())?.strokes.length===1,'synced redo');
 await teacher.locator('#tool').selectOption('rect');await canvas.scrollIntoViewIfNeeded();const rectBox=await canvas.boundingBox();await teacher.mouse.move(rectBox.x+220,rectBox.y+90);await teacher.mouse.down();await teacher.mouse.move(rectBox.x+340,rectBox.y+180);await teacher.mouse.up();
 await until(()=>db.get(boardPath())?.strokes.length===2,'rectangle');
 console.log('PASS chat escaping, raised hands, saved strokes, shapes, undo and redo');
 await teacher.locator('#savedQuiz').selectOption('example');await teacher.getByRole('button',{name:'Start quiz',exact:true}).click();
 await until(()=>student.locator('#quizPanel .answer').count().then(n=>n===4),'four quiz answers');
 assert(await student.locator('#quizControls').isHidden());
 await student.locator('#quizPanel .answer').nth(1).click();await until(()=>student.locator('#quizPanel .answer').first().isDisabled(),'one-answer lock');
 await teacher.getByRole('button',{name:'End quiz',exact:true}).click();await until(()=>student.locator('#quizStage').innerText().then(s=>s.includes('Fastest Finger')),'fastest finger results');
 await teacher.getByRole('button',{name:'Show leaderboard',exact:true}).click();await until(()=>student.locator('#publicLeaderboard').isVisible(),'teacher reveals leaderboard');
 await teacher.getByRole('button',{name:'Hide leaderboard',exact:true}).click();await until(()=>student.locator('#publicLeaderboard').isHidden(),'teacher hides leaderboard');
 console.log('PASS four-option quiz, answer locking, fastest finger and teacher-controlled leaderboard');
 const beforeShare=await received(student,'audio');await teacher.locator('#share').click();
 await until(async()=>await student.locator('#screenPane').isVisible()&&await student.locator('#sharedScreen').evaluate(v=>v.videoWidth>0),'shared screen received');
 await until(async()=>await received(student,'audio')>beforeShare+20,'teacher audio continues during screen share');
 assert(await student.locator('.video-tile.teacher video').evaluate(v=>v.videoWidth>0));
 const late=await create('student','late-test');await late.locator('#join').click();
 await until(async()=>await late.locator('#sharedScreen').evaluate(v=>v.videoWidth>0),'late joiner receives shared screen');
 await teacher.locator('#share').click();await until(async()=>await student.locator('#screenPane').isHidden(),'screen ends and lesson returns');
 assert.equal(await student.locator('#sharedScreen').evaluate(v=>v.srcObject),null);
 const studentControls=teacher.locator('#people li[data-uid="student-test"]');
 assert(await student.locator('#share').isHidden());await studentControls.getByRole('button',{name:'Allow screen share',exact:true}).click();await student.locator('#share').waitFor({state:'visible'});await student.locator('#share').click();
 await until(async()=>await teacher.locator('#sharedScreen').evaluate(v=>v.videoWidth>0)&&await teacher.locator('#screenPane').isVisible(),'teacher receives permitted student screen');
 await studentControls.getByRole('button',{name:'Stop screen share',exact:true}).click();await until(()=>student.locator('#share').isHidden(),'teacher stops student screen');
 await teacher.locator('#muteAll').click();await until(()=>student.locator('#mic').isDisabled(),'teacher locks microphone');
 console.log('PASS permission-gated student screen sharing, teacher stop, and mute all');
 await student.locator('#reconnect').click();await until(async()=>await received(student,'audio')>20,'audio after reconnect');
 console.log('PASS screen share preserves camera/audio, late joins, reconnect');
 const listener=await create('student','listen-only',true);await listener.locator('#join').click();await until(async()=>await received(listener,'audio')>20,'receive audio with camera/mic denied');
 assert((await listener.locator('#deviceStatus').innerText()).includes('permission denied'));
 await listener.context().close();
 await teacher.locator('#reconnect').click();await until(async()=>await student.locator('.video-tile.teacher small').innerText()==='Connected','teacher ICE restart');
 await student.locator('#camera').click();assert.equal(await student.locator('#camera').getAttribute('aria-pressed'),'false');await student.locator('#camera').click();assert.equal(await student.locator('#camera').getAttribute('aria-pressed'),'true');
 console.log('PASS denied devices allow listening, autoplay recovery, ICE restart and camera toggles');
 for(const page of [teacher,student])for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);}
 await teacher.setViewportSize({width:1440,height:1100});await student.setViewportSize({width:390,height:900});
 await teacher.screenshot({path:require('node:path').join(artifacts,'teacher.png'),fullPage:true});await student.screenshot({path:require('node:path').join(artifacts,'student-mobile.png'),fullPage:true});
 await teacher.locator('#leave').click();await until(async()=>await student.locator('#roomStatus').innerText().then(t=>t==='Class ended'),'class ends for student');
 assert(await student.evaluate(()=>window.testPeers.every(p=>p.connectionState==='closed')));
 assert.deepEqual(errors,[]);console.log('PASS responsive widths, teacher end propagates, peer cleanup; no page errors');
 } finally { clearTimeout(testDeadline);await browser.close();server.close(); }
})().catch(e=>{console.error(e);process.exit(1)});

