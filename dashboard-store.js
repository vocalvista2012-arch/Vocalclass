import { auth } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, where, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const db = getFirestore(auth.app);
export const dashboardStore = {
  observeAccount: next => onAuthStateChanged(auth,next),
  signOut: () => signOut(auth),
  watchProfile(uid,role,next,error) {
    return onSnapshot(doc(db,'users',uid,'profiles',role),s=>next(s.exists()?s.data():null),error);
  },
  saveProfile(uid,role,data) {
    return setDoc(doc(db,'users',uid,'profiles',role),{...data,updatedAt:serverTimestamp()});
  },
  watchHistory(uid,role,next,error) {
    const ref = role==='teacher' ? query(collection(db,'activationCodes'),where('teacherId','==',uid)) : collection(db,'users',uid,'classHistory');
    return onSnapshot(ref,s=>next(s.docs.map(d=>({...d.data(),id:d.id}))),error);
  },
  async createClass(user,name) {
    for(let attempt=0;attempt<8;attempt++) {
      const random=crypto.getRandomValues(new Uint32Array(1))[0];
      const code=String(100000+random%900000),ref=doc(db,'activationCodes',code);
      const created=await runTransaction(db,async transaction=>{
        if((await transaction.get(ref)).exists())return false;
        transaction.set(ref,{code,teacherId:user.uid,teacherEmail:user.email||'',classroomName:name,active:true,live:false,studentCount:0,createdAt:serverTimestamp()});
        return true;
      });
      if(created)return code;
    }
    throw Error('Could not allocate a new code. Please try again.');
  },
  async checkClass(code) {
    const snap=await getDoc(doc(db,'activationCodes',code));
    if(!snap.exists()||snap.data().active!==true)throw Error('This code is invalid or disabled. Ask your teacher for an active code.');
    return {...snap.data(),code};
  },
  disableClass: code=>setDoc(doc(db,'activationCodes',code),{active:false,live:false},{merge:true})
};
