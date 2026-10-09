
const BADGES=['🏆 Quiz Champion','⚡ Fastest Finger','🔥 5 Correct Answers in a Row','🎯 Perfect Score','🧠 Knowledge Master','⭐ Top Performer','🚀 Quick Thinker'];
function validateQuiz(value){
 if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>100)throw Error('Enter a quiz title (1–100 characters).');
 if(!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>30)throw Error('A quiz needs 1–30 questions.');
 return {title:value.title.trim(),questions:value.questions.map(q=>{
  if(typeof q.question!=='string'||!q.question.trim()||q.question.length>500)throw Error('Each question needs text (up to 500 characters).');
  if(!Array.isArray(q.options)||q.options.length!==4||q.options.some(x=>typeof x!=='string'||!x.trim()||x.length>160))throw Error('Enter four answers, each up to 160 characters.');
  if(!Number.isInteger(q.correct)||q.correct<0||q.correct>3)throw Error('Select the correct answer A–D.');
  if(!Number.isInteger(q.duration)||q.duration<1||q.duration>60)throw Error('Timer must be 1–60 seconds.');
  if(!Number.isInteger(q.points)||q.points<1||q.points>1000)throw Error('Points must be 1–1000.');
  if(typeof q.explanation!=='string'||q.explanation.length>1500)throw Error('Explanation must be at most 1500 characters.');
  return {question:q.question.trim(),options:q.options.map(x=>x.trim()),correct:q.correct,duration:q.duration,points:q.points,explanation:q.explanation,allowChange:q.allowChange===true};
 })};
}
function remaining(q,now){return q.status==='paused'?q.remainingMs:Math.max(0,q.endsAt-now);}
function acceptAnswer(q,prior,choice,now){
 if(q.status!=='running'||now>=q.endsAt||now<q.startedAt)throw Error('This question is closed for answers.');
 if(!Number.isInteger(choice)||choice<0||choice>3)throw Error('Choose A, B, C or D.');
 if(prior&&!q.allowChange)throw Error('Your answer is already locked.');
 return {choice,responseMs:q.elapsedMs+now-q.startedAt,submittedAt:now};
}
function rankAnswers(rows,correct,points){
 const correctRows=rows.filter(x=>x.choice===correct).sort((a,b)=>a.responseMs-b.responseMs||a.submittedAt-b.submittedAt||a.uid.localeCompare(b.uid));
 const ranks=new Map(correctRows.map((x,i)=>[x.uid,i]));
 return rows.map(row=>{const rank=ranks.get(row.uid);const speedPoints=rank===undefined?0:Math.max(Math.ceil(points*.1),points-rank*Math.max(1,Math.round(points*.05)));return {...row,correct:rank!==undefined,rank:rank===undefined?null:rank+1,speedPoints,points:speedPoints+5};});
}
function accumulate(old,row){const prior=old||{};return {uid:row.uid,name:row.name,correct:(prior.correct||0)+(row.correct?1:0),played:(prior.played||0)+1,points:(prior.points||0)+row.points,streak:row.correct?(prior.streak||0)+1:0};}
function badgesFor(score,row){const out=[];if(row.rank===1)out.push(BADGES[1]);if(score.streak>=5)out.push(BADGES[2]);if(score.correct>=10)out.push(BADGES[4]);if(row.correct&&row.responseMs<=2000)out.push(BADGES[6]);return out;}
export {validateQuiz,remaining,acceptAnswer,rankAnswers,accumulate,badgesFor,BADGES};

