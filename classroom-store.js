import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection, onSnapshot, query, orderBy, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
const app = getApps()[0] || initializeApp({
  apiKey:'AIzaSyD2WCO8qa17uGaA88x31AT-wSOEbEvAOOI',authDomain:'vocalclass-66f4d.firebaseapp.com',projectId:'vocalclass-66f4d',storageBucket:'vocalclass-66f4d.firebasestorage.app',messagingSenderId:'885399749203',appId:'1:885399749203:web:c38cd8d8c53e1c11cbbca6'
});
const auth = getAuth(app), db = getFirestore(app);
export const store = {
  async authenticate(role) {
    await auth.authStateReady();
    if (!auth.currentUser && role === 'student') await signInAnonymously(auth);
    if (!auth.currentUser || (role === 'teacher' && auth.currentUser.isAnonymous)) throw Error('Please sign in with your teacher account first.');
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
