// Run with Firebase Auth (9099) and Firestore (8085) emulators, demo-vocalclass-test.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),server=require('./server.cjs');
const project='demo-vocalclass-test',base='liveClassrooms/123456/sessions/lesson';
const value=v=>v instanceof Date?{timestampValue:v.toISOString()}:Array.isArray(v)?{arrayValue:{values:v.map(value)}}:v===null?{nullValue:null}:typeof v==='object'?{mapValue:{fields:fields(v)}}:typeof v==='number'?{integerValue:String(v)}:typeof v==='boolean'?{booleanValue:v}:{stringValue:v};
const fields=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,value(x)]));
async function seed(path,data){const r=await fetch(`http://127.0.0.1:8085/v1/projects/${project}/databases/(default)/documents/${path}`,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:fields(data)})});assert(r.ok,await r.text());}
const config=`import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';import * as fs from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';const app=initializeApp({projectId:'${project}',apiKey:'fake-api-key',authDomain:'localhost'});export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});const db=fs.getFirestore(app);fs.connectFirestoreEmulator(db,'127.0.0.1',8085);window.testFS=fs;window.testDB=db;window.signup=async email=>(await createUserWithEmailAndPassword(auth,email,'test-password-123')).user.uid;`;
let browser;
(async()=>{const reset=await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});assert(reset.ok);await new Promise(r=>server.listen(4182,'127.0.0.1',r));browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true});try{
 async function open(role){const context=await browser.newContext();await context.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:config}));await context.route('**/classroom-app.js',r=>r.fulfill({contentType:'text/javascript',body:''}));const page=await context.newPage();page.on('console',m=>{if(m.type()==='error')console.log(role,m.text());});await page.goto('http://127.0.0.1:4182/classroom-room.html');const uid=await page.evaluate(async role=>{window.api=(await import('./quiz-api.js')).quizAPI;return window.signup(role+'-'+crypto.randomUUID()+'@example.test');},role);return {page,uid};}
 const teacher=await open('teacher'),student=await open('student'),stranger=await open('stranger');
 const call=(who,name,data={})=>who.page.evaluate(async({name,data})=>window.api.call(name,data),{name,data:{code:'123456',sessionId:'lesson',...data}});
 const get=(who,path)=>who.page.evaluate(async path=>{const s=await testFS.getDoc(testFS.doc(testDB,path));return s.data();},path);
 const write=(who,path,data)=>who.page.evaluate(async({path,data})=>testFS.setDoc(testFS.doc(testDB,path),data),{path,data});
 await seed('activationCodes/123456',{code:'123456',active:true,teacherId:teacher.uid});await seed('liveClassrooms/123456',{active:true,teacherId:teacher.uid,sessionId:'lesson'});await seed(base,{teacherUid:teacher.uid});
 for(const u of [teacher,student])await seed(base+'/participants/'+u.uid,{uid:u.uid,name:u===teacher?'Teacher':'Student',role:u===teacher?'teacher':'student',online:true,lastSeen:new Date()});
 await call(teacher,'quizClock');await call(student,'quizClock');
 const question={question:'Pick B',options:['A','B','C','D'],correct:1,duration:60,points:100,explanation:'B is correct',allowChange:false};
 const bank=await call(teacher,'saveQuiz',{quiz:{title:'Free class',questions:[question]}});
 await assert.rejects(()=>get(student,`users/${teacher.uid}/quizzes/${bank.id}`),/permission|false for|evaluation error/i);
 await assert.rejects(()=>call(student,'quizAction',{action:'start',quizId:bank.id}),/Only the teacher/);
 await call(teacher,'quizAction',{action:'start',quizId:bank.id});let q=await get(student,base+'/state/quiz');assert.equal(q.correct,undefined);
 await assert.rejects(()=>get(student,base+'/quizRounds/'+q.roundId),/permission|false for|evaluation error/i);
 await call(student,'submitQuizAnswer',{roundId:q.roundId,choice:1});
 await assert.rejects(()=>call(student,'submitQuizAnswer',{roundId:q.roundId,choice:0}),/locked/);
 await assert.rejects(()=>write(student,base+'/state/quiz',{status:'finished'}),/permission|false for|evaluation error/i);
 await assert.rejects(()=>write(student,base+'/permissions/'+student.uid,{microphone:true}),/permission|false for|evaluation error/i);
 await assert.rejects(()=>write(student,'liveClassrooms/123456/quizScores/'+student.uid,{uid:student.uid,points:99999}),/permission|false for|evaluation error/i);
 await assert.rejects(()=>get(stranger,base+'/quizRounds/'+q.roundId+'/answers/'+student.uid),/permission|false for|evaluation error/i);
 await call(teacher,'quizAction',{action:'pause'});
 await student.page.evaluate(async({path,uid})=>{try{await testFS.setDoc(testFS.doc(testDB,path),{choice:0,responseMs:0,uid,name:'Student',submittedAt:testFS.serverTimestamp(),segmentStart:0,elapsedBefore:0});throw Error('Unexpected permission');}catch(e){if(e.code!=='permission-denied')throw e;}},{path:base+'/quizRounds/'+q.roundId+'/answers/'+student.uid,uid:student.uid});
 await call(teacher,'quizAction',{action:'resume'});await call(teacher,'quizAction',{action:'end'});
 const score=await get(teacher,'liveClassrooms/123456/quizScores/'+student.uid);assert.equal(score.points,105);
 await call(teacher,'quizAction',{action:'end'});assert.equal((await get(teacher,'liveClassrooms/123456/quizScores/'+student.uid)).points,105);
 await call(teacher,'quizAction',{action:'badges',visible:true});assert((await get(student,base+'/state/badges')).rows.length>0);
 await call(teacher,'setPermission',{studentUid:student.uid,permission:'whiteboard',value:true});const stroke={tool:'pen',color:'#112233',size:4,points:[0,0,20,20]};await call(student,'saveBoard',{strokes:[stroke],revision:0});
 await assert.rejects(()=>write(student,base+'/state/board',{strokes:[],revision:2,updatedAt:0}),/permission|false for|evaluation error/i);
 await call(student,'saveBoard',{strokes:[stroke,{...stroke,points:[20,20,30,30]}],revision:1});
 await call(teacher,'setPermission',{studentUid:student.uid,permission:'screenShare',value:true});await call(student,'claimScreen');await call(teacher,'setPermission',{studentUid:student.uid,permission:'screenShare',value:false});await assert.rejects(()=>call(student,'claimScreen'),/permission|false for|evaluation error/i);
 const short=await call(teacher,'saveQuiz',{quiz:{title:'Expiry',questions:[{...question,duration:1}]}});await call(teacher,'quizAction',{action:'start',quizId:short.id});q=await get(teacher,base+'/state/quiz');await new Promise(r=>setTimeout(r,1300));
 await student.page.evaluate(async({path,uid,q})=>{try{await testFS.setDoc(testFS.doc(testDB,path),{choice:1,responseMs:0,uid,name:'Student',submittedAt:testFS.serverTimestamp(),segmentStart:q.startedAt,elapsedBefore:q.elapsedMs});throw Error('Late answer unexpectedly accepted');}catch(e){if(e.code!=='permission-denied')throw e;}},{path:base+'/quizRounds/'+q.roundId+'/answers/'+student.uid,uid:student.uid,q});
 await call(teacher,'expireQuiz',{roundId:q.roundId});assert.equal((await get(teacher,base+'/state/quiz')).status,'finished');
 console.log('PASS real Firebase emulator: private quizzes/answers, teacher-only controls and scores, server timestamps, pause/deadline locks, teacher expiry, idempotent grades, badges, student drawing append-only and screen permissions.');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
