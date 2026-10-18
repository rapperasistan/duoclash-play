// The couple's video call, the same one the iPhone app joins (server/calls.js): the server only
// introduces the two sides; the video goes straight between them, or through Cloudflare's relay.
// Whoever was there first makes the offer when the other arrives. The messages are the app's
// (Multimobile/Model/Call): { type: 'offer' | 'answer', sdp } and { type: 'candidate', candidate: { sdp, sdpMLineIndex, sdpMid } }.
import { SOCKETS, token } from './api.js';

export class Call extends EventTarget {
  status = 'idle'; // idle, waiting, connecting, connected, failed
  partnerAway = false;
  mic = true;
  camera = true;
  local = null;
  remote = null;
  failure = null;
  group = null;

  #socket = null;
  #peer = null;
  #client = null;
  #ice = undefined;
  #offerer = false;
  #queued = [];
  #reconnects = 0;
  #restarts = 0;
  #retry = null;
  #check = null;

  get on() { return this.status !== 'idle' && this.status !== 'failed'; }

  /** Joins the couple's call; `ring` pushes the partner's phone (a call started on purpose, not by walking into a game). */
  async start(group, { ring = false } = {}) {
    if (this.on && this.group === group) return;
    if (this.on) this.hangUp();
    this.group = group;
    this.failure = null;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
      });
    } catch {
      this.#fail('Allow the camera and microphone to video chat.');
      return;
    }
    this.local.getAudioTracks().forEach((track) => (track.enabled = this.mic));
    this.local.getVideoTracks().forEach((track) => (track.enabled = this.camera));
    this.#client = crypto.randomUUID();
    this.#reconnects = 0;
    this.status = 'waiting';
    this.#fresh();
    this.#connect(ring);
    this.#changed();
  }

  hangUp() {
    clearTimeout(this.#retry);
    clearTimeout(this.#check);
    const socket = this.#socket;
    this.#socket = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'leave' }));
    socket?.close();
    this.#peer?.close();
    this.#peer = null;
    this.local?.getTracks().forEach((track) => track.stop());
    this.local = null;
    this.remote = null;
    this.partnerAway = false;
    this.group = null;
    this.status = 'idle';
    this.#changed();
  }

  toggleMic() {
    this.mic = !this.mic;
    this.local?.getAudioTracks().forEach((track) => (track.enabled = this.mic));
    this.#changed();
  }

  toggleCamera() {
    this.camera = !this.camera;
    this.local?.getVideoTracks().forEach((track) => (track.enabled = this.camera));
    this.#changed();
  }

  #changed() { this.dispatchEvent(new Event('change')); }

  #fail(message) {
    this.hangUp();
    this.status = 'failed';
    this.failure = message;
    this.#changed();
  }

  #send(message) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  #connect(ring = false) {
    const socket = new WebSocket(`${SOCKETS}/groups/${this.group}/call`);
    this.#socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: token.get(), client: this.#client, ring }));
    socket.onmessage = (event) => {
      if (socket !== this.#socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      this.#hear(message).catch(() => this.#fail('The video call couldn’t connect. Try again.'));
    };
    socket.onclose = () => {
      if (socket !== this.#socket || !this.on) return;
      // The video doesn't need the server, so the call stays up while the line comes back; the
      // server keeps this side's place for 15 seconds.
      if (this.#reconnects >= 8) return this.#fail('The video call couldn’t connect. Try again.');
      this.#reconnects += 1;
      const delay = Math.min(500 * 2 ** (this.#reconnects - 1), 4000);
      this.#retry = setTimeout(() => this.on && this.#connect(), delay);
    };
  }

  /** A new connection to the partner, with this side's camera and microphone on it. */
  #fresh() {
    clearTimeout(this.#check);
    this.#peer?.close();
    this.#offerer = false;
    this.#queued = [];
    this.#restarts = 0;
    this.remote = null;
    const peer = new RTCPeerConnection({ iceServers: this.#ice ?? [{ urls: 'stun:stun.cloudflare.com:3478' }] });
    this.#peer = peer;
    for (const track of this.local?.getTracks() ?? []) peer.addTrack(track, this.local);
    peer.onicecandidate = ({ candidate }) => {
      if (peer !== this.#peer || !candidate?.candidate) return;
      this.#send({ type: 'candidate', candidate: { sdp: candidate.candidate, sdpMLineIndex: candidate.sdpMLineIndex ?? 0, sdpMid: candidate.sdpMid } });
    };
    peer.ontrack = (event) => {
      if (peer !== this.#peer) return;
      this.remote = event.streams[0] ?? new MediaStream([event.track]);
      this.#changed();
    };
    peer.oniceconnectionstatechange = () => {
      if (peer !== this.#peer) return;
      const state = peer.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        clearTimeout(this.#check);
        this.#restarts = 0;
        this.status = 'connected';
      } else if (state === 'disconnected') {
        // Often back by itself in a moment; if not, the routes need renewing.
        this.status = 'connecting';
        clearTimeout(this.#check);
        this.#check = setTimeout(() => this.#restart(), 3000);
      } else if (state === 'failed') {
        this.status = 'connecting';
        this.#restart();
      }
      this.#changed();
    };
  }

  async #offer(restart = false) {
    const offer = await this.#peer.createOffer(restart ? { iceRestart: true } : undefined);
    await this.#peer.setLocalDescription(offer);
    this.#send({ type: 'offer', sdp: offer.sdp });
  }

  /** The side that made the offer renegotiates with fresh routes (a laptop moved networks). */
  #restart() {
    const state = this.#peer?.iceConnectionState;
    if (!this.#offerer || !['disconnected', 'failed'].includes(state)) return;
    if (this.#restarts >= 3) return this.#fail('The video call couldn’t connect. Try again.');
    this.#restarts += 1;
    this.#offer(true).catch(() => {});
  }

  async #flush() {
    const waiting = this.#queued;
    this.#queued = [];
    for (const candidate of waiting) await this.#peer.addIceCandidate(candidate).catch(() => {});
  }

  async #hear(message) {
    switch (message.type) {
      case 'joined':
        this.#reconnects = 0;
        if (message.iceServers) this.#ice = message.iceServers;
        if (message.resumed) this.#restart();
        else {
          // New to the call, or the server let this side go while it was away: start over.
          this.#fresh();
          this.status = 'waiting';
        }
        break;
      case 'peer-joined':
        this.#offerer = true;
        this.status = 'connecting';
        await this.#offer();
        break;
      case 'offer':
        if (!message.sdp) return;
        if (this.status === 'waiting') this.status = 'connecting';
        await this.#peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        await this.#flush();
        {
          const answer = await this.#peer.createAnswer();
          await this.#peer.setLocalDescription(answer);
          this.#send({ type: 'answer', sdp: answer.sdp });
        }
        break;
      case 'answer':
        if (!message.sdp) return;
        await this.#peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        await this.#flush();
        break;
      case 'candidate': {
        const c = message.candidate;
        if (!c?.sdp) return;
        const candidate = { candidate: c.sdp, sdpMLineIndex: c.sdpMLineIndex ?? 0, sdpMid: c.sdpMid ?? null };
        if (this.#peer.remoteDescription) await this.#peer.addIceCandidate(candidate).catch(() => {});
        else this.#queued.push(candidate);
        return;
      }
      case 'peer-left':
        // Fresh, so the partner can come back into the same call.
        this.partnerAway = false;
        this.#fresh();
        this.status = 'waiting';
        break;
      case 'peer-away':
        this.partnerAway = true;
        break;
      case 'peer-back':
        this.partnerAway = false;
        this.#restart();
        break;
      case 'refused':
        this.hangUp();
        return;
      default:
        return;
    }
    this.#changed();
  }
}
