// The same server the iPhone app talks to (server/server.js): accounts, couples, rooms, the call.
// A page on this machine (the preview) talks to a server on this machine instead, unless ?api= says otherwise.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const asked = new URLSearchParams(location.search).get('api');
export const SITE = asked || (local ? 'http://localhost:8096' : 'https://api.esketit.app/mm');
export const BASE = `${SITE}/v1`;
export const SOCKETS = BASE.replace(/^http/, 'ws');

const KEY = 'duoclash.token';
export const token = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (value) => { try { value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY); } catch {} },
};

// The server's reasons, the way the app words them.
const REASONS = {
  no_group: 'No one has that code. Check it with your duo.',
  group_gone: 'You’re not paired any more.',
  group_full: 'That code is already taken.',
  own_code: 'That’s your own code. Send it to your duo.',
  paired: 'You’re already paired.',
  room_full: 'This room is full.',
  started: 'This game started without you.',
  not_member: 'This game isn’t yours to join.',
  no_room: 'This game is over.',
  no_name: 'Pick a name first.',
  slow: 'Too many tries. Wait a moment.',
};

export class Failure extends Error {
  constructor(message, code, status) {
    super(REASONS[code] ?? message);
    this.code = code;
    this.status = status;
  }
}

export async function call(method, path, body) {
  const headers = {};
  const signed = token.get();
  if (signed) headers.Authorization = `Bearer ${signed}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${BASE}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Failure('Can’t reach Duo Clash. Check your connection.', 'offline', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Failure(data.error || 'Something went wrong. Try again.', data.code, response.status);
  return data;
}

export const faceLink = (id) => `${BASE}/faces/${encodeURIComponent(id)}`;
