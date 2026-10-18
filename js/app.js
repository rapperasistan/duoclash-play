// Duo Clash on the web (play.duoclash.app): the two of you and every game, with the same accounts,
// couples, rooms and video call as the iPhone app, so either of you can play from a browser.
//   browse:  open to anyone: the two of you this week at the top, every game below, a page for each
//   join:    only when Play is pressed: a name and a face, then pairing (play.duoclash.app/#pair/123456
//            pairs straight away), then the game opens
//   room:    #room/<id>, the game itself, with the two cameras beside it
import { call, token } from './api.js';
import { avatarSVG, AVATARS, face } from './avatar.js';
import { Call } from './call.js';
import { icon } from './icons.js';
import { RoomLine, secondsLeft } from './room.js';
import xox from './games/xox.js';
import fourRow from './games/fourRow.js';

// The games the web plays so far; the rest are the app's until they're here too.
const PLAYABLE = { xox, fourRow };
const CATALOG = window.GAMES ?? [];
const SHELVES = [
  { id: 'words', title: 'Word games' },
  { id: 'numbers', title: 'Number games' },
  { id: 'memory', title: 'Memory & speed' },
  { id: 'logic', title: 'Strategy' },
];

const game = (id) => CATALOG.find((g) => g.id === id);
const gameTitle = (id) => game(id)?.title ?? 'A game';
const art = (id, shape) => `assets/games/${id}-${shape}.jpg`;
// Until a shape is drawn for a game, its poster stands in.
const img = (id, shape, extra = '') => `<img src="${art(id, shape)}" onerror="this.onerror=null;this.src='${art(id, 'poster')}'" alt="" ${extra}>`;
const shelfTitle = (category) => SHELVES.find((s) => s.id === category)?.title ?? '';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const language = () => (navigator.language || 'en').split('-')[0].toLowerCase();
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const app = $('.app');
const view = $('#view');
const tiles = $('#call');
const detail = $('#detail');
const state = { me: null, couple: null, waiting: null, name: '' };
const session = new Call();
const line = new RoomLine();
let poll = null;
let tick = null;
let before = null; // the room as it was before its last change, for what's new on the board
let opened = null; // the room whose line is open

// Small things

function toast(text, kind = '') {
  const box = $('#toast');
  box.textContent = text;
  box.className = `toast show ${kind}`;
  clearTimeout(box.hide);
  box.hide = setTimeout(() => (box.className = 'toast'), 3600);
}

function show(name, html) {
  app.dataset.view = name;
  view.innerHTML = html;
  scrollTo(0, 0);
  renderNav();
  renderTiles();
}

function partner() {
  return state.couple?.members.find((member) => member.id !== state.me?.id) ?? null;
}

function applyHome(home) {
  state.me = home.me;
  const groups = home.groups ?? [];
  state.couple = groups.find((group) => group.members.length >= 2) ?? null;
  state.waiting = groups.find((group) => group.members.length < 2) ?? null;
}

// The bar: see-through over the banner, solid once the page moves.
addEventListener('scroll', () => $('#nav').classList.toggle('solid', scrollY > 10), { passive: true });

function renderNav() {
  const browsing = app.dataset.view === 'browse';
  $('#links').innerHTML = browsing
    ? `<a href="#" data-go-home class="on">Home</a>${SHELVES.map((s) => `<a href="#" data-shelf="${s.id}">${s.title}</a>`).join('')}`
    : '';
  const them = partner();
  const tools = $('#tools');
  if (!state.me || !state.couple) {
    tools.innerHTML = `${state.me ? `<button class="duo-chip" data-menu aria-label="You">${face(state.me, 32)}${icon('down')}</button>` : ''}
      <button class="btn red" data-start-join>${state.me ? 'Pair now' : 'Get started'}</button>`;
    $('[data-start-join]', tools).addEventListener('click', () => onboard());
    $('[data-menu]', tools)?.addEventListener('click', openMenu);
    return;
  }
  tools.innerHTML = `<button class="duo-chip" data-menu aria-label="You and ${esc(them?.name)}">${face(state.me, 32)}${face(them, 32)}${icon('down')}</button>`;
  $('[data-menu]', tools).addEventListener('click', openMenu);
}

document.addEventListener('click', (event) => {
  const home = event.target.closest('[data-go-home]');
  if (home) {
    event.preventDefault();
    if (location.hash) location.hash = '';
    else {
      applyFilter('all');
      scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    }
    return;
  }
  const shelf = event.target.closest('[data-shelf]');
  if (shelf) {
    event.preventDefault();
    applyFilter(shelf.dataset.shelf);
    const library = document.getElementById('library');
    if (library) scrollTo({ top: library.getBoundingClientRect().top + scrollY - 80, behavior: still ? 'auto' : 'smooth' });
  }
});

// Start

