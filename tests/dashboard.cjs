const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('./server.cjs');
// Test the real adapter and UI against an in-memory Firebase SDK. This does not validate deployed rules.
const sdk=`
export const getFirestore=()=>({}),serverTimestamp=()=>Date.now();
export const doc=(db,...parts)=>parts.join('/'),collection=doc;
export const where=(field,op,value)=>({field,value});
export const query=(path,filter)=>({path,filter});
const snapshot=(path,data)=>({id:path.split('/').pop(),exists:()=>!!data,data:()=>data});
window.records={
 'activationCodes/123456':{code:'123456',teacherId:'t1',classroomName:'Vocal foundations',active:true,createdAt:1700000000000},
 'activationCodes/654321':{code:'654321',teacherId:'t2',classroomName:'Private second teacher lesson',active:true,createdAt:1700000000000},
 'users/s1/classHistory/123456_session':{code:'123456',sessionId:'session',teacherId:'t1',classroomName:'Student one lesson',lastJoinedAt:1700000000000},
 'users/s2/classHistory/654321_session':{code:'654321',sessionId:'session',teacherId:'t2',classroomName:'Student two lesson',lastJoinedAt:1700000000000}
};
const subscriptions=[];window.captured=[];
function emit(ref,fn){if(typeof ref==='string'&&ref.split('/').length%2===0)fn(snapshot(ref,window.records[ref]));else{const p=typeof ref==='string'?ref:ref.path;fn({docs:Object.entries(window.records).filter(([key,value])=>key.startsWith(p+'/')&&key.split('/').length===p.split('/').length+1&&(!ref.filter||value[ref.filter.field]===ref.filter.value)).map(([key,value])=>snapshot(key,value))});}}
export function onSnapshot(ref,fn){window.captured.push(ref);const sub={ref,fn};subscriptions.push(sub);queueMicrotask(()=>emit(ref,fn));return()=>{subscriptions.splice(subscriptions.indexOf(sub),1);};}
export async function getDoc(ref){return snapshot(ref,window.records[ref]);}
export async function setDoc(ref,data,options){if(window.failSave)throw {code:'permission-denied'};window.records[ref]=options?.merge?{...window.records[ref],...data}:data;subscriptions.forEach(s=>emit(s.ref,s.fn));}
export async function runTransaction(db,fn){return fn({get:getDoc,set:setDoc});}
`;
const auth=`export function onAuthStateChanged(auth,fn){window.switchAccount=fn;queueMicrotask(()=>fn(window.account));return()=>{};}export async function signOut(){window.switchAccount(null);}`;
(async()=>{
 await new Promise(r=>server.listen(4177,'127.0.0.1',r));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true});
 const errors=[];
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/quiz-api.js',r=>r.fulfill({contentType:'text/javascript',body:'export const quizAPI={list:(path,next)=>{queueMicrotask(()=>next([]));return()=>{};},call:async()=>({id:"sample"}),removeQuiz:async()=>{}};'}));
 await context.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const auth={app:{}};'}));
 await context.route('https://www.gstatic.com/firebasejs/**/firebase-auth.js',r=>r.fulfill({contentType:'text/javascript',body:auth}));
 await context.route('https://www.gstatic.com/firebasejs/**/firebase-firestore.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
 await context.route('**/*-login.html',r=>r.fulfill({contentType:'text/html',body:'Sign in'}));
 await context.route('**/student-live.html?*',r=>r.fulfill({contentType:'text/html',body:'Student classroom'}));
 await context.addInitScript(()=>{window.account={uid:'t1',email:'teacher@example.test',displayName:'Asha Mehta'};});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://127.0.0.1:4177/teacher.html');await page.locator('#app').waitFor({state:'visible'});
 assert.equal(await page.locator('#statTotal').innerText(),'1');assert(!(await page.locator('#recentBody').innerText()).includes('second teacher'));
 assert.deepEqual(await page.evaluate(()=>window.captured.find(r=>r.filter)),{path:'activationCodes',filter:{field:'teacherId',value:'t1'}});
 await page.locator('#className').fill('Breath and rhythm');await page.locator('#classSubmit').click();await page.locator('#createdCard').waitFor({state:'visible'});
 assert.match(await page.locator('#createdCode').innerText(),/^\d{6}$/);assert.equal(await page.locator('#statTotal').innerText(),'2');
 await page.locator('nav [data-tab="history"]').click();await page.locator('#search').fill('Breath');assert.equal(await page.locator('#historyBody tr').count(),1);
 await page.locator('#historyBody button').filter({hasText:'Disable'}).click();await page.locator('#filter').selectOption('disabled');assert.equal(await page.locator('#historyBody tr').count(),1);
 await page.locator('nav [data-tab="profile"]').click();await page.locator('#displayName').fill('Asha Vocal Coach');await page.locator('#subject').fill('Voice, confidence & expression');await page.locator('#bio').fill('Helping every voice find its confidence.');await page.locator('#accent').selectOption('cyan');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='#40cbbb';x.fillRect(0,0,64,64);return c.toDataURL().split(',')[1];});
 await page.locator('#photo').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.locator('#editAvatar img').waitFor();await page.locator('#saveProfile').click();await page.waitForFunction(()=>document.querySelector('#sidebarName').textContent==='Asha Vocal Coach');
 assert.equal(await page.locator('body').getAttribute('data-accent'),'cyan');assert(await page.evaluate(()=>window.records['users/t1/profiles/teacher'].photo.startsWith('data:image/jpeg;base64,')));
 await page.evaluate(()=>{window.failSave=true;});await page.locator('#displayName').fill('Unsaved change');await page.locator('#saveProfile').click();assert((await page.locator('#notice').innerText()).includes('permissions'));await page.locator('#cancelProfile').click();assert.equal(await page.locator('#displayName').inputValue(),'Asha Vocal Coach');
 await page.evaluate(()=>{window.failSave=false;window.switchAccount({uid:'t2',email:'other@example.test',displayName:'Other Teacher'});});
 assert.equal(await page.locator('#statTotal').innerText(),'1');assert.equal(await page.locator('#sidebarName').innerText(),'Other Teacher');assert.equal(await page.locator('#sidebarAvatar img').count(),0);assert(await page.locator('#createdCard').isHidden());assert((await page.locator('#historyBody').innerText()).includes('Private second'));
 await page.evaluate(()=>window.switchAccount(window.account));await page.locator('nav [data-tab="overview"]').click();
 const artifacts=path.join(__dirname,'artifacts');fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'teacher-dashboard.png'),fullPage:true,animations:'disabled'});
 for(const width of [900,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow at '+width);for(const tab of ['history','profile']){await page.locator('nav [data-tab="'+tab+'"]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+tab+' '+width);}}
 await page.goto('http://127.0.0.1:4177/student.html');await page.locator('#app').waitFor({state:'visible'});await page.evaluate(()=>window.switchAccount({uid:'s1',email:'student1@example.test',displayName:'Maya Patel'}));assert.equal(await page.locator('#statTotal').innerText(),'1');assert((await page.locator('#recentBody').innerText()).includes('Student one lesson'));assert(!(await page.locator('#recentBody').innerText()).includes('Student two lesson'));
 await page.locator('nav [data-tab="profile"]').click();await page.locator('#displayName').fill('Maya Singer');await page.locator('#saveProfile').click();await page.waitForFunction(()=>window.records['users/s1/profiles/student']?.displayName==='Maya Singer');
 await page.evaluate(()=>window.switchAccount({uid:'s2',displayName:'Second Student'}));assert.equal(await page.locator('#displayName').inputValue(),'Second Student');assert.equal(await page.locator('#statTotal').innerText(),'1');
 await page.evaluate(()=>window.switchAccount({uid:'s1',displayName:'Maya Patel'}));assert.equal(await page.locator('#displayName').inputValue(),'Maya Singer');await page.locator('nav [data-tab="overview"]').click();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(artifacts,'student-dashboard.png'),fullPage:true,animations:'disabled'});
 await page.locator('#joinCode').fill('123456');await page.locator('#classSubmit').click();await page.waitForURL('**/student-live.html?code=123456');
 await page.goto('http://127.0.0.1:4177/student.html');await page.locator('#app').waitFor({state:'visible'});await page.evaluate(()=>window.switchAccount({uid:'guest',isAnonymous:true}));await page.waitForURL('**/student-login.html');
 assert.deepEqual(errors,[]);console.log('PASS real adapter owner queries, two teachers/two students, private profiles, photo processing, failed saves, account switching, code create/disable/filter, student join, guest redirect and responsive layouts. Firebase rules require separate deployment validation.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
