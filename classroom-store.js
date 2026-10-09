import { auth } from './firebase-config.js';
import { getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection, onSnapshot, query, orderBy, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const db = getFirestore(auth.app);
export const store = {
  async authenticate(role) {
    await auth.authStateReady();
    if (!auth.currentUser || auth.currentUser.isAnonymous) throw Error('Please sign in with your ' + role + ' account from the dashboard first.');
    return { uid:auth.currentUser.uid, name:auth.currentUser.displayName || '', token:() => auth.currentUser.getIdToken() };
  },
  timestamp: () => serverTimestamp(),
  async read(path) { const s = await getDoc(doc(db,path)); return s.exists() ? s.data() : null; },
  write: (path,data,merge=false) => setDoc(doc(db,path),data,{merge}),
  add: (path,data) => addDoc(collection(db,path),data),
  remove: path => deleteDoc(doc(db,path)),
  watch: (path,next,error) => onSnapshot(doc(db,path),s=>next(s.exists()?s.data():null),error),
  list: (path,next,error,order=null,max=200) => {
    const ref = collection(db,path);
    return onSnapshot(order ? query(ref,orderBy(order),limitToLast(max)) : ref,s=>next(s.docs.map(d=>({...d.data(),id:d.id}))),error);
  }
};
