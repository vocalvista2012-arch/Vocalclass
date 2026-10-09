// Candidate rules require the parent call to exist and identify both peers.
export function createSignal(store, {call, initiator, fromId, toId, uid, remoteUid}) {
  const side=initiator?'a':'b', other=initiator?'b':'a';
  const ready=initiator?store.write(call,{fromId,toId,fromUid:uid,toUid:remoteUid},true):Promise.resolve();
  // Observe failures through description/candidate and listener callbacks.
  ready.catch(()=>{});
  return {
    description:async message=>{await ready;return store.write(call,{[side]:message},true);},
    candidate:async message=>{await ready;return store.add(`${call}/${side}Candidates`,message);},
    watchDescription:(next,error)=>store.watch(call,d=>{if(d?.[other])next(d[other]);},error),
    watchCandidates(next,error){
      let closed=false, unsubscribeCandidates=null;
      const unsubscribeCall=store.watch(call,d=>{
        if(closed||!d||unsubscribeCandidates)return;
        unsubscribeCandidates=store.list(`${call}/${other}Candidates`,docs=>docs.forEach(d=>next(d.id,d)),error);
      },error);
      return ()=>{closed=true;unsubscribeCall();unsubscribeCandidates?.();};
    }
  };
}
