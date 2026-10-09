import {auth} from './firebase-config.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';
import {getFirestore,collection,doc,onSnapshot,deleteDoc} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const functions=getFunctions(auth.app,'us-central1'),db=getFirestore(auth.app);
export const quizAPI={
 async call(name,data){try{return (await httpsCallable(functions,name)(data)).data;}catch(e){if(['functions/not-found','functions/unavailable','functions/internal'].includes(e.code))throw Error('The classroom service is unavailable. Deploy the VocalClass Firebase functions and retry.');throw e;}},
 watch(path,next,error){return onSnapshot(doc(db,path),s=>next(s.data()||null),error);},
 list(path,next,error){return onSnapshot(collection(db,path),s=>next(s.docs.map(d=>({...d.data(),id:d.id}))),error);},
 removeQuiz:(uid,id)=>deleteDoc(doc(db,`users/${uid}/quizzes/${id}`))
};
