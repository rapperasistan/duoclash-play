// Duo Clash on the web (play.duoclash.app): every game laid out like a streaming service's shelves,
// with the same accounts, couples, rooms and video call as the iPhone app, so a couple can play with
// one on a laptop or an Android phone and the other on an iPhone.
//   landing: a name, then a face, and the account is made (no email, no password, like the app)
//   pair:    your code to give, or theirs to type; play.duoclash.app/#pair/123456 pairs straight away
//   browse:  the banner, the shelves, a game's page; the call and any game waiting to be joined
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
// The numbered shelf: where to start on a first night.
const START_HERE = ['xox', 'fourRow', 'guessCelebrity', 'chess', 'crackTheCode'];
const APP_STORE = 'https://apps.apple.com/app/id6820255172';

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
let rotate = null;
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
  clearInterval(rotate);
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
  if (!state.me) {
    tools.innerHTML = `<a class="chip" href="${APP_STORE}" target="_blank" rel="noopener">${icon('phone')} iPhone app</a>`;
    return;
  }
  const theyreIn = (state.couple?.call ?? []).includes(them?.id);
  const callButton = !state.couple ? ''
    : session.on ? `<button class="chip live" data-hang-top>${icon('hangUp')}<span>End call</span></button>`
    : `<button class="chip ${theyreIn ? 'ring' : ''}" data-ring>${icon('video')}<span>${theyreIn ? `Join ${esc(them?.name)}` : 'Video call'}</span></button>`;
  tools.innerHTML = `${callButton}
    <button class="duo-chip" data-menu aria-label="You and your duo">${face(state.me, 32)}${them ? face(them, 32) : ''}${icon('down')}</button>`;
  $('[data-ring]', tools)?.addEventListener('click', () => session.start(state.couple.id, { ring: !theyreIn }));
  $('[data-hang-top]', tools)?.addEventListener('click', () => session.hangUp());
  $('[data-menu]', tools).addEventListener('click', openMenu);
}

document.addEventListener('click', (event) => {
  const home = event.target.closest('[data-go-home]');
  if (home) {
    event.preventDefault();
    if (location.hash) location.hash = '';
    else scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    return;
  }
  const shelf = event.target.closest('[data-shelf]');
  if (shelf) {
    event.preventDefault();
    const row = document.getElementById(`shelf-${shelf.dataset.shelf}`);
    if (row) scrollTo({ top: row.getBoundingClientRect().top + scrollY - 90, behavior: still ? 'auto' : 'smooth' });
  }
});

// Start

