import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendPasswordResetEmail, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { auth } from './firebase-config.js';

const $ = id => document.getElementById(id);
const emailKey = 'vocalclass-teacher-email';
let busy = false;
function message(text, type = 'error') { $('message').textContent = text; $('message').className = 'message show ' + type; }
function errorMessage(error) {
  return ({
    'auth/invalid-credential':'Incorrect email or password.',
    'auth/user-not-found':'Incorrect email or password.',
    'auth/wrong-password':'Incorrect email or password.',
    'auth/email-already-in-use':'This email already has an account. Sign in or reset your password.',
    'auth/invalid-email':'Enter a valid email address.',
    'auth/weak-password':'Choose a stronger password with at least 6 characters.',
    'auth/password-does-not-meet-requirements':'This password does not meet the account password requirements. Choose a stronger password.',
    'auth/operation-not-allowed':'Teacher registration is temporarily unavailable. Email/password sign-in needs to be enabled for this website.',
    'auth/too-many-requests':'Too many attempts. Wait a little and try again.',
    'auth/network-request-failed':'Could not connect. Check your internet connection and try again.',
    'auth/user-disabled':'This account is disabled. Use another account or contact support.',
    'auth/web-storage-unsupported':'Your browser cannot save this session. Allow website storage and try again.'
  })[error.code] || 'Could not complete the request. Please try again.';
}
function rememberedEmail() { try { return localStorage.getItem(emailKey) || ''; } catch { return ''; } }
function remember(email, enabled) {
  try { if (enabled) localStorage.setItem(emailKey, email); else localStorage.removeItem(emailKey); }
  catch { /* Authentication remains usable when email storage is unavailable. */ }
}
const saved = rememberedEmail();
$('loginEmail').value = saved; $('signupEmail').value = saved;
for (const id of ['loginRemember','signupRemember']) $(id).onchange = () => {
  const checked = $(id).checked;
  $('loginRemember').checked = checked; $('signupRemember').checked = checked;
  if (!checked) remember('', false);
};
function switchForm(signup) {
  if (busy) return;
  const from = signup ? 'login' : 'signup', to = signup ? 'signup' : 'login';
  $(to+'Email').value = $(from+'Email').value;
  $(to+'Stay').checked = $(from+'Stay').checked;
  $('loginSection').hidden = signup; $('signupSection').hidden = !signup;
  $('message').className = 'message';
  $(signup ? 'signupName' : 'loginEmail').focus();
}
$('showSignup').onclick = () => switchForm(true);
$('showLogin').onclick = () => switchForm(false);
for (const prefix of ['login','signup']) $('toggle'+(prefix==='login'?'Login':'Signup')).onclick = () => {
  const input = $(prefix+'Password'), show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const toggle = $('toggle'+(prefix==='login'?'Login':'Signup'));
  toggle.textContent = show ? 'Hide' : 'Show'; toggle.setAttribute('aria-pressed',String(show));
};
function lock(value) {
  busy = value;
  document.querySelectorAll('form button, form input').forEach(element => { element.disabled = value; });
}
async function persistence(prefix) {
  // Firebase manages authentication tokens; this app never stores passwords.
  await setPersistence(auth, $(prefix+'Stay').checked ? browserLocalPersistence : browserSessionPersistence);
}
onAuthStateChanged(auth, user => {
  // An anonymous student session is not a registered teacher account.
  // Signup fires this callback before updateProfile has finished.
  if (user && !user.isAnonymous && !busy) location.replace('teacher.html');
});
$('loginForm').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const email = $('loginEmail').value.trim(), password = $('loginPassword').value;
  const saveEmail = $('loginRemember').checked;
  if (!email || !password) return message('Enter your email and password.');
  lock(true); $('loginBtn').textContent = 'Signing in…';
  try {
    await persistence('login');
    await signInWithEmailAndPassword(auth,email,password);
    remember(email,saveEmail); $('loginPassword').value = '';
    location.replace('teacher.html');
  } catch(error) { message(errorMessage(error)); }
  finally { lock(false); $('loginBtn').textContent = 'Login as Teacher →'; }
};
$('signupForm').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const name = $('signupName').value.trim(), email = $('signupEmail').value.trim(), password = $('signupPassword').value;
  const saveEmail = $('signupRemember').checked;
  if (name.length < 2) return message('Enter your name using at least 2 characters.');
  if (password.length < 6) return message('Use a password with at least 6 characters.');
  if (password !== $('signupConfirm').value) return message('The passwords do not match.');
  lock(true); $('signupBtn').textContent = 'Creating account…';
  try {
    await persistence('signup');
    const result = await createUserWithEmailAndPassword(auth,email,password);
    remember(email,saveEmail);
    $('signupPassword').value = ''; $('signupConfirm').value = '';
    try { await updateProfile(result.user,{displayName:name}); }
    catch {
      message('Your account is ready, but your display name could not be saved. You can still start teaching.','success');
      $('continueTeaching').hidden = false;
      return;
    }
    // No approval document, admin role, or email-verification gate is required.
    location.replace('teacher.html');
  } catch(error) { message(errorMessage(error)); }
  finally { lock(false); $('signupBtn').textContent = 'Create account & start teaching'; }
};
$('forgotBtn').onclick = async () => {
  if (busy) return;
  const email = $('loginEmail').value.trim();
  if (!email || !$('loginEmail').checkValidity()) return message('Enter a valid email address first.');
  lock(true);
  try {
    await sendPasswordResetEmail(auth,email);
    message('If an account uses this email, a password reset link is on its way. Check your inbox and spam folder.','success');
  } catch(error) {
    if(error.code==='auth/user-not-found')message('If an account uses this email, a password reset link is on its way. Check your inbox and spam folder.','success');
    else message(errorMessage(error));
  } finally { lock(false); }
};
