export class ClassroomBoard {
  constructor(canvas, { editable, save, report }) {
    this.canvas = canvas; this.editable = editable; this.save = save; this.report = report;
    this.strokes = []; this.redoStack = []; this.pending = null; this.tool = 'pen';
    this.color = '#273858'; this.size = 4; this.busy = false;
    this.resize = new ResizeObserver(() => this.render()); this.resize.observe(canvas);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', () => this.finish());
    canvas.addEventListener('pointercancel', () => { this.pending = null; this.render(); });
  }
  position(e) { const r = this.canvas.getBoundingClientRect(); return [Math.round(Math.max(0,Math.min(1600,(e.clientX-r.left)*1600/r.width))),Math.round(Math.max(0,Math.min(900,(e.clientY-r.top)*900/r.height)))]; }
  down(e) {
    if (!this.editable || this.busy || e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const points = this.position(e);
    this.pending = { tool: this.tool, color: this.color, size: this.size, points };
    if (this.tool === 'text') {
      const text = prompt('Text for the whiteboard (up to 200 characters)');
      if (text?.trim()) { this.pending.text = text.trim().slice(0,200); this.finish(); }
      else this.pending = null;
    }
  }
  move(e) {
    if (!this.pending) return;
    const points = this.position(e);
    if (['line','rect','circle'].includes(this.tool)) this.pending.points = this.pending.points.slice(0,2).concat(points);
    else if (this.pending.points.length < 600) this.pending.points.push(...points);
    this.render();
  }
  async finish() {
    if (!this.pending) return;
    const next = this.strokes.concat(this.pending); this.pending = null;
    if (next.length > 180 || JSON.stringify(next).length > 400000) { this.report('This board is full. Download it, then clear the board to continue.'); this.render(); return; }
    await this.commit(next, []);
  }
  async commit(next, redo) {
    if (this.busy) return;
    this.busy = true;
    try { await this.save(next); this.strokes = next; this.redoStack = redo; this.render(); }
    catch(e) { this.report('Whiteboard could not save: ' + e.message); this.render(); }
    finally { this.busy = false; }
  }
  undo() { if (this.strokes.length) return this.commit(this.strokes.slice(0,-1), this.redoStack.concat(this.strokes.at(-1))); }
  redo() { if (this.redoStack.length) return this.commit(this.strokes.concat(this.redoStack.at(-1)), this.redoStack.slice(0,-1)); }
  clear() { return this.commit([], this.strokes.slice().reverse()); }
  receive(strokes) { this.strokes = Array.isArray(strokes) ? strokes : []; this.render(); }
  render() {
    const c = this.canvas, r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    c.width = Math.round(r.width*d); c.height = Math.round(r.height*d);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,c.width,c.height); x.scale(c.width/1600,c.height/900);
    for (const s of [...this.strokes, ...(this.pending ? [this.pending] : [])]) {
      if (!Array.isArray(s.points)) continue;
      const [a,b,u=a+1,v=b+1] = s.points;
      x.save(); x.strokeStyle = s.tool === 'eraser' ? '#fff' : s.color;
      x.fillStyle = s.color; x.lineWidth = s.tool === 'highlighter' ? s.size*5 : s.tool === 'eraser' ? s.size*5 : s.size;
      x.lineCap = 'round'; x.lineJoin = 'round'; x.globalAlpha = s.tool === 'highlighter' ? .25 : 1;
      if (s.tool === 'text') { x.font = `${Math.max(24,s.size*6)}px Arial`; x.fillText(s.text || '',a,b); }
      else if (s.tool === 'rect') x.strokeRect(a,b,u-a,v-b);
      else if (s.tool === 'circle') { x.beginPath(); x.ellipse((a+u)/2,(b+v)/2,Math.abs(u-a)/2,Math.abs(v-b)/2,0,0,Math.PI*2); x.stroke(); }
      else { x.beginPath(); x.moveTo(a,b); if(s.points.length===2) x.lineTo(a+.1,b+.1); for(let i=2;i<s.points.length;i+=2)x.lineTo(s.points[i],s.points[i+1]); x.stroke(); }
      x.restore();
    }
  }
  download() { const a = document.createElement('a'); a.download = 'vocalclass-whiteboard.png'; a.href = this.canvas.toDataURL('image/png'); a.click(); }
  destroy() { this.resize.disconnect(); }
}