async function boot() {
  const invite = location.hash.match(/^#pair\/(\d{6})$/)?.[1];
  if (invite) sessionStorage.setItem('invite', invite);
  if (!token.get()) return landing();
  try {
    applyHome(await call('GET', 'me'));
  } catch (error) {
    if (error.status === 401) {
      token.set(null);
      return landing();
    }
    return offline(error);
  }
  route();
}

function offline(error) {
  show('plain', `<section class="center"><div class="panel">
    <div class="glyph">${icon('wifiOff')}</div>
    <h1>Can’t reach Duo Clash</h1>
    <p class="dim">${esc(error.message)}</p>
    <button class="btn play" data-retry>Try again</button>
  </div></section>`);
  $('[data-retry]').onclick = boot;
}

/** Where the address says to be: a room, or the shelves (or pairing first, when there's nobody yet). */
function route() {
  clearInterval(poll);
  poll = null;
  if (!state.me) return landing();
  if (!state.couple) {
    if (location.hash.startsWith('#room/')) history.replaceState(null, '', location.pathname);
    return pair();
  }
  const roomId = location.hash.match(/^#room\/([\w-]+)$/)?.[1];
  if (roomId) return enterRoom(roomId);
  if (opened) leaveRoom();
  browse();
}

addEventListener('hashchange', route);

// The wall of posters behind the first pages

function wall() {
  const ids = CATALOG.map((g) => g.id);
  const lane = (offset) => {
    const run = [...ids.slice(offset), ...ids.slice(0, offset)];
    return `<div class="lane">${[...run, ...run].map((id) => `<img src="${art(id, 'poster')}" alt="" loading="lazy">`).join('')}</div>`;
  };
  return `<div class="wall" aria-hidden="true"><div class="tilt">${lane(0)}${lane(7)}${lane(14)}${lane(21)}</div></div><div class="wall-shade"></div>`;
}

// Landing: a name, then a face

function landing() {
  show('landing', `${wall()}
  <section class="pitch">
    <p class="kicker"><img src="assets/icon-512.png" alt="">Games for two</p>
    <h1>Date night,<br>wherever you are.</h1>
    <p class="lede">Word races, chess, four in a row and more, played face to face on a video call. In your browser, or with someone on the iPhone app.</p>
    <form class="start" data-name>
      <label class="float"><input name="name" maxlength="20" autocomplete="nickname" placeholder=" " required value="${esc(state.name)}"><span>Your name</span></label>
      <button class="btn red big" type="submit">Get started ${icon('next')}</button>
    </form>
    <p class="fine">No email, no password. By continuing you agree to the <a href="https://duoclash.app/terms.html">Terms</a> and the <a href="https://duoclash.app/privacy.html">Privacy Policy</a>.</p>
  </section>
  <section class="bands">
    <div class="band"><div><h2>Made for two</h2><p>Every game is one on one. Your faces sit right beside the board, so you see the reaction to every move.</p></div><div class="band-art">${['xox', 'fourRow', 'chess'].map((id) => img(id, 'wide')).join('')}</div></div>
    <div class="band flip"><div><h2>Laptop, Android or iPhone</h2><p>Pair once with a six-digit code. One of you can be in a browser and the other on the iPhone app.</p></div><div class="band-icons">${icon('monitor')}${icon('phone')}${icon('globe')}</div></div>
    <div class="band"><div><h2>New games keep coming</h2><p>Words, numbers, memory and strategy. Tell us the game you want next and it might be here next week.</p></div><div class="band-art">${['letterLink', 'guessCelebrity', 'seaBattle'].map((id) => img(id, 'wide')).join('')}</div></div>
  </section>`);
  const form = $('[data-name]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state.name = form.name.value.trim();
    if (state.name) pickFace();
  });
}

/** The face, picked the way a streaming service has you pick a profile. */
function pickFace() {
  show('faces', `<section class="faces-gate">
    <h1>Pick your face, ${esc(state.name)}</h1>
    <p class="dim">Your duo sees it next to your name. You can turn your camera on in a game.</p>
    <div class="face-grid">${Array.from({ length: AVATARS }, (_, i) => `
      <button class="face-pick" data-avatar="${i}" style="--i:${i}">${avatarSVG(i)}</button>`).join('')}
    </div>
    <button class="btn ghost" data-back>Change name</button>
  </section>`);
  $('[data-back]').onclick = landing;
  $('.face-grid').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-avatar]');
    if (!button) return;
    $$('.face-pick').forEach((b) => (b.disabled = true));
    button.classList.add('chosen');
    try {
      const made = await call('POST', 'accounts', { name: state.name, avatar: Number(button.dataset.avatar) });
      token.set(made.token);
      applyHome(await call('GET', 'me'));
      route();
    } catch (error) {
      toast(error.message, 'bad');
      $$('.face-pick').forEach((b) => (b.disabled = false));
      button.classList.remove('chosen');
      if (error.code === 'bad_name' || error.code === 'no_name') landing();
    }
  });
}

// Pairing

