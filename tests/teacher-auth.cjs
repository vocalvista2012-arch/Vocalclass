const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const server=require('./server.cjs');
const sdk=`let observer;
export const browserLocalPersistence='local',browserSessionPersistence='session';
export async function setPersistence(auth,p){window.events.push('persistence:'+p);}
export function onAuthStateChanged(auth,fn){observer=fn;setTimeout(()=>fn({isAnonymous:true}),0);return()=>{};}
export async function createUserWithEmailAndPassword(auth,email,password){window.events.push('create');if(window.fail==='duplicate')throw {code:'auth/email-already-in-use'};const user={email,isAnonymous:false};observer(user);return {user};}
export async function signInWithEmailAndPassword(auth,email,password){window.events.push('login');observer({email,isAnonymous:false});return {user:{email}};}
export async function updateProfile(user,profile){window.events.push('profile-start');await new Promise(r=>setTimeout(r,100));if(window.fail==='profile')throw Error('network');window.events.push('profile-done');}
export async function sendPasswordResetEmail(){window.events.push('reset');}
`;
(async()=>{
 await new Promise(resolve=>server.listen(4176,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true});
 const context=await browser.newContext();
 await context.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const auth={};'}));
 await context.route('https://www.gstatic.com/firebasejs/**/firebase-auth.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 const saved=[];
 await context.exposeBinding('capture',(_,events)=>saved.push(events));
 await context.addInitScript(()=>{window.events=[];window.addEventListener('beforeunload',()=>window.capture(window.events));});
 await context.route('**/teacher.html',r=>r.fulfill({contentType:'text/html',body:'<h1>Teacher Dashboard</h1>'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:4176/teacher-login.html';
 async function open(){await page.goto(url);await page.locator('#loginEmail').waitFor();await page.waitForTimeout(80);assert(page.url().endsWith('teacher-login.html'));}
 await open();await page.locator('#showSignup').click();
 await page.locator('#signupName').fill('Test Teacher');await page.locator('#signupEmail').fill('teacher@example.test');await page.locator('#signupPassword').fill('SamplePass123!');await page.locator('#signupConfirm').fill('Different123!');
 await page.locator('#signupBtn').click();assert((await page.locator('#message').innerText()).includes('do not match'));
 assert.equal(await page.evaluate(()=>window.events.includes('create')),false);
 await page.locator('#signupConfirm').fill('SamplePass123!');await page.locator('#signupBtn').click();await page.waitForURL('**/teacher.html');
 assert.equal(await page.evaluate(()=>localStorage.getItem('vocalclass-teacher-email')),'teacher@example.test');
 assert(!JSON.stringify(await page.evaluate(()=>({...localStorage}))).includes('SamplePass'));
 assert(saved.some(events=>events.join(',')==='persistence:session,create,profile-start,profile-done'));
 await open();assert.equal(await page.locator('#loginEmail').inputValue(),'teacher@example.test');
 await page.locator('#loginRemember').uncheck();assert.equal(await page.evaluate(()=>localStorage.getItem('vocalclass-teacher-email')),null);
 await page.locator('#loginStay').check();await page.locator('#loginPassword').fill('SamplePass123!');await page.locator('#loginBtn').click();await page.waitForURL('**/teacher.html');
 assert(saved.some(events=>events.includes('persistence:local')&&events.includes('login')));
 assert.equal(await page.evaluate(()=>localStorage.getItem('vocalclass-teacher-email')),null);
 await open();await page.locator('#loginEmail').fill('teacher@example.test');await page.locator('#forgotBtn').click();assert((await page.locator('#message').innerText()).includes('If an account'));
 await page.locator('#showSignup').click();await page.locator('#signupName').fill('Test Teacher');await page.locator('#signupPassword').fill('SamplePass123!');await page.locator('#signupConfirm').fill('SamplePass123!');
 await page.evaluate(()=>window.fail='duplicate');await page.locator('#signupBtn').click();assert((await page.locator('#message').innerText()).includes('already has an account'));
 await page.evaluate(()=>window.fail='profile');await page.locator('#signupBtn').click();await page.locator('#continueTeaching').waitFor({state:'visible'});assert((await page.locator('#message').innerText()).includes('Your account is ready'));
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await context.route('**/student.html',r=>r.fulfill({contentType:'text/html',body:'Student Dashboard'}));
 await page.goto('http://127.0.0.1:4176/student-login.html');await page.locator('#showSignup').click();await page.locator('#signupName').fill('Test Student');await page.locator('#signupEmail').fill('student@example.test');await page.locator('#signupPassword').fill('SamplePass123!');await page.locator('#signupConfirm').fill('SamplePass123!');await page.locator('#signupBtn').click();await page.waitForURL('**/student.html');assert.equal(await page.evaluate(()=>localStorage.getItem('vocalclass-student-email')),'student@example.test');
 assert.deepEqual(errors,[]);
 console.log('PASS anonymous sessions stay on signup; confirmation validation; profile completes before redirect; remembered email and opt-out; no saved passwords; session/local persistence; duplicate account, reset and profile-failure recovery; mobile widths.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
