import {auth} from './firebase-config.js';
import {createFreeClassroom} from './classroom-free.js';
import {db as freeDB,clock,syncClock,serverTimestamp} from './firestore-free.js';
import {getFirestore,collection,doc,onSnapshot,deleteDoc} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const db=getFirestore(auth.app),handlers=createFreeClassroom({db:freeDB,clock,serverTimestamp});
export const quizAPI={
 async call(name,data){await auth.authStateReady();const user=auth.currentUser;if(!user||user.isAnonymous)throw Error('Sign in to your account first.');if(name==='quizClock')return syncClock(user.uid);if(!handlers[name])throw Error('Unknown classroom action.');return handlers[name](user.uid,data||{});},
 watch(path,next,error){return onSnapshot(doc(db,path),s=>next(s.data()||null),error);},
 list(path,next,error){return onSnapshot(collection(db,path),s=>next(s.docs.map(d=>({...d.data(),id:d.id}))),error);},
 removeQuiz:(uid,id)=>deleteDoc(doc(db,`users/${uid}/quizzes/${id}`))
};