async function pair() {
  const invite = sessionStorage.getItem('invite');
  if (invite) {
    sessionStorage.removeItem('invite');
    try {
      await call('POST', 'groups/join', { code: invite });
      applyHome(await call('GET', 'me'));
      if (state.couple) {
        toast(`Paired with ${partner()?.name}. Time to play.`);
        history.replaceState(null, '', location.pathname);
        return route();
      }
    } catch (error) {
      toast(error.message, 'bad');
    }
  }
  if (!state.waiting) {
    try {
      state.waiting = (await call('POST', 'groups')).group;
    } catch (error) {
      return offline(error);
    }
  }
  const code = state.waiting.code;
  const link = `${location.origin}${location.pathname}#pair/${code}`;
  show('pair', `${wall()}
  <section class="center"><div class="panel pairing">
    <div class="half">
      <p class="kicker">${icon('link')} Your code</p>
      <h1>Send this to your duo</h1>
      <div class="code" aria-label="Your code ${code}">${[...code].map((d, i) => `<span style="--i:${i}">${d}</span>`).join('')}</div>
      <p class="dim">They type it in Duo Clash on their iPhone, or open your link in any browser.</p>
      <div class="row">
        <button class="btn play" data-copy>${icon('copy')} Copy link</button>
        ${navigator.share ? `<button class="btn ghost" data-share>Share</button>` : ''}
      </div>
      <p class="waiting"><i></i> Waiting for them to pair</p>
    </div>
    <form class="half other" data-join>
      <p class="kicker">${icon('check')} Got their code?</p>
      <h2>Type it here</h2>
      <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" class="code-input" required>
      <button class="btn red wide" type="submit">Pair</button>
    </form>
  </div></section>`);
  $('[data-copy]').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied. Send it to your duo.');
    } catch {
      toast(link);
    }
  };
  $('[data-share]')?.addEventListener('click', () => navigator.share({ title: 'Duo Clash', text: `Pair with me on Duo Clash: ${code}`, url: link }).catch(() => {}));
  const form = $('[data-join]');
  form.code.addEventListener('input', () => (form.code.value = form.code.value.replace(/\D/g, '').slice(0, 6)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await call('POST', 'groups/join', { code: form.code.value });
      applyHome(await call('GET', 'me'));
      toast(`Paired with ${partner()?.name}. Time to play.`);
      route();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  // The other side pairing with this code shows up here.
  poll = setInterval(async () => {
    try {
      applyHome(await call('GET', 'me'));
      if (state.couple) {
        toast(`${partner()?.name} paired with you. Time to play.`);
        route();
      }
    } catch {}
  }, 3000);
}

// Browsing: the banner and the shelves

function card(g, { numbered = 0 } = {}) {
  const here = Boolean(PLAYABLE[g.id]);
  if (numbered) {
    return `<article class="card top" data-detail="${g.id}" tabindex="0" style="--i:${numbered}">
      <svg class="rank" viewBox="0 0 120 160" aria-hidden="true"><text x="118" y="150" text-anchor="end">${numbered}</text></svg>
      ${img(g.id, 'poster', 'loading="lazy"')}
    </article>`;
  }
  return `<article class="card" data-detail="${g.id}" tabindex="0">
    <div class="shot">${img(g.id, 'wide', 'loading="lazy"')}<span class="name">${esc(g.title)}</span>${here ? '' : `<span class="flag">${icon('phone')}iPhone</span>`}</div>
    <div class="pop">
      <div class="acts">
        ${here ? `<button class="circle white" data-play="${g.id}" aria-label="Play ${esc(g.title)}">${icon('play')}</button>` : `<span class="circle dim-circle" title="On the iPhone app">${icon('phone')}</span>`}
        <button class="circle" data-detail="${g.id}" aria-label="How to play ${esc(g.title)}">${icon('down')}</button>
      </div>
      <p class="meta">${here ? '<b class="go">Plays here</b>' : '<b>iPhone app</b>'}<span class="box">2 players</span></p>
      <p class="tags">${esc(g.kind)} <i></i> ${esc(shelfTitle(g.category))}</p>
    </div>
  </article>`;
}

function shelf(id, title, games, options = {}) {
  if (!games.length) return '';
  return `<section class="shelf ${options.numbered ? 'numbered' : ''}" id="shelf-${id}">
    <h2>${title}${options.note ? `<small>${options.note}</small>` : ''}</h2>
    <div class="slider">
      <button class="handle prev" data-slide="-1" aria-label="Back">${icon('back')}</button>
      <div class="track">${games.map((g, i) => card(g, { numbered: options.numbered ? i + 1 : 0 })).join('')}</div>
      <button class="handle next" data-slide="1" aria-label="More">${icon('next')}</button>
    </div>
  </section>`;
}

function browse() {
  const them = partner();
  const playable = CATALOG.filter((g) => PLAYABLE[g.id]);
  const featured = [...playable, ...['guessCelebrity', 'chess', 'letterLink'].map(game).filter(Boolean)];
  show('browse', `
  <section class="billboard" data-billboard>
    <div class="bb-art">${featured.map((g, i) => `<div class="slide ${i === 0 ? 'on' : ''}" data-slide-id="${g.id}"><picture><source media="(max-width: 800px)" srcset="${art(g.id, 'poster')}">${img(g.id, 'billboard')}</picture></div>`).join('')}</div>
    <div class="bb-shade"></div>
    <div class="bb-copy" data-bb-copy></div>
    <div class="bb-dots">${featured.map((g, i) => `<button class="${i === 0 ? 'on' : ''}" data-bb="${i}" aria-label="${esc(g.title)}"></button>`).join('')}</div>
  </section>
  <div class="shelves">
    <div data-waiting></div>
    ${shelf('web', 'Play now in your browser', playable, { note: `${esc(them?.name)} gets a notification and joins you` })}
    ${shelf('start', 'Start here tonight', START_HERE.map(game).filter(Boolean), { numbered: true })}
    ${SHELVES.map((s) => shelf(s.id, s.title, CATALOG.filter((g) => g.category === s.id))).join('')}
    <section class="ask">
      <div><h2>What should we make next?</h2><p class="dim">New games land every week. Tell us the one you two want.</p></div>
      <a class="btn play" href="mailto:support@duoclash.app?subject=Game%20idea%20for%20Duo%20Clash">Suggest a game</a>
    </section>
  </div>
  <footer class="foot">
    <a href="https://duoclash.app">About Duo Clash</a><a href="https://duoclash.app/privacy.html">Privacy</a><a href="https://duoclash.app/terms.html">Terms</a><a href="https://duoclash.app/support.html">Support</a>
    <span>© 2026 Duo Clash</span>
  </footer>`);
  billboard(featured);
  sliders();
  renderWaiting();
  poll = setInterval(refreshCouple, 3000);
}

/** The banner: one game at a time, a new one every few seconds until someone picks. */
function billboard(featured) {
  let at = 0;
  const copy = $('[data-bb-copy]');
  const paint = () => {
    const g = featured[at];
    const here = Boolean(PLAYABLE[g.id]);
    copy.innerHTML = `<div class="bb-in">
      <p class="kicker"><img src="assets/icon-512.png" alt="">${here ? 'Plays in your browser' : 'On the iPhone app'}</p>
      <h1>${esc(g.title)}</h1>
      <p class="meta">${here ? '<b class="go">New on the web</b>' : ''}<span>${esc(g.kind)}</span><span class="box">2 players</span><span>${esc(shelfTitle(g.category))}</span></p>
      <p class="how">${esc(g.how)}</p>
      <div class="acts">
        ${here ? `<button class="btn play big" data-play="${g.id}">${icon('play')} Play</button>` : ''}
        <button class="btn glass big" data-detail="${g.id}">${icon('info')} ${here ? 'How to play' : 'More info'}</button>
      </div>
    </div>`;
    $$('.bb-art .slide').forEach((slide, i) => slide.classList.toggle('on', i === at));
    $$('[data-bb]').forEach((dot, i) => dot.classList.toggle('on', i === at));
  };
  const go = (to) => {
    at = (to + featured.length) % featured.length;
    paint();
  };
  paint();
  $$('[data-bb]').forEach((dot) => (dot.onclick = () => {
    clearInterval(rotate);
    go(Number(dot.dataset.bb));
  }));
  if (!still) rotate = setInterval(() => !detail.open && document.visibilityState === 'visible' && go(at + 1), 9000);
}

/** A shelf slides a screenful at a time with its arrows, eased; a trackpad or a finger moves it too. */
function sliders() {
  $$('.slider').forEach((slider) => {
    const track = $('.track', slider);
    const handles = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      slider.classList.toggle('at-start', track.scrollLeft <= 2);
      slider.classList.toggle('at-end', track.scrollLeft >= max);
    };
    track.addEventListener('scroll', handles, { passive: true });
    handles();
    $$('[data-slide]', slider).forEach((button) => (button.onclick = () => {
      const from = track.scrollLeft;
      const to = Math.max(0, Math.min(track.scrollWidth - track.clientWidth, from + Number(button.dataset.slide) * track.clientWidth * 0.9));
      if (still) return void (track.scrollLeft = to);
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / 700);
        track.scrollLeft = from + (to - from) * (1 - Math.pow(1 - t, 4));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }));
  });
  addEventListener('resize', () => $$('.track').forEach((track) => track.dispatchEvent(new Event('scroll'))));
}

