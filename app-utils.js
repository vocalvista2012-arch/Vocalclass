import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { auth, db, firebaseConfig } from "./firebase-config.js";

export { auth, db, serverTimestamp };

export const roles = { ADMIN: "admin", TEACHER: "teacher", STUDENT: "student", PENDING: "pendingTeacher" };

export function friendlyError(error) {
  const code = error?.code || error?.status || "";
  const messages = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "No account was found for that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "That email address already has an account.",
    "auth/weak-password": "Password is too weak. Use at least 6 characters.",
    "auth/operation-not-allowed": "Email/password login is not enabled in Firebase Authentication.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "permission-denied": "Firebase signed you in, but Firestore rejected this request. Deploy firestore.rules with: firebase deploy --only firestore:rules,storage. If you are opening admin.html or teacher.html, also confirm your users/{uid} role/status is correct.",
    "PERMISSION_DENIED": "Firebase signed you in, but Firestore rejected this request. Deploy firestore.rules with: firebase deploy --only firestore:rules,storage. If you are opening admin.html or teacher.html, also confirm your users/{uid} role/status is correct.",
    "not-found": "Firestore could not find the requested document or database.",
    "NOT_FOUND": "Firestore is not available for this project yet. Open Firebase Console and create/enable the default Cloud Firestore database for vocalclass-66f4d.",
    "unavailable": "Firestore did not respond. I switched the app to forced long-polling; if you still see this, open the browser console and check the exact Firebase error code/details. Also confirm the default Cloud Firestore database exists for vocalclass-66f4d.",
    "UNAVAILABLE": "Firestore did not respond. I switched the app to forced long-polling; if you still see this, open the browser console and check the exact Firebase error code/details. Also confirm the default Cloud Firestore database exists for vocalclass-66f4d."
  };
  return messages[code] || error?.message || "Something went wrong. Please try again.";
}

export function showMessage(id, text, type = "info") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `message show ${type}`;
}

export function setLoading(button, isLoading, label, loadingLabel = "Please wait...") {
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingLabel : label;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { stringValue: String(value) };
}

function decodeFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  return undefined;
}

function decodeFirestoreDocument(document) {
  const data = {};
  for (const [key, value] of Object.entries(document.fields || {})) data[key] = decodeFirestoreValue(value);
  return data;
}

async function firestoreRest(path, options = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw { code: "auth/invalid-credential", message: "You must be signed in." };
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = payload?.error?.status || response.status;
    const message = payload?.error?.message || response.statusText;
    throw { code: status, status, message };
  }
  return payload;
}

async function getUserProfileRest(uid) {
  const payload = await firestoreRest(`users/${uid}`);
  return decodeFirestoreDocument(payload);
}

async function setUserProfileRest(uid, data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "createdAt" && key !== "updatedAt") fields[key] = encodeFirestoreValue(value);
  }
  const now = new Date().toISOString();
  fields.createdAt = { timestampValue: now };
  fields.updatedAt = { timestampValue: now };
  await firestoreRest(`users/${uid}`, { method: "PATCH", body: JSON.stringify({ fields }) });
}

export async function createUserProfile(uid, data) {
  try {
    await setDoc(doc(db, "users", uid), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  } catch (error) {
    console.warn("Firestore SDK profile write failed; trying REST fallback", error);
    await setUserProfileRest(uid, data);
  }
}

export async function getUserProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.warn("Firestore SDK profile read failed; trying REST fallback", error);
    try {
      return await getUserProfileRest(uid);
    } catch (restError) {
      console.error("Firestore REST profile read also failed", restError);
      throw restError;
    }
  }
}

export function requireRole(allowedRoles, options = {}) {
  const { activeOnly = true, redirect = "index.html", messageId = "message" } = options;
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.replace(redirect);
        return;
      }
      try {
        const profile = await getUserProfile(user.uid);
        const isAllowed = profile && allowedRoles.includes(profile.role) && (!activeOnly || profile.status === "active");
        if (!isAllowed) {
          showMessage(messageId, profile?.role === roles.PENDING ? "Your teacher account is waiting for admin approval." : "You are not authorized to view this page.", "error");
          setTimeout(() => window.location.replace(redirect), 900);
          return;
        }
        resolve({ user, profile });
      } catch (error) {
        console.error(error);
        showMessage(messageId, friendlyError(error), "error");
      }
    });
  });
}

export async function logout() {
  await signOut(auth);
  window.location.href = "index.html";
}

export function classroomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
