import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyD2WCO8qa17uGaA88x31AT-wSOEbEvAOOI",
  authDomain: "vocalclass-66f4d.firebaseapp.com",
  projectId: "vocalclass-66f4d",
  storageBucket: "vocalclass-66f4d.firebasestorage.app",
  messagingSenderId: "885399749203",
  appId: "1:885399749203:web:c38cd8d8c53e1c11cbbca6",
  measurementId: "G-17Y2R4S565"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
setPersistence(auth, browserLocalPersistence).catch((error) => console.error("Auth persistence failed", error));