async function boot() {
  const invite = location.hash.match(/^#pair\/(\d{6})$/)?.[1];
  if (invite) {
    sessionStorage.setItem('invite', invite);
    history.replaceState(null, '', location.pathname);
  }
  if (token.get()) {
    try {
      applyHome(await call('GET', 'me'));
    } catch (error) {
      if (error.status === 401) token.set(null);
      else toast(error.message, 'bad');
    }
  }
  route();
  // Someone's invite link: straight to pairing with it.
  if (sessionStorage.getItem('invite') && !state.couple) onboard();
}

/** Where the address says to be: a game (for a couple), or the games. Anyone can look around. */
function route() {
  clearInterval(poll);
  poll = null;
  const roomId = location.hash.match(/^#room\/([\w-]+)$/)?.[1];
  if (roomId && state.couple) return enterRoom(roomId);
  if (roomId) history.replaceState(null, '', location.pathname);
  if (opened) leaveRoom();
  browse();
}

addEventListener('hashchange', route);

// Getting in: asked only when someone presses Play. A name and a face make the account (no email,
// no password, like the app), then pairing with a code to give or one to type, then the game opens.

const join = $('#join');
let afterJoin = null;
let pairPoll = null;

function onboard(next = null) {
  afterJoin = next;
  if (!state.me) askName();
  else if (!state.couple) askPair();
  if (!join.open) join.showModal();
}

function finishJoin() {
  clearInterval(pairPoll);
  join.close();
  if (app.dataset.view === 'browse') browse();
  const next = afterJoin;
  afterJoin = null;
  next?.();
}

join.addEventListener('close', () => clearInterval(pairPoll));
join.addEventListener('click', (event) => {
  if (event.target === join || event.target.closest('[data-x]')) join.close();
});

function askName() {
  let avatar = Math.floor(Math.random() * AVATARS);
  join.innerHTML = `<form class="join-in" data-name>
    <button type="button" class="circle close" data-x aria-label="Close">${icon('close')}</button>
    <p class="kicker"><img src="assets/icon-512.png" alt="">Step 1 of 2</p>
    <h2>Who’s playing?</h2>
    <p class="dim">A name and a face. No email, no password.</p>
    <label class="float"><input name="name" maxlength="20" autocomplete="nickname" placeholder=" " required><span>Your name</span></label>
    <div class="face-grid">${Array.from({ length: AVATARS }, (_, i) => `
      <button type="button" class="face-pick ${i === avatar ? 'on' : ''}" data-avatar="${i}" aria-label="Face ${i + 1}">${avatarSVG(i)}</button>`).join('')}
    </div>
    <button class="btn red wide big" type="submit">Continue ${icon('next')}</button>
    <p class="fine">By continuing you agree to the <a href="https://duoclash.app/terms.html" target="_blank">Terms</a> and the <a href="https://duoclash.app/privacy.html" target="_blank">Privacy Policy</a>.</p>
  </form>`;
  const form = $('[data-name]', join);
  form.addEventListener('click', (event) => {
    const button = event.target.closest('[data-avatar]');
    if (!button) return;
    avatar = Number(button.dataset.avatar);
    $$('[data-avatar]', form).forEach((b) => b.classList.toggle('on', b === button));
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const made = await call('POST', 'accounts', { name: form.name.value, avatar });
      token.set(made.token);
      applyHome(await call('GET', 'me'));
      renderNav();
      if (state.couple) finishJoin();
      else askPair();
    } catch (error) {
      toast(error.message, 'bad');
      submit.disabled = false;
    }
  });
  setTimeout(() => form.name.focus(), 50);
}

async function askPair() {
  const invite = sessionStorage.getItem('invite');
  if (invite) {
    sessionStorage.removeItem('invite');
    try {
      await call('POST', 'groups/join', { code: invite });
      applyHome(await call('GET', 'me'));
      if (state.couple) {
        toast(`Paired with ${partner()?.name}. Time to play.`);
        return finishJoin();
      }
    } catch (error) {
      toast(error.message, 'bad');
    }
  }
  if (!state.waiting) {
    try {
      state.waiting = (await call('POST', 'groups')).group;
    } catch (error) {
      toast(error.message, 'bad');
      return join.close();
    }
  }
  const code = state.waiting.code;
  const link = `${location.origin}${location.pathname}#pair/${code}`;
  join.innerHTML = `<div class="join-in pairing">
    <button type="button" class="circle close" data-x aria-label="Close">${icon('close')}</button>
    <p class="kicker"><img src="assets/icon-512.png" alt="">Step 2 of 2</p>
    <h2>Who are you playing with?</h2>
    <p class="dim">Send them your link, or read them the code. As soon as they’re in, this becomes your space.</p>
    <div class="code" aria-label="Your code ${code}">${[...code].map((d, i) => `<span style="--i:${i}">${d}</span>`).join('')}</div>
    <div class="row left">
      <button class="btn play" data-copy>${icon('copy')} Copy link</button>
      ${navigator.share ? `<button class="btn ghost" data-share>Share</button>` : ''}
      <span class="waiting"><i></i> Waiting for them</span>
    </div>
    <form class="their" data-join>
      <span class="or">Got their code instead?</span>
      <div class="row left"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" class="code-input" required>
      <button class="btn red" type="submit">Pair</button></div>
    </form>
  </div>`;
  $('[data-copy]', join).onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied. Send it their way.');
    } catch {
      toast(link);
    }
  };
  $('[data-share]', join)?.addEventListener('click', () => navigator.share({ title: 'Duo Clash', text: `Pair with me on Duo Clash: ${code}`, url: link }).catch(() => {}));
  const form = $('[data-join]', join);
  form.code.addEventListener('input', () => (form.code.value = form.code.value.replace(/\D/g, '').slice(0, 6)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await call('POST', 'groups/join', { code: form.code.value });
      applyHome(await call('GET', 'me'));
      toast(`Paired with ${partner()?.name}. Time to play.`);
      finishJoin();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  // The other side pairing with this code shows up here.
  clearInterval(pairPoll);
  pairPoll = setInterval(async () => {
    try {
      applyHome(await call('GET', 'me'));
      if (state.couple) {
        toast(`${partner()?.name} paired with you. Time to play.`);
        finishJoin();
      }
    } catch {}
  }, 3000);
}

// Browsing: the two of you at the top, then every game

const ago = (at) => {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

function card(g) {
  const here = Boolean(PLAYABLE[g.id]);
  return `<article class="card ${here ? 'here' : 'soon'}" data-detail="${g.id}" data-cat="${g.category}" data-here="${here}" tabindex="0">
    ${img(g.id, 'poster', 'loading="lazy"')}
    ${here ? '' : '<span class="soon-tag">Soon</span>'}
    <div class="cap"><b>${esc(g.title)}</b><small>${esc(g.kind)}</small></div>
    ${here ? `<button class="play-dot" data-play="${g.id}" aria-label="Play ${esc(g.title)}">${icon('play')}</button>` : ''}
  </article>`;
}

let filter = 'all';

function browse() {
  // The ones that play here first, then the rest as they come.
  const games = [...CATALOG.filter((g) => PLAYABLE[g.id]), ...CATALOG.filter((g) => !PLAYABLE[g.id])];
  const filters = [{ id: 'all', title: 'All games' }, { id: 'here', title: 'Play now' }, ...SHELVES];
  show('browse', `
  <section class="duo-head" data-head></section>
  <section class="library" id="library">
    <div class="library-head">
      <h2>Games</h2>
      <div class="filters">${filters.map((f) => `<button class="filter ${f.id === filter ? 'on' : ''}" data-filter="${f.id}">${f.title}</button>`).join('')}</div>
    </div>
    <div class="grid" data-grid>${games.map(card).join('')}</div>
  </section>
  <section class="ask">
    <div><h2>What should we make next?</h2><p class="dim">New games land every week. Tell us the one you two want.</p></div>
    <a class="btn play" href="mailto:support@duoclash.app?subject=Game%20idea%20for%20Duo%20Clash">Suggest a game</a>
  </section>
  <footer class="foot">
    <a href="https://duoclash.app">About Duo Clash</a><a href="https://duoclash.app/privacy.html">Privacy</a><a href="https://duoclash.app/terms.html">Terms</a><a href="https://duoclash.app/support.html">Support</a>
    <span>© 2026 Duo Clash</span>
  </footer>`);
  renderHead();
  applyFilter(filter);
  $$('[data-filter]').forEach((button) => (button.onclick = () => applyFilter(button.dataset.filter)));
  if (state.couple) poll = setInterval(refreshCouple, 3000);
}

/** The grid shows one kind of game, or all of them; the bar's links pick one too. */
function applyFilter(id) {
  filter = id;
  $$('[data-filter]').forEach((button) => button.classList.toggle('on', button.dataset.filter === id));
  $$('#links [data-shelf]').forEach((link) => link.classList.toggle('on', link.dataset.shelf === id));
  $('#links [data-go-home]')?.classList.toggle('on', id === 'all');
  $$('[data-grid] .card').forEach((cardEl) => {
    cardEl.hidden = !(id === 'all' || (id === 'here' ? cardEl.dataset.here === 'true' : cardEl.dataset.cat === id));
  });
}

// What a guest (or someone not paired yet) sees at the top: a made-up couple's week, said to be one.
const HOUR = 3600000;
const SAMPLE = {
  me: { id: 'sample-leo', name: 'Leo', avatar: 3 },
  them: { id: 'sample-mia', name: 'Mia', avatar: 4 },
  points: { 'sample-leo': 9, 'sample-mia': 12 },
  matches: [
    { game: 'xox', winner: 'sample-leo', scores: { 'sample-leo': 3, 'sample-mia': 1 }, ago: 2 * HOUR },
    { game: 'fourRow', winner: 'sample-mia', scores: { 'sample-leo': 2, 'sample-mia': 3 }, ago: 5 * HOUR },
    { game: 'guessCelebrity', winner: null, scores: { 'sample-leo': 2, 'sample-mia': 2 }, ago: 26 * HOUR },
    { game: 'chess', winner: 'sample-mia', scores: { 'sample-leo': 0, 'sample-mia': 1 }, ago: 50 * HOUR },
  ],
  owed: [{ id: 'sample', text: 'Breakfast in bed', winner: 'sample-mia' }],
};

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** "3d 4h left", like the app. */
function timeLeft(endsAt) {
  const minutes = Math.max(1, Math.floor((endsAt - Date.now()) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h left` : `${hours}h ${minutes % 60}m left`;
}

/** Next Monday, 00:00 UTC, when the server starts a new week. */
function nextMonday() {
  const now = new Date();
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  return monday + 7 * 86400000;
}

/**
 * The top of the page is the couple's own space: the two of them by name, this week's podium the way
 * the app has it (the leader in the middle under a crown), and the games they've played lately with
 * any stakes still owed. Before there's a couple, a made-up one shows how it looks, and says so.
 */
function renderHead() {
  const box = $('[data-head]');
  if (!box) return;
  const real = Boolean(state.couple);
  const couple = state.couple;
  const me = real ? state.me : SAMPLE.me;
  const them = real ? partner() : SAMPLE.them;
  const points = (id) => (real ? couple.board?.find((row) => row.id === id)?.points ?? 0 : SAMPLE.points[id]);
  // In your own space you're "You"; in the made-up one everyone has a name.
  const called = (person) => (real && person.id === me.id ? 'You' : esc(person.name));
  const people = [me, them].filter(Boolean).map((person) => ({ person, points: points(person.id) }));
  people.forEach((entry) => (entry.rank = 1 + people.filter((other) => other.points > entry.points).length));
  const started = people.some((entry) => entry.points > 0);
  // Second on the left, first in the middle (with two, that's the right).
  const podium = [...people].sort((a, b) => a.rank - b.rank || (a.person.id === me.id ? 1 : -1)).reverse();
  const endsAt = real ? couple.weekEndsAt : nextMonday();
  const matches = real ? (couple.matches ?? []).slice(0, 4) : SAMPLE.matches.map((match) => ({ ...match, at: Date.now() - match.ago }));
  const owed = real ? (couple.owed ?? []).slice(0, 2) : SAMPLE.owed;
  const waiting = real ? (couple.rooms ?? []).filter((room) => room.phase !== 'finished' && PLAYABLE[room.game]) : [];
  const theyreIn = real && (couple.call ?? []).includes(them?.id);

  const step = ({ person, points: score, rank }) => `<div class="step r${rank}">
    ${rank === 1 ? `<span class="crown">${icon('crown')}</span>` : ''}
    <span class="ring">${face(person, rank === 1 ? 76 : 60)}<i class="medal">${rank}</i></span>
    <b>${called(person)}</b>
    <span class="block"><strong>${score}</strong><small>pts</small></span>
  </div>`;

  // Before pairing, the bar's button is the way in.
  const act = !real ? ''
    : session.on ? `<button class="btn ghost" data-hang-call>${icon('hangUp')} End call</button>`
    : `<button class="btn ${theyreIn ? 'play ring-call' : 'ghost'}" data-call>${icon('video')} ${theyreIn ? `Join ${esc(them.name)}` : `Call ${esc(them.name)}`}</button>`;

  box.innerHTML = `
    <div class="space-top">
      <div class="pair-faces">${face(me, 54)}<span class="heart">${icon('heart')}</span>${face(them, 54)}</div>
      <div class="hello">
        <small>${state.me ? `${greeting()}, ${esc(state.me.name)}` : 'Games for two, on a video call'}</small>
        <h1>${real ? `${esc(me.name)} &amp; ${esc(them.name)}` : state.me ? `${esc(state.me.name)} &amp; …` : 'Leo &amp; Mia'}</h1>
      </div>
      <div class="space-acts">
        ${real ? '' : `<span class="sample-note">${icon('info')} ${state.me ? 'A sample couple. Your own week shows up here once you pair.' : 'A sample couple. Yours shows up here once you pair.'}</span>`}
        ${act}
      </div>
    </div>
    ${waiting.map((room) => {
      const host = room.players.find((player) => player.id === room.host);
      const yours = room.host === me.id;
      return `<button class="waiting-bar" data-join="${room.id}">${img(room.game, 'square')}
        <span><b>${yours ? `Your ${esc(gameTitle(room.game))} is still open` : `${esc(host?.name ?? them.name)} is waiting for you in ${esc(gameTitle(room.game))}`}</b><small>${room.phase === 'lobby' ? 'In the lobby' : 'Under way'}</small></span>
        <span class="btn play">${icon('play')} ${yours ? 'Back in' : 'Join'}</span></button>`;
    }).join('')}
    <div class="space-grid">
      <div class="week-board">
        <div class="board-head"><span class="trophy">${icon('trophy')}</span><h2>This week</h2><span class="left">${icon('clock')} ${timeLeft(endsAt)}</span></div>
        ${started ? `<div class="podium">${podium.map(step).join('')}</div>`
          : `<div class="nobody"><span class="crown big">${icon('crown')}</span><h3>Up for grabs</h3><p>Win a game this week to take the crown.</p></div>`}
      </div>
      <div class="lately">
        <div class="board-head"><h2>Lately</h2></div>
        ${matches.length ? `<ol>${matches.map((match) => {
          const winner = match.winner === me.id ? me : match.winner === them?.id ? them : null;
          const a = match.scores?.[me.id] ?? 0;
          const b = match.scores?.[them?.id] ?? 0;
          const score = winner === them ? `${b}–${a}` : `${a}–${b}`;
          return `<li>${img(match.game, 'square', 'loading="lazy"')}
            <span class="what"><b>${esc(gameTitle(match.game))}</b><small>${ago(match.at)}</small></span>
            <span class="who-won ${winner ? (winner === me ? 'me' : 'them') : 'tie'}">${winner ? `${face(winner, 22)}${called(winner)} won` : 'A tie'} <i>${score}</i></span>
          </li>`;
        }).join('')}</ol>` : `<p class="quiet">Nothing played yet this week. Your first game will show up here.</p>`}
        ${owed.map((item) => {
          const winner = item.winner === me.id ? me : them;
          const loser = winner === me ? them : me;
          return `<div class="ticket"><span class="pin">${icon('flag')}</span>
            <span><small>${called(loser)} ${real && loser === me ? 'owe' : 'owes'} ${real && winner === me ? 'you' : esc(winner.name)}</small><b>${esc(item.text)}</b></span>
            ${real && winner === me ? `<button class="btn ghost small" data-paid="${item.id}">Paid</button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  $$('[data-join]', box).forEach((button) => (button.onclick = () => (location.hash = `#room/${button.dataset.join}`)));
  $$('[data-start-join]', box).forEach((button) => (button.onclick = () => onboard()));
  $('[data-call]', box)?.addEventListener('click', () => session.start(couple.id, { ring: !theyreIn }));
  $('[data-hang-call]', box)?.addEventListener('click', () => session.hangUp());
  $$('[data-paid]', box).forEach((button) => (button.onclick = async () => {
    try {
      state.couple = (await call('POST', `groups/${couple.id}/paid`, { stakes: button.dataset.paid })).group;
      renderHead();
    } catch (error) {
      toast(error.message, 'bad');
    }
  }));
}

// Clicks on the games: play straight away, or open a game's page.
view.addEventListener('click', (event) => {
  const play = event.target.closest('[data-play]');
  if (play) {
    event.stopPropagation();
    return openRoom(play.dataset.play, play);
  }
  const more = event.target.closest('[data-detail]');
  if (more) openDetail(more.dataset.detail);
});
view.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('.card')) openDetail(event.target.dataset.detail);
});

/** A game's page: the big picture, how it's played, and more like it. */
function openDetail(id) {
  const g = game(id);
  if (!g) return;
  const here = Boolean(PLAYABLE[id]);
  const alike = CATALOG.filter((other) => other.category === g.category && other.id !== id).slice(0, 5);
  detail.innerHTML = `<div class="sheet-in">
    <div class="hero">${img(id, 'billboard')}<div class="fade"></div>
      <button class="circle close" data-close aria-label="Close">${icon('close')}</button>
      <div class="hero-copy"><h1>${esc(g.title)}</h1>
        <div class="acts">${here ? `<button class="btn play big" data-play-detail="${id}">${icon('play')} Play</button>` : `<span class="btn glass big soon-btn">Coming soon</span>`}</div>
      </div>
    </div>
    <div class="body">
      <div>
        <p class="meta">${here ? '<b class="go">Ready to play</b>' : '<b>Coming soon</b>'}<span class="box">2 players</span><span>${esc(g.kind)}</span></p>
        <h3>How to play</h3>
        <p class="how">${esc(g.how)}</p>
      </div>
      <dl>
        <dt>Category</dt><dd>${esc(shelfTitle(g.category))}</dd>
        <dt>Languages</dt><dd>${esc(g.language)}</dd>
        <dt>Players</dt><dd>The two of you, on a video call</dd>
      </dl>
    </div>
    ${alike.length ? `<h3 class="alike-title">More like this</h3><div class="alike">${alike.map((other) => `
      <button class="alike-card" data-other="${other.id}">${img(other.id, 'poster', 'loading="lazy"')}<span><b>${esc(other.title)}</b><small>${PLAYABLE[other.id] ? 'Ready to play' : 'Coming soon'}</small></span></button>`).join('')}</div>` : ''}
  </div>`;
  if (!detail.open) detail.showModal();
  detail.scrollTop = 0;
  $('[data-close]', detail).onclick = () => detail.close();
  $('[data-play-detail]', detail)?.addEventListener('click', (event) => {
    detail.close();
    openRoom(id, event.currentTarget);
  });
  $$('[data-other]', detail).forEach((button) => (button.onclick = () => openDetail(button.dataset.other)));
}
detail.addEventListener('click', (event) => event.target === detail && detail.close());

let lastSeen = '';

async function refreshCouple() {
  if (!state.couple) return;
  try {
    const { group } = await call('GET', `groups/${state.couple.id}`);
    const known = new Set((state.couple.rooms ?? []).map((room) => room.id));
    state.couple = group;
    // A game the partner just opened: said out loud, not only listed.
    const fresh = (group.rooms ?? []).find((room) => !known.has(room.id) && room.host !== state.me.id && room.phase === 'lobby');
    if (fresh) {
      toast(`${partner()?.name} opened ${gameTitle(fresh.game)}. Join them.`);
      document.title = `${partner()?.name} opened ${gameTitle(fresh.game)} · Duo Clash`;
    }
    // Only what changed is drawn again, and without the entrance it had the first time.
    const seen = JSON.stringify([group.board, group.matches?.slice(0, 4), group.owed, group.call, (group.rooms ?? []).map((room) => [room.id, room.phase])]);
    if (app.dataset.view === 'browse' && seen !== lastSeen) {
      lastSeen = seen;
      $('[data-head]')?.classList.add('calm');
      renderHead();
      renderNav();
    }
  } catch (error) {
    // Unpaired from the other side.
    if (error.code === 'group_gone' || error.status === 404 || error.status === 403) {
      session.hangUp();
      applyHome(await call('GET', 'me').catch(() => ({ me: state.me, groups: [] })));
      toast('You’re not paired any more.');
      route();
    }
  }
}

async function openRoom(id, button) {
  if (!PLAYABLE[id]) return openDetail(id);
  if (!state.couple) return onboard(() => openRoom(id));
  if (button) button.disabled = true;
  try {
    const { room } = await call('POST', `groups/${state.couple.id}/rooms`, { game: id, seats: 2, language: language() });
    line.open(room.id, room);
    opened = room.id;
    location.hash = `#room/${room.id}`;
  } catch (error) {
    toast(error.message, 'bad');
    if (button) button.disabled = false;
  }
}

// The room

function enterRoom(id) {
  if (opened !== id) {
    line.open(id);
    opened = id;
  }
  // The call goes on from one game to the next; walking into a game joins it, without ringing.
  if (!session.on) session.start(state.couple.id, { ring: false });
  show('room', `<section class="room">
    <div class="room-top">
      <button class="circle" data-back aria-label="Back to games">${icon('back')}</button>
      <h1 data-title></h1>
      <span class="pill" data-target></span>
    </div>
    <p class="status" data-line></p>
    <div class="board-wrap"><div class="board" data-game></div><div class="overlay" data-overlay></div></div>
  </section>`);
  $('[data-back]').onclick = () => (location.hash = '');
  renderRoom();
  clearInterval(tick);
  tick = setInterval(renderClock, 200);
}

function leaveRoom() {
  line.close();
  line.room = null;
  opened = null;
  before = null;
  clearInterval(tick);
}

const nameOf = (id) => (id === state.me?.id ? 'You' : line.room?.players.find((player) => player.id === id)?.name ?? partner()?.name ?? 'They');

line.addEventListener('room', () => {
  if (app.dataset.view === 'room') renderRoom();
  before = structuredClone(line.room);
});
line.addEventListener('problem', () => toast(line.problem.error, 'bad'));
line.addEventListener('refused', () => {
  toast(line.refusal.error, 'bad');
  opened = null;
  line.room = null;
  if (location.hash.startsWith('#room/')) location.hash = '';
});

function renderRoom() {
  const room = line.room;
  const title = $('[data-title]');
  if (!title) return;
  if (!room) {
    title.textContent = 'Joining…';
    $('[data-overlay]').innerHTML = `<div class="sheet"><div class="spinner"></div></div>`;
    renderTiles();
    return;
  }
  const rules = PLAYABLE[room.game];
  const me = state.me.id;
  title.textContent = gameTitle(room.game);
  $('[data-target]').innerHTML = room.target ? `${icon('flag')} First to ${room.target}` : '';
  $('[data-target]').hidden = !room.target;
  const send = (type, fields) => line.send(type, fields);
  const board = $('[data-game]');
  if (rules && room.phase !== 'lobby' && room.phase !== 'countdown') {
    rules.render(board, { room, me, send, before, name: nameOf });
    $('[data-line]').textContent = room.paused ? `Waiting for ${partner()?.name} to come back` : room.phase === 'finished' ? '' : rules.status({ room, me, name: nameOf });
  } else {
    board.innerHTML = '';
    $('[data-line]').textContent = '';
  }
  renderOverlay(room, rules);
  renderTiles();
}

function renderOverlay(room, rules) {
  const overlay = $('[data-overlay]');
  const me = state.me.id;
  const them = room.players.find((player) => player.id !== me);
  const theirName = esc(them?.name ?? partner()?.name);
  if (!rules) {
    overlay.innerHTML = `<div class="sheet">${img(room.game, 'poster', 'class="art"')}
      <h2>${esc(gameTitle(room.game))} is coming soon</h2>
      <p class="dim">It isn’t ready here yet. Pick one of the games that are.</p>
      <button class="btn play" data-home>Back to games</button></div>`;
    $('[data-home]', overlay).onclick = () => (location.hash = '');
    return;
  }
  if (room.phase === 'lobby') {
    const mine = room.players.find((player) => player.id === me);
    overlay.innerHTML = `<div class="sheet">${img(room.game, 'poster', 'class="art"')}
      <h2>${esc(gameTitle(room.game))}</h2>
      <p class="dim how">${esc(game(room.game)?.how ?? '')}</p>
      <div class="seats">${[mine, them].map((player) => player
        ? `<span class="seat ${player.ready ? 'ready' : ''}">${face(player, 34)}<b>${player.id === me ? 'You' : esc(player.name)}</b><small>${player.ready ? `${icon('check')} Ready` : player.here ? 'Getting ready' : 'Away'}</small></span>`
        : `<span class="seat empty"><span class="face" style="--size:34px"></span><b>${theirName}</b><small>On the way</small></span>`).join('')}</div>
      ${mine?.ready ? `<p class="dim">You’re ready. It starts when ${theirName} is.</p>` : `<button class="btn red wide" data-ready>I’m ready</button>`}
    </div>`;
    $('[data-ready]', overlay)?.addEventListener('click', () => line.send('ready'));
    return;
  }
  if (room.phase === 'countdown') {
    overlay.innerHTML = `<div class="count" data-count></div>`;
    renderClock();
    return;
  }
  if (room.phase === 'finished') {
    const you = room.players.find((player) => player.id === me);
    const result = !them || you.score === them.score ? 'A draw' : you.score > them.score ? 'You won' : `${theirName} won`;
    const rematch = room.rematch;
    let actions;
    if (rematch && rematch.yes.includes(me)) {
      actions = `<p class="dim">Waiting for ${theirName} to say they’re in…</p>`;
    } else if (rematch) {
      actions = `<p>${theirName} wants ${rematch.game === room.game ? 'another round' : `to play ${esc(gameTitle(rematch.game))}`}.</p>
        <button class="btn red wide" data-again="${rematch.game}">I’m in</button>`;
    } else {
      const others = Object.keys(PLAYABLE).filter((id) => id !== room.game);
      actions = `${room.rematchFailed ? `<p class="dim">${theirName} didn’t join that one.</p>` : ''}
        <button class="btn play wide" data-again="${room.game}">${icon('again')} Play again</button>
        <div class="row">${others.map((id) => `<button class="btn ghost" data-again="${id}">${esc(gameTitle(id))}</button>`).join('')}
        <button class="btn ghost" data-home>${icon('grid')} All games</button></div>`;
    }
    overlay.innerHTML = `<div class="sheet result">
      <p class="kicker">${icon('trophy')} Game over</p>
      <h2>${result}</h2>
      <div class="score"><span>${face(you, 44)}<b>${you?.score ?? 0}</b></span><i>–</i><span><b>${them?.score ?? 0}</b>${face(them, 44)}</span></div>
      ${actions}
    </div>`;
    $$('[data-again]', overlay).forEach((button) => (button.onclick = () => line.send('again', { game: button.dataset.again })));
    $('[data-home]', overlay)?.addEventListener('click', () => (location.hash = ''));
    return;
  }
  overlay.innerHTML = room.paused ? `<div class="sheet small"><div class="spinner"></div><p>${theirName} left the game. It goes on when they’re back.</p></div>` : '';
}

/** The parts that move with the clock: the 3-2-1. */
function renderClock() {
  const count = $('[data-count]');
  if (!count || line.room?.phase !== 'countdown') return;
  const left = Math.ceil(secondsLeft(line) ?? 0);
  const text = left > 0 ? String(left) : 'Go';
  if (count.textContent !== text) {
    count.textContent = text;
    count.classList.remove('beat');
    void count.offsetWidth;
    count.classList.add('beat');
  }
}

// The two cameras

const partnerVideo = $('[data-remote]');
const myVideo = $('[data-local]');

function renderTiles() {
  const inRoom = app.dataset.view === 'room';
  const room = inRoom ? line.room : null;
  const them = partner();
  tiles.hidden = !(inRoom || session.on);
  tiles.dataset.call = session.status;
  if (myVideo.srcObject !== session.local) myVideo.srcObject = session.local;
  if (partnerVideo.srcObject !== session.remote) partnerVideo.srcObject = session.remote;
  const hasPartner = Boolean(session.remote) && session.status === 'connected' && !session.partnerAway;
  tiles.querySelector('.tile.them').classList.toggle('live', hasPartner);
  tiles.querySelector('.tile.you').classList.toggle('live', Boolean(session.local) && session.camera);
  const rules = room && PLAYABLE[room.game];
  const people = { them: room?.players.find((player) => player.id !== state.me?.id) ?? them, you: room?.players.find((player) => player.id === state.me?.id) ?? state.me };
  for (const [key, person] of Object.entries(people)) {
    const tile = tiles.querySelector(`.tile.${key}`);
    tile.querySelector('.who').innerHTML = face(person, 72);
    tile.querySelector('.label').textContent = key === 'you' ? 'You' : person?.name ?? '';
    const playing = room && room.phase !== 'lobby' && rules;
    tile.querySelector('.badge').textContent = playing ? person?.score ?? 0 : '';
    tile.querySelector('.badge').hidden = !playing;
    const mark = playing && rules.mark ? rules.mark(room, person?.id) : null;
    tile.querySelector('.mark').innerHTML = mark ? mark.svg : '';
    tile.querySelector('.mark').style.setProperty('--c', mark?.color ?? 'transparent');
    tile.querySelector('.mark').classList.toggle('fill', Boolean(mark?.fill));
    const turn = room?.xox?.turn ?? room?.drop?.turn;
    tile.classList.toggle('turn', Boolean(playing && room.phase === 'racing' && turn === person?.id));
  }
  const note = tiles.querySelector('.note');
  note.textContent = session.status === 'failed' ? `${them?.name ?? 'They'} can’t see you yet`
    : session.partnerAway ? `${them?.name}’s connection dropped`
    : session.status === 'waiting' ? `Waiting for ${them?.name} to join the call`
    : session.status === 'connecting' ? 'Connecting…'
    : session.status === 'idle' && inRoom ? 'Camera off' : '';
  note.hidden = !note.textContent || hasPartner;
  $('[data-mic]').innerHTML = icon(session.mic ? 'mic' : 'micOff');
  $('[data-mic]').classList.toggle('off', !session.mic);
  $('[data-cam]').innerHTML = icon(session.camera ? 'video' : 'videoOff');
  $('[data-cam]').classList.toggle('off', !session.camera);
  $('[data-hang]').innerHTML = icon('hangUp');
  $('[data-hang]').hidden = !session.on;
  $('[data-start]').hidden = session.on || !state.couple;
}

$('[data-mic]').onclick = () => session.toggleMic();
$('[data-cam]').onclick = () => session.toggleCamera();
$('[data-hang]').onclick = () => session.hangUp();
$('[data-start]').onclick = () => state.couple && session.start(state.couple.id, { ring: true });
session.addEventListener('change', () => {
  renderTiles();
  renderNav();
  if (app.dataset.view === 'browse') renderHead();
  if (session.status === 'failed' && session.failure) toast(session.failure, 'bad');
});

// The menu: unpair, the account, the app

const menu = $('#menu');
function openMenu() {
  const them = partner();
  menu.innerHTML = `<form method="dialog" class="menu">
    <div class="me">${face(state.me, 44)}<div><b>${esc(state.me.name)}</b><small>${them ? `Paired with ${esc(them.name)}` : 'Not paired yet'}</small></div></div>
    <a class="item" href="https://duoclash.app/support.html" target="_blank" rel="noopener">${icon('info')} Help</a>
    ${them ? `<button class="item" type="button" data-unpair>${icon('leave')} Unpair from ${esc(them.name)}</button>` : ''}
    <button class="item bad" type="button" data-delete>Delete my account</button>
    <button class="btn ghost wide" value="close">Close</button>
  </form>`;
  menu.showModal();
  $('[data-unpair]', menu)?.addEventListener('click', async () => {
    if (!confirm(`Unpair from ${them.name}? Your points and stakes together go for both of you.`)) return;
    try {
      session.hangUp();
      applyHome(await call('DELETE', `groups/${state.couple.id}/me`));
      menu.close();
      location.hash = '';
      route();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  $('[data-delete]', menu).addEventListener('click', async () => {
    if (!confirm('Delete your account? Your pairing, points and everything that’s yours go, for good.')) return;
    try {
      session.hangUp();
      await call('DELETE', 'me');
      token.set(null);
      Object.assign(state, { me: null, couple: null, waiting: null, name: '' });
      menu.close();
      location.hash = '';
      browse();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
}
menu.addEventListener('click', (event) => event.target === menu && menu.close());

addEventListener('focus', () => (document.title = 'Duo Clash · Games for two'));
boot();
