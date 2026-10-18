// A game room's live line (WS /v1/rooms/:id/live in server/server.js): the server runs the game and
// sends the whole room after every change; this side says who it is, then sends its moves.
import { SOCKETS, token } from './api.js';

export class RoomLine extends EventTarget {
  room = null;
  refusal = null; // { code, error }: the line closed for good
  problem = null; // { code, error }: a move turned down, the line stays
  // When the room's clock runs out, on this machine's clock.
  endsAt = null;

  #socket = null;
  #id = null;
  #tries = 0;
  #retry = null;

  open(id, room = null) {
    this.close();
    this.#id = id;
    this.room = room;
    this.refusal = null;
    this.#tries = 0;
    this.#connect();
  }

  close() {
    clearTimeout(this.#retry);
    const socket = this.#socket;
    this.#socket = null;
    this.#id = null;
    socket?.close();
  }

  send(type, fields = {}) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify({ type, ...fields }));
  }

  #connect() {
    const id = this.#id;
    const socket = new WebSocket(`${SOCKETS}/rooms/${id}/live`);
    this.#socket = socket;
    socket.onopen = () => {
      this.#tries = 0;
      socket.send(JSON.stringify({ type: 'hello', token: token.get() }));
    };
    socket.onmessage = (event) => {
      if (socket !== this.#socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'room') {
        this.room = message.room;
        this.endsAt = message.room.remainingMs == null ? null : performance.now() + message.room.remainingMs;
        this.problem = null;
        this.dispatchEvent(new Event('room'));
      } else if (message.type === 'refused') {
        this.refusal = { code: message.code, error: message.error };
        this.#socket = null;
        this.dispatchEvent(new Event('refused'));
      } else if (message.type === 'problem') {
        this.problem = { code: message.code, error: message.error };
        this.dispatchEvent(new Event('problem'));
      } else if (message.type === 'signal') {
        this.dispatchEvent(Object.assign(new Event('signal'), { signal: message }));
      }
    };
    socket.onclose = () => {
      if (socket !== this.#socket) return;
      // Dropped: back in a moment, to the same seat.
      if (this.#tries >= 10) {
        this.refusal = { code: 'offline', error: 'The connection to the game dropped.' };
        this.dispatchEvent(new Event('refused'));
        return;
      }
      this.#tries += 1;
      this.#retry = setTimeout(() => this.#id === id && this.#connect(), Math.min(400 * 2 ** this.#tries, 5000));
    };
  }
}

/** Seconds left on the room's clock, or null. */
export function secondsLeft(line) {
  return line.endsAt == null ? null : Math.max(0, (line.endsAt - performance.now()) / 1000);
}
