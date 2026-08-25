import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

export { auth, db, serverTimestamp };

export const roles = { ADMIN: "admin", TEACHER: "teacher", STUDENT: "student", PENDING: "pendingTeacher" };

export function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/user-not-found": "No account was found for that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "That email address already has an account.",
    "auth/weak-password": "Password is too weak. Use at least 6 characters.",
    "auth/operation-not-allowed": "Email/password login must be enabled in Firebase Authentication.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "permission-denied": "You do not have permission to perform that action.",
    "unavailable": "Network unavailable. Check your connection and try again."
  };
  return messages[code] || "Something went wrong. Please try again.";
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

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
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
        setTimeout(() => window.location.replace(redirect), 1200);
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