// Clicks on the shelves and the banner: play straight away, or open a game's page.
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
  const alike = CATALOG.filter((other) => other.category === g.category && other.id !== id).slice(0, 6);
  detail.innerHTML = `<div class="sheet-in">
    <div class="hero">${img(id, 'billboard')}<div class="fade"></div>
      <button class="circle close" data-close aria-label="Close">${icon('close')}</button>
      <div class="hero-copy"><h1>${esc(g.title)}</h1>
        <div class="acts">${here ? `<button class="btn play big" data-play-detail="${id}">${icon('play')} Play</button>` : `<a class="btn glass big" href="${APP_STORE}" target="_blank" rel="noopener">${icon('phone')} Play on iPhone</a>`}</div>
      </div>
    </div>
    <div class="body">
      <div>
        <p class="meta">${here ? '<b class="go">Plays in your browser</b>' : '<b>Coming to the web</b>'}<span class="box">2 players</span><span>${esc(g.kind)}</span></p>
        <h3>How to play</h3>
        <p class="how">${esc(g.how)}</p>
      </div>
      <dl>
        <dt>Category</dt><dd>${esc(shelfTitle(g.category))}</dd>
        <dt>Languages</dt><dd>${esc(g.language)}</dd>
        <dt>Where</dt><dd>${here ? 'Browser and iPhone app, together' : 'iPhone app for now'}</dd>
      </dl>
    </div>
    ${alike.length ? `<h3 class="alike-title">More like this</h3><div class="alike">${alike.map((other) => `
      <button class="alike-card" data-other="${other.id}">${img(other.id, 'wide', 'loading="lazy"')}<span><b>${esc(other.title)}</b><small>${PLAYABLE[other.id] ? 'Plays here' : 'iPhone app'} · ${esc(other.kind)}</small></span></button>`).join('')}</div>` : ''}
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
    if (app.dataset.view === 'browse') {
      renderWaiting();
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

/** Games open in the couple, like a streaming service's "continue watching". */
function renderWaiting() {
  const box = $('[data-waiting]');
  if (!box) return;
  const them = partner();
  const open = (state.couple.rooms ?? []).filter((room) => room.phase !== 'finished');
  if (!open.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<section class="shelf waiting-shelf"><h2>${open.some((room) => room.host !== state.me.id) ? `${esc(them?.name)} is waiting` : 'Continue playing'}</h2>
    <div class="slider"><div class="track">${open.map((room) => {
      const host = room.players.find((player) => player.id === room.host);
      const mine = room.host === state.me.id;
      const can = Boolean(PLAYABLE[room.game]);
      const scores = room.players.map((player) => player.score ?? 0);
      const progress = room.target ? Math.min(1, Math.max(...scores, 0) / room.target) : room.phase === 'lobby' ? 0.04 : 0.5;
      return `<article class="card waiting-card ${can ? '' : 'off'}" ${can ? `data-join="${room.id}"` : ''} tabindex="0">
        <div class="shot">${img(room.game, 'wide')}<span class="name">${esc(gameTitle(room.game))}</span>
          ${can ? `<span class="join">${icon('play')}</span>` : `<span class="flag">${icon('phone')}iPhone</span>`}
          <span class="progress"><i style="width:${(progress * 100).toFixed(0)}%"></i></span></div>
        <p class="under">${mine ? 'You opened it' : `${esc(host?.name ?? them?.name)} opened it`} · ${room.phase === 'lobby' ? 'in the lobby' : 'under way'}</p>
      </article>`;
    }).join('')}</div></div></section>`;
  $$('[data-join]', box).forEach((cardEl) => (cardEl.onclick = () => (location.hash = `#room/${cardEl.dataset.join}`)));
}

