const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {createSignal}=await import('data:text/javascript;base64,'+fs.readFileSync(require('node:path').join(__dirname,'../classroom-signaling.js')).toString('base64'));
 for(const initiator of [true,false]){
  let parent=null,callback,lists=0,stops=0,closed=0,resolveWrite;
  const ready=new Promise(resolve=>resolveWrite=resolve);
  const store={write:()=>ready,add:async()=>{},watch:(_,next)=>{callback=next;next(parent);return ()=>closed++;},list:(_,next)=>{assert(parent,'must not subscribe before call exists');lists++;next([{id:'ice',candidate:'test'}]);return ()=>stops++;}};
  const signal=createSignal(store,{call:'room/call',initiator,fromId:'teacher',toId:'student',uid:'u1',remoteUid:'u2'});
  const received=[];const stop=signal.watchCandidates((id)=>received.push(id),e=>{throw e;});
  assert.equal(lists,0);parent={fromUid:'u1',toUid:'u2'};resolveWrite();callback(parent);callback(parent);
  assert.equal(lists,1);assert.deepEqual(received,['ice']);stop();callback(parent);assert.equal(lists,1);assert.equal(stops,1);assert.equal(closed,1);
 }
 console.log('PASS candidate listeners wait for call creation, subscribe once, and clean up for both peers.');
})().catch(e=>{console.error(e);process.exit(1);});
