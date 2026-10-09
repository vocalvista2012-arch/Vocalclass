import { auth } from './firebase-config.js';
import {getStorage,ref,uploadBytes,getBytes} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js';
import {classroomConfig as config} from './classroom-config.js';
import {quizAPI as api} from './quiz-api.js';
const storage=getStorage(auth.app),$=id=>document.getElementById(id);
let pdfLibrary;
async function pdfjs(){if(!pdfLibrary){pdfLibrary=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.mjs');pdfLibrary.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.mjs';}return pdfLibrary;}
export class LessonPresentation{
 constructor({code,sessionId,teacher,store,report}){Object.assign(this,{code,sessionId,teacher,store,report});this.base=`liveClassrooms/${code}/sessions/${sessionId}`;this.generation=0;this.queue=Promise.resolve();this.dead=false;this.zoom=1;this.state=null;this.pdf=null;this.path=null;
  $('presentationControls').hidden=!teacher;this.off=store.watch(`${this.base}/state/presentation`,s=>{this.state=s;this.refresh();},report);
  $('uploadPDF').onchange=e=>this.upload(e.target.files[0]);$('uploadPPT').onchange=e=>this.upload(e.target.files[0]);
  for(const [id,action] of [['previousPage',()=>this.change({page:Math.max(1,(this.state?.page||1)-1)})],['nextPage',()=>this.change({page:Math.min(this.pdf?.numPages||1,(this.state?.page||1)+1)})],['zoomIn',()=>this.change({zoom:Math.min(3,(this.state?.zoom||1)+.25)})],['zoomOut',()=>this.change({zoom:Math.max(.5,(this.state?.zoom||1)-.25)})],['fitPresentation',()=>this.change({zoom:1})],['closePresentation',()=>this.change({open:false})]])$(id).onclick=()=>action().catch(report);
  $('presentationFullscreen').onclick=()=>$('presentationPane').requestFullscreen().catch(report);
  this.resize=new ResizeObserver(()=>{if(this.state?.open)this.refresh();});this.resize.observe($('presentationPane'));
 }
 async change(patch){if(!this.teacher)return;await api.call('presentationAction',{code:this.code,sessionId:this.sessionId,patch});}
 async upload(file){if(!file||!this.teacher)return;const inputs=[$('uploadPDF'),$('uploadPPT')];inputs.forEach(i=>i.disabled=true);$('presentationStatus').textContent='Preparing lesson…';try{
  if(file.size>15*1024*1024)throw Error('Choose a lesson smaller than 15 MB.');let bytes=new Uint8Array(await file.arrayBuffer());const ext=file.name.split('.').pop().toLowerCase();
  if(['ppt','pptx'].includes(ext)){if(!config.presentationConverter)throw Error('PowerPoint conversion is not configured yet. Deploy the included converter, or export your slides to PDF.');const url=new URL(config.presentationConverter);if(url.protocol!=='https:')throw Error('The presentation converter requires HTTPS.');url.searchParams.set('code',this.code);url.searchParams.set('ext',ext);const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+await auth.currentUser.getIdToken(),'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(75000)});if(!response.ok)throw Error('PowerPoint conversion failed. Export the file to PDF and retry.');bytes=new Uint8Array(await response.arrayBuffer());}else if(ext!=='pdf')throw Error('Choose a PDF, PPT or PPTX file.');
  if(bytes.length>20*1024*1024)throw Error('The converted file exceeds 20 MB.');const lib=await pdfjs(),checkTask=lib.getDocument({data:bytes.slice(),isEvalSupported:false}),check=await checkTask.promise;const pages=check.numPages;await checkTask.destroy();if(pages>200)throw Error('Use a lesson with at most 200 pages.');
  const path=`lessons/${this.code}/${this.sessionId}/${crypto.randomUUID()}.pdf`;await uploadBytes(ref(storage,path),bytes,{contentType:'application/pdf'});await this.change({path,title:file.name.slice(0,150),page:1,pages,zoom:1,open:true});$('presentationStatus').textContent='Lesson ready.';
 }catch(e){this.report(e);$('presentationStatus').textContent='Upload failed. You can retry.';}finally{inputs.forEach(i=>{i.disabled=false;i.value='';});}}
 refresh(){const mine=++this.generation;this.queue=this.queue.catch(()=>{}).then(async()=>{if(mine!==this.generation||this.dead)return;const s=this.state;$('presentationPane').hidden=!s?.open;if(!s?.open)return;try{
  if(s.path!==this.path){const bytes=await getBytes(ref(storage,s.path),20*1024*1024),lib=await pdfjs();if(this.dead||mine!==this.generation)return;await this.loadingTask?.destroy();this.loadingTask=lib.getDocument({data:bytes,isEvalSupported:false});this.pdf=await this.loadingTask.promise;this.path=s.path;}
  if(mine!==this.generation||this.dead)return;const page=await this.pdf.getPage(Math.min(this.pdf.numPages,Math.max(1,s.page)));const container=$('presentationViewport'),canvas=$('lessonPage'),original=page.getViewport({scale:1});const width=Math.max(250,container.clientWidth-24);const scale=Math.min(3,(width/original.width)*(s.zoom||1));const viewport=page.getViewport({scale});canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;$('presentationStatus').textContent=`${s.title} · ${s.page} / ${this.pdf.numPages}`;
 }catch(e){this.report(e);}});}
 destroy(){this.dead=true;this.generation++;this.off();this.resize.disconnect();this.queue.finally(()=>this.loadingTask?.destroy()).catch(()=>{});}
}