async function openRoom(id, button) {
  if (!PLAYABLE[id]) return openDetail(id);
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
      <h2>${esc(gameTitle(room.game))} is on the iPhone app for now</h2>
      <p class="dim">It’s coming to the web soon. Pick one of the web games instead.</p>
      <button class="btn play" data-home>Back to games</button></div>`;
    $('[data-home]', overlay).onclick = () => (location.hash = '');
    return;
  }
  if (room.phase === 'lobby') {
    const mine = room.players.find((player) => player.id === me);
    overlay.innerHTML = `<div class="sheet">${img(room.game, 'wide', 'class="art wide"')}
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
  if (session.status === 'failed' && session.failure) toast(session.failure, 'bad');
});

// The menu: unpair, the account, the app

const menu = $('#menu');
function openMenu() {
  const them = partner();
  menu.innerHTML = `<form method="dialog" class="menu">
    <div class="me">${face(state.me, 44)}<div><b>${esc(state.me.name)}</b><small>${them ? `Paired with ${esc(them.name)}` : 'Not paired yet'}</small></div></div>
    <a class="item" href="${APP_STORE}" target="_blank" rel="noopener">${icon('phone')} Get the iPhone app</a>
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
    if (!confirm('Delete your account? Your duo, points and everything that’s yours go, for good.')) return;
    try {
      session.hangUp();
      await call('DELETE', 'me');
      token.set(null);
      Object.assign(state, { me: null, couple: null, waiting: null, name: '' });
      menu.close();
      location.hash = '';
      landing();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
}
menu.addEventListener('click', (event) => event.target === menu && menu.close());

addEventListener('focus', () => (document.title = 'Duo Clash · Games for two'));
boot();
