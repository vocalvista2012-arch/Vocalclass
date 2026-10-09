const core=require('../functions/quiz-core.cjs');
exports.client=`import {store} from './classroom-store.js';export const quizAPI={watch:store.watch,list:store.list,call:(name,data)=>window.quizCall(name,data),removeQuiz:async()=>{}};`;
exports.bind=(db,uid)=>async(name,d)=>{
 if(name==='quizClock')return {now:Date.now()};const base=`liveClassrooms/${d.code}/sessions/${d.sessionId}`,path=base+'/state/quiz',q=db.get(path);
 if(name==='saveBoard'){db.set(base+'/state/board',{strokes:d.strokes,revision:d.revision+1});return {revision:d.revision+1};}
 if(name==='setPermission'){const ids=d.studentUid==='all'?[...new Set([...db.values()].filter(x=>x.role==='student').map(x=>x.uid))]:[d.studentUid];for(const id of ids)db.set(base+'/permissions/'+id,{...db.get(base+'/permissions/'+id),[d.permission]:d.value});if(d.permission==='screenShare')db.set(base+'/state/shareOwner',{uid:d.value?d.studentUid:null});return {};}
 if(name==='claimScreen'){db.set(base+'/state/shareOwner',{uid});return {};}
 if(name==='submitQuizAnswer'){const answerPath=`${base}/quizRounds/${d.roundId}/answers/${uid}`;const result=core.acceptAnswer(q,db.get(answerPath),d.choice,Date.now());db.set(answerPath,{...result,uid,name:'Maya'});return result;}
 if(name==='quizAction'){
  if(d.action==='start'){const roundId=crypto.randomUUID();db.set(path,{roundId,runId:'run',index:0,total:2,title:'Discover our solar system',question:'Which planet is known as the Red Planet?',options:['Earth','Mars','Venus','Jupiter'],allowChange:false,status:'running',duration:60,startedAt:Date.now(),endsAt:Date.now()+60000,elapsedMs:0,remainingMs:60000,points:100,fastest:[]});}
  if(d.action==='pause')db.set(path,{...q,status:'paused',remainingMs:q.endsAt-Date.now()});
  if(d.action==='resume')db.set(path,{...q,status:'running',endsAt:Date.now()+q.remainingMs});
  if(d.action==='reveal')db.set(path,{...q,showCorrect:true,correct:1,explanation:'Iron minerals give Mars its reddish colour.'});
  if(d.action==='end'){const rows=[...db.entries()].filter(([key])=>key.startsWith(`${base}/quizRounds/${q.roundId}/answers/`)).map(([,v])=>v);const fastest=core.rankAnswers(rows,1,100).filter(r=>r.correct).slice(0,10).map(r=>({...r,points:r.speedPoints}));db.set(path,{...q,status:'ended',endsAt:Date.now(),showFastest:true,fastest});}
  if(d.action==='leaderboard')db.set(base+'/state/leaderboard',{visible:!!d.visible,rows:d.visible?[{uid:'student-test',name:'Maya',correct:1,played:1,points:105}]:[]});
  return {};
 }
 throw Error('Unsupported mock function '+name);
};
