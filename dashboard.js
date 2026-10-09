import { QuizLibrary } from './quiz-library.js';
import { quizAPI } from './quiz-api.js';
import { dashboardStore as db } from './dashboard-store.js';
const $=id=>document.getElementById(id);
const role=document.body.dataset.role==='student'?'student':'teacher';
const teacher=role==='teacher';
let quizLibrary=null;
let user=null,profile=null,history=[],subscriptions=[],epoch=0,draftPhoto='',dirty=false,photoBusy=false;
const defaults={displayName:'',bio:'',subject:'',accent:'violet',photo:''};
const accents=['violet','cyan','rose'];
function notify(text,error=false){$('notice').textContent=text;$('notice').className='notice'+(error?' error':'');$('notice').hidden=false;}
function fail(error){notify(error?.code==='permission-denied'?'Your account could not access its dashboard data. The updated dashboard permissions need to be published in Firebase.':error.message||String(error),true);}
function dateValue(value){return typeof value==='number'?value:value?.toMillis?.()||((value?.seconds||0)*1000);}
function dateLabel(value){const n=dateValue(value);return n?new Date(n).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'Just now';}
function initials(name){return name.trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase()||'VC';}
function safePhoto(photo){return typeof photo==='string'&&photo.length<=120000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)?photo:'';}
function avatar(element,name,photo){element.replaceChildren();if(safePhoto(photo)){const img=document.createElement('img');img.src=photo;img.alt=name+' profile picture';element.append(img);}else element.textContent=initials(name);}
function currentName(){return profile?.displayName||user?.displayName||user?.email?.split('@')[0]||(teacher?'Teacher':'Student');}
function showProfile(){
  const name=currentName();
  $('sidebarName').textContent=name;$('greetingName').textContent=name.split(' ')[0];$('profileName').textContent=name;
  $('profileSubtitle').textContent=profile?.subject||(teacher?'Your teaching space':'Your learning space');
  $('accountEmail').textContent=user?.email||'';
  document.body.dataset.accent=accents.includes(profile?.accent)?profile.accent:'violet';
  for(const id of ['sidebarAvatar','headerAvatar','profileAvatar'])avatar($(id),name,profile?.photo);
  if(!dirty){$('displayName').value=name.slice(0,40);$('bio').value=profile?.bio||'';$('subject').value=profile?.subject||'';$('accent').value=profile?.accent||'violet';draftPhoto=profile?.photo||'';avatar($('editAvatar'),name,draftPhoto);}
}
function section(name){
  document.querySelectorAll('[data-section]').forEach(panel=>{panel.hidden=panel.dataset.section!==name;});
  document.querySelectorAll('[data-tab]').forEach(button=>{button.setAttribute('aria-current',button.dataset.tab===name?'page':'false');});
  $('pageTitle').textContent=name==='overview'?'Overview':name==='history'?'Class history':name==='quizzes'?'Create quiz':'My profile';
  if(name==='history')renderHistory();
}
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>section(button.dataset.tab));
function classState(row){return teacher?(row.active?'Active code':'Disabled'):'Joined';}
function classTime(row){return teacher?row.createdAt:row.lastJoinedAt;}
function sortedHistory(){return [...history].sort((a,b)=>dateValue(classTime(b))-dateValue(classTime(a))||a.id.localeCompare(b.id));}
function smallButton(text,fn,kind=''){const b=document.createElement('button');b.type='button';b.className='small '+kind;b.textContent=text;b.onclick=fn;return b;}
async function action(button,fn){if(!user)return;button.disabled=true;const mine=epoch;try{await fn();}catch(e){if(mine===epoch)fail(e);}finally{button.disabled=false;}}
async function openClass(row){
  const current=user, mine=epoch;
  const checked=await db.checkClass(row.code||row.id);
  if(mine!==epoch||current?.uid!==user?.uid)return;
  if(teacher&&checked.teacherId!==user.uid)throw Error('This class belongs to another teacher.');
  location.href=(teacher?'teacher-live.html':'student-live.html')+'?code='+encodeURIComponent(checked.code);
}
function makeRow(row){
  const tr=document.createElement('tr');
  const name=document.createElement('td');const strong=document.createElement('strong');strong.textContent=row.classroomName||'Classroom';const sub=document.createElement('small');sub.textContent=teacher?'Your classroom':'Lesson visit';name.append(strong,sub);
  const code=document.createElement('td');const badge=document.createElement('span');badge.className='code';badge.textContent=row.code||row.id;code.append(badge);
  const date=document.createElement('td');date.textContent=dateLabel(classTime(row));
  const state=document.createElement('td');const chip=document.createElement('span');chip.className='badge '+(row.active===false?'muted':'');chip.textContent=classState(row);state.append(chip);
  const actions=document.createElement('td');actions.className='row-actions';
  const copy=smallButton('Copy code',()=>action(copy,async()=>{await navigator.clipboard.writeText(row.code||row.id);notify('Class code copied.');}));actions.append(copy);
  if(!teacher||row.active){const open=smallButton(teacher?'Open class ↗':'Rejoin ↗',()=>action(open,()=>openClass(row)),'accent');actions.append(open);}
  if(teacher&&row.active){const disable=smallButton('Disable',()=>action(disable,async()=>{if(confirm('Disable this class code? It will remain in your history.'))await db.disableClass(row.code||row.id);}));actions.append(disable);}
  tr.append(name,code,date,state,actions);return tr;
}
function populateTable(body,rows,empty){body.replaceChildren();for(const row of rows)body.append(makeRow(row));empty.hidden=rows.length>0;}
function renderHistory(){
  const term=$('search').value.trim().toLowerCase(),filter=$('filter').value;
  const rows=sortedHistory().filter(r=>(!term||(`${r.classroomName||''} ${r.code||r.id}`).toLowerCase().includes(term))&&(!teacher||filter==='all'||(filter==='active'?r.active:r.active===false)));
  populateTable($('historyBody'),rows,$('historyEmpty'));
  $('historyCount').textContent=`${rows.length} ${rows.length===1?'class':'classes'}`;
}
function render(){
  const rows=sortedHistory();$('statTotal').textContent=String(rows.length);
  $('statActive').textContent=teacher?String(rows.filter(r=>r.active).length):String(new Set(rows.map(r=>r.teacherId)).size);
  $('statLatest').textContent=rows.length?dateLabel(classTime(rows[0])):'—';
  $('historyNavCount').textContent=String(rows.length);
  populateTable($('recentBody'),rows.slice(0,4),$('recentEmpty'));renderHistory();
}
$('search').oninput=renderHistory;$('filter').onchange=renderHistory;
$('classForm').onsubmit=async event=>{
  event.preventDefault();if(!user)return;
  const button=$('classSubmit'),current=user,mine=epoch;
  await action(button,async()=>{
    if(teacher){
      const name=$('className').value.trim();if(name.length<2)throw Error('Enter a class name with at least two characters.');
      const code=await db.createClass(current,name);
      if(mine!==epoch)return;
      $('createdCode').textContent=code;$('createdCard').hidden=false;$('className').value='';
      $('openCreated').onclick=()=>action($('openCreated'),()=>openClass({code}));notify('Classroom created. Share the code when you’re ready to teach.');
    }else{
      const code=$('joinCode').value.trim();if(!/^\d{6}$/.test(code))throw Error('Enter the six-digit code from your teacher.');
      await openClass({code});
    }
  });
};
if($('joinCode'))$('joinCode').oninput=()=>{$('joinCode').value=$('joinCode').value.replace(/\D/g,'').slice(0,6);};
$('copyCreated').onclick=()=>action($('copyCreated'),async()=>{await navigator.clipboard.writeText($('createdCode').textContent);notify('Class code copied.');});
for(const id of ['displayName','bio','subject','accent'])$(id).oninput=()=>{dirty=true;};
async function compressPhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPG, PNG or WebP picture.');
  if(file.size>8*1024*1024)throw Error('Choose a picture smaller than 8 MB.');
  const bitmap=await createImageBitmap(file);
  try{
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,256,256);
    const size=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
    const data=canvas.toDataURL('image/jpeg',.8);if(data.length>120000)throw Error('This picture is too detailed. Try a smaller image.');return data;
  }finally{bitmap.close();}
}
$('photo').onchange=async()=>{
  const file=$('photo').files[0];if(!file||!user)return;const mine=epoch;photoBusy=true;$('saveProfile').disabled=true;
  try{const photo=await compressPhoto(file);if(mine!==epoch)return;draftPhoto=photo;dirty=true;avatar($('editAvatar'),$('displayName').value,photo);notify('Picture ready. Save your profile to apply it.');}
  catch(e){if(mine===epoch)fail(e);}finally{photoBusy=false;$('saveProfile').disabled=false;$('photo').value='';}
};
$('removePhoto').onclick=()=>{draftPhoto='';dirty=true;avatar($('editAvatar'),$('displayName').value,'');};
$('cancelProfile').onclick=()=>{dirty=false;showProfile();notify('Unsaved profile changes discarded.');};
$('profileForm').onsubmit=async event=>{
  event.preventDefault();if(!user||photoBusy)return;
  const current=user,mine=epoch;
  await action($('saveProfile'),async()=>{
    const name=$('displayName').value.trim();if(name.length<2)throw Error('Enter a display name with at least two characters.');
    const next={displayName:name,bio:$('bio').value.trim(),subject:$('subject').value.trim(),accent:$('accent').value,photo:draftPhoto};
    await db.saveProfile(current.uid,role,next);
    if(mine!==epoch)return;profile=next;dirty=false;showProfile();notify('Your profile is saved.');
  });
};
$('signOut').onclick=()=>action($('signOut'),async()=>{await db.signOut();location.replace(role+'-login.html');});
function teardown(){quizLibrary?.destroy();quizLibrary=null;epoch++;subscriptions.forEach(fn=>fn());subscriptions=[];history=[];profile=null;user=null;dirty=false;draftPhoto='';$('createdCard').hidden=true;$('createdCode').textContent='';$('search').value='';$('filter').value='all';if($('className'))$('className').value='';if($('joinCode'))$('joinCode').value='';$('app').hidden=true;$('loading').hidden=false;$('notice').hidden=true;}
db.observeAccount(account=>{
  teardown();const mine=epoch;
  if(!account||account.isAnonymous){location.replace(role+'-login.html');return;}
  user=account;profile={...defaults,displayName:account.displayName||account.email?.split('@')[0]||role};showProfile();render();
  $('loading').hidden=true;$('app').hidden=false;
  if(teacher)quizLibrary=new QuizLibrary($('quizLibrary'),user.uid,fail);
  const badgeArea=$('ownBadges');badgeArea.replaceChildren();subscriptions.push(quizAPI.list(`users/${user.uid}/achievements`,rows=>{if(mine!==epoch)return;badgeArea.replaceChildren();for(const row of rows){const item=document.createElement('span');item.className='earned-badge';item.textContent=row.badge;badgeArea.append(item);}if(!rows.length)badgeArea.textContent='Your earned badges will appear here.';},e=>{if(mine===epoch)fail(e);}));
  subscriptions.push(db.watchProfile(user.uid,role,data=>{if(mine!==epoch)return;profile={...defaults,...data};showProfile();},e=>{if(mine===epoch)fail(e);}));
  subscriptions.push(db.watchHistory(user.uid,role,rows=>{if(mine!==epoch)return;history=rows;render();},e=>{if(mine===epoch)fail(e);}));
});
window.addEventListener('pagehide',teardown);
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
