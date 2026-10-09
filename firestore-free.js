import {auth} from './firebase-config.js';
import {getFirestore,doc,collection,getDoc,getDocFromServer,getDocs,setDoc,updateDoc,runTransaction,writeBatch,query,where,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const firestore=getFirestore(auth.app);
const snapshot=s=>({id:s.id,exists:s.exists(),data:()=>s.data()});
function document(path){const ref=doc(firestore,path);return {path,ref,get:async()=>snapshot(await getDoc(ref)),set:(data,options)=>options?setDoc(ref,data,options):setDoc(ref,data),update:data=>updateDoc(ref,data)};}
function documents(path,filters=[]){return {where:(...args)=>documents(path,[...filters,where(...args)]),get:async()=>{const result=await getDocs(query(collection(firestore,path),...filters));return {docs:result.docs.map(snapshot),empty:result.empty};}};}
function writer(tx){return {get:async ref=>snapshot(await tx.get(ref.ref)),set:(ref,data,options)=>options?tx.set(ref.ref,data,options):tx.set(ref.ref,data),update:(ref,data)=>tx.update(ref.ref,data)};}
export const db={doc:document,collection:documents,runTransaction:fn=>runTransaction(firestore,tx=>fn(writer(tx))),batch:()=>{const batch=writeBatch(firestore);return {...writer(batch),commit:()=>batch.commit()};}};
let offset=0;
export const clock={now:()=>Date.now()+offset};
export async function syncClock(uid){
 const ref=doc(firestore,`users/${uid}/clock/current`),start=Date.now();
 await setDoc(ref,{at:serverTimestamp()});const s=await getDocFromServer(ref),end=Date.now();
 const at=s.data().at.toMillis();offset=at-(start+end)/2;
 return {now:clock.now()};
}
export {serverTimestamp};
