// Transport-independent WebRTC: Firestore is only the signaling adapter.
export class ClassroomPeer {
  constructor({ initiator, media, iceServers, signal, onTrack, onState, onError }) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.signal = signal;
    this.initiator = initiator;
    this.onError = onError;
    this.pending = [];
    this.seen = new Set();
    this.unsubs = [];
    this.queue = Promise.resolve();
    this.revision = null;
    this.remoteRevision = null;
    this.closed = false;
    this.retries = 0;
    this.restartTimer = null;
    this.senders = {};
    this.media = media;
    // Stable slots preserve the microphone while the teacher shares a screen.
    for (const [key, kind] of (initiator ? [['audio','audio'], ['camera','video'], ['screen','video']] : [])) {
      const track = media[key] || null;
      const transceiver = this.pc.addTransceiver(track || kind, {
        direction: 'sendrecv',
        ...(track ? { streams: [new MediaStream([track])] } : {})
      });
      this.senders[key] = transceiver.sender;
    }
    this.pc.ontrack = e => {
      const index = this.pc.getTransceivers().indexOf(e.transceiver);
      onTrack(['audio','camera','screen'][index], e.track);
    };
    this.pc.onicecandidate = e => {
      if (e.candidate && !this.closed) signal.candidate({ revision: this.revision, candidate: e.candidate.toJSON() }).catch(onError);
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      onState(state);
      if (state === 'connected') { this.retries = 0; clearTimeout(this.restartTimer); this.restartTimer = null; }
      if (initiator && (state === 'failed' || state === 'disconnected') && !this.restartTimer) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (!this.closed && this.pc.connectionState !== 'connected' && this.retries++ < 3) this.enqueue(() => this.offer(true));
        }, state === 'failed' ? 1000 : 8000);
      }
    };
    this.unsubs.push(signal.watchCandidates((id, message) => {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      this.enqueue(async () => {
        this.pending.push(message);
        await this.flushCandidates();
      });
    }, onError));
    this.unsubs.push(signal.watchDescription(message => this.enqueue(() => this.description(message)), onError));
    if (initiator) this.enqueue(() => this.offer(false));
  }
  enqueue(task) {
    this.queue = this.queue.then(() => { if (!this.closed) return task(); }).catch(error => { if (!this.closed) this.onError(error); });
    return this.queue;
  }
  async offer(restart) {
    if (this.pc.signalingState !== 'stable') {
      if (this.pc.signalingState === 'have-local-offer') await this.pc.setLocalDescription({ type: 'rollback' });
      else return;
    }
    this.revision = crypto.randomUUID();
    await this.pc.setLocalDescription(await this.pc.createOffer({ iceRestart: restart }));
    await this.signal.description({ revision: this.revision, type: 'offer', sdp: this.pc.localDescription.sdp });
  }
  async description(message) {
    if (!message?.sdp || !message.revision) return;
    if (this.initiator) {
      if (message.type !== 'answer' || message.revision !== this.revision || this.pc.signalingState !== 'have-local-offer') return;
      await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
    } else {
      if (message.type !== 'offer' || message.revision === this.revision) return;
      this.revision = message.revision;
      await this.pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      // Answer using the transceivers created by the remote offer. Creating
      // independent transceivers before it would leave the student's tracks on
      // unassociated m-lines, making the answer receive-only.
      for (const [index, key] of ['audio','camera','screen'].entries()) {
        const transceiver = this.pc.getTransceivers()[index];
        transceiver.direction = 'sendrecv';
        this.senders[key] = transceiver.sender;
        await transceiver.sender.replaceTrack(this.media[key] || null);
      }
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await this.signal.description({ revision: this.revision, type: 'answer', sdp: this.pc.localDescription.sdp });
    }
    this.remoteRevision = message.revision;
    await this.flushCandidates();
  }
  async flushCandidates() {
    if (!this.pc.remoteDescription || this.remoteRevision !== this.revision) return;
    const waiting = [];
    for (const item of this.pending) {
      // Candidates can precede the offer/answer. Keep other generations queued.
      if (item.revision === this.revision) await this.pc.addIceCandidate(item.candidate);
      else waiting.push(item);
    }
    this.pending = waiting.slice(-256);
  }
  async replace(key, track) { this.media[key] = track; if (!this.closed && this.senders[key]) await this.senders[key].replaceTrack(track); }
  restart() { return this.initiator ? this.enqueue(() => this.offer(true)) : Promise.resolve(); }
  close() {
    this.closed = true;
    clearTimeout(this.restartTimer);
    this.unsubs.forEach(unsubscribe => unsubscribe());
    this.pc.onconnectionstatechange = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.close();
    this.pending = [];
  }
}
