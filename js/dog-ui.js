// Oberfläche für das Lauf-Kartenspiel: Brett, Figuren selbst ziehen (mit Leuchtfeldern), Karten.
import { q, esc, modal, closeModal, listModal, confirmModal, lobbyHtml, toggleLog, applyLog, toast } from './ui.js';
import { TRACK_XY, HOME_XY, GOAL_XY } from './dog-board.js';
import {
  L, COLORS, CARDS, CARD_ORDER, RULES, startOf, partnerOf, movers, options, sevenOptions, canSeven, applyOpt, sameLoc,
} from './dog.js';

let C = null; // { ui, act, copyLink, leave, openRename }
export function initDogUI(ctx) { C = ctx; }

// ---------- lokale Zustände ----------
let selCard = null;     // gewählte Handkarte (id)
let jokerAs = null;     // als welche Karte der Joker gilt
let picked = null;      // "owner:idx" der angefassten Figur
let lastKey = '';
const walk = { key: null, path: [], i: 0, timer: null };

export function onDogEvent(ev) {
  if (ev.kind !== 'dmove') return;
  const v = C && C.ui.view;
  if (ev.dragged && v && ev.by === v.me) return; // selbst gezogen – schon dort
  if (!ev.path || ev.path.length < 2) return;
  clearInterval(walk.timer);
  Object.assign(walk, { key: `${ev.owner}:${ev.idx}`, path: ev.path, i: 0 });
  walk.timer = setInterval(() => {
    walk.i++;
    if (walk.i >= walk.path.length) { clearInterval(walk.timer); walk.timer = null; walk.key = null; render(); return; }
    placePieces();
  }, 130);
}

// ---------- Hilfen ----------
function info() {
  const v = C.ui.view;
  const meP = v.players.find((p) => p.id === v.me);
  const turnP = v.players.find((p) => p.id === v.turn) || null;
  const isHost = !!(meP && meP.host);
  const canAct = !!(v.phase === 'play' && turnP && (turnP.id === v.me || (isHost && !turnP.connected)));
  const actor = canAct ? turnP.id : null;
  const ctx = { players: v.players, pieces: v.pieces, mode: v.mode };
  return { v, meP, turnP, isHost, canAct, actor, ctx };
}
const seatOf = (v, pid) => v.players.find((p) => p.id === pid)?.seat ?? 0;
const colorOf = (v, pid) => COLORS[seatOf(v, pid)].hex;
function locXY(v, owner, idx, loc) {
  const seat = seatOf(v, owner);
  if (loc.z === 't') return TRACK_XY[loc.i];
  if (loc.z === 'g') return GOAL_XY[seat][loc.k];
  const homes = (v.pieces[owner] || []).map((l, j) => (l.z === 'h' ? j : -1)).filter((j) => j >= 0);
  return HOME_XY[seat][Math.max(0, homes.indexOf(idx))];
}
const cardOf = (id) => C.ui.view.hand.find((c) => c.id === id);
function currentType() {
  const c = selCard && cardOf(selCard);
  if (!c) return null;
  return c.t === 'J' ? jokerAs : c.t;
}
// Mögliche Züge für die gewählte Karte (bzw. die laufende 7)
function currentOptions() {
  const { v, canAct, actor, ctx } = info();
  if (!canAct || v.stuck) return [];
  if (v.seven) {
    return sevenOptions(ctx, actor, v.seven.left).filter((o) => { const c = clone(ctx); applyOpt(c, o, true); return canSeven(c, actor, v.seven.left - o.k); });
  }
  const t = currentType();
  if (!t) return [];
  if (t === '7') {
    if (!canSeven(ctx, actor, 7)) return [];
    return sevenOptions(ctx, actor, 7).filter((o) => { const c = clone(ctx); applyOpt(c, o, true); return canSeven(c, actor, 7 - o.k); });
  }
  return options(ctx, actor, t);
}
const clone = (ctx) => ({ players: ctx.players, mode: ctx.mode, pieces: JSON.parse(JSON.stringify(ctx.pieces)) });
const targetXY = (v, o) => (o.kind === 'swap' ? locXY(v, o.other.owner, o.other.idx, v.pieces[o.other.owner][o.other.idx]) : locXY(v, o.owner, o.idx, o.to));

// ---------- Brett ----------
function boardSvg() {
  const lines = [];
  for (let i = 0; i < L; i++) {
    const a = TRACK_XY[i], b = TRACK_XY[(i + 1) % L];
    lines.push(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`);
  }
  COLORS.forEach((_, seat) => {
    const s = TRACK_XY[startOf(seat)];
    const g = GOAL_XY[seat];
    lines.push(`M${s[0]} ${s[1]}L${g[0][0]} ${g[0][1]}L${g[1][0]} ${g[1][1]}L${g[2][0]} ${g[2][1]}L${g[3][0]} ${g[3][1]}`);
    const h = HOME_XY[seat];
    lines.push(`M${h[0][0]} ${h[0][1]}L${h[1][0]} ${h[1][1]}L${h[2][0]} ${h[2][1]}L${h[3][0]} ${h[3][1]}`);
  });
  const dot = (x, y, cls, extra = '') => `<circle cx="${x}" cy="${y}" r="1.95" class="${cls}"${extra}/>`;
  const track = TRACK_XY.map(([x, y], i) => {
    if (i % 16 === 0) return `<circle cx="${x}" cy="${y}" r="2.35" class="dstart" style="--c:${COLORS[i / 16].hex}" data-loc="t:${i}"/>`;
    return dot(x, y, 'dfield', ` data-loc="t:${i}"`);
  }).join('');
  const goals = GOAL_XY.map((g, seat) => g.map(([x, y], k) => dot(x, y, 'dgoal', ` style="--c:${COLORS[seat].hex}" data-loc="g:${seat}:${k}"`)).join('')).join('');
  const homes = HOME_XY.map((h, seat) => h.slice(0, 4).map(([x, y]) => dot(x, y, 'dhome', ` style="--c:${COLORS[seat].hex}" data-loc="h:${seat}"`)).join('')).join('');
  const badge = (x, y, rot) => `<g transform="translate(${x} ${y}) rotate(${rot})" class="dbadge"><rect x="-8" y="-2.6" width="16" height="5.2" rx="2.6"/><text y="1.5" text-anchor="middle">WUFF</text></g>`;
  return `<svg class="dboard" viewBox="0 0 100 100" role="img" aria-label="Spielbrett">
    <defs>
      <filter id="dmarble" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="7"/>
        <feColorMatrix values="0 0 0 0 0.10  0 0 0 0 0.30  0 0 0 0 0.75  0 0 0 0.9 0"/>
        <feComposite in2="SourceGraphic" operator="in"/>
      </filter>
    </defs>
    <rect x="0" y="0" width="100" height="100" rx="2.5" class="dframe"/>
    <rect x="1.4" y="1.4" width="97.2" height="97.2" rx="1.6" class="dbg"/>
    <rect x="1.4" y="1.4" width="97.2" height="97.2" rx="1.6" fill="#2a64c8" filter="url(#dmarble)" opacity="0.85"/>
    <rect x="2.4" y="2.4" width="95.2" height="95.2" rx="1.2" class="dinner"/>
    ${badge(10, 8.5, -38)}${badge(90, 8.5, 38)}${badge(10, 91.5, 38)}${badge(90, 91.5, -38)}
    <g transform="translate(50 50) rotate(-30)"><rect x="-10.5" y="-14" width="21" height="28" rx="3" class="dcenter"/></g>
    <g id="dpile"></g>
    <path d="${lines.join('')}" class="dlines"/>
    ${homes}${goals}${track}
    <g id="dmarks"></g>
    <g id="dpieces"></g>
  </svg>`;
}

function pieceSvg(v, owner, idx, xy, cls) {
  const col = colorOf(v, owner);
  return `<g class="dpiece ${cls}" data-piece="${owner}:${idx}" style="transform:translate(${xy[0].toFixed(2)}px, ${xy[1].toFixed(2)}px)">
    <ellipse cx="0" cy="1.1" rx="2.1" ry="1" class="dshadow"/>
    <circle r="2.05" fill="${col}" class="dbody"/>
    <circle r="1.05" cy="-0.35" fill="${col}" class="dtop"/>
    <circle r="0.55" cx="-0.45" cy="-0.75" fill="rgba(255,255,255,.55)"/>
  </g>`;
}

function placePieces() {
  const v = C.ui.view;
  const g = q('#dpieces');
  if (!g) return;
  for (const el of g.querySelectorAll('[data-piece]')) {
    if (drag.el === el && drag.on) continue;
    const [owner, idx] = el.dataset.piece.split(':');
    const loc = walk.key === el.dataset.piece ? walk.path[Math.min(walk.i, walk.path.length - 1)] : v.pieces[owner][Number(idx)];
    const xy = locXY(v, owner, Number(idx), loc);
    el.style.transform = `translate(${xy[0].toFixed(2)}px, ${xy[1].toFixed(2)}px)`;
  }
}

function renderBoard() {
  const { v, ctx, canAct, actor } = info();
  const wrap = q('#dboardWrap');
  if (!wrap.querySelector('svg')) wrap.innerHTML = boardSvg();
  const opts = currentOptions();
  const movable = new Set(opts.map((o) => `${o.owner}:${o.idx}`));
  // Figuren (alte Position übernehmen → weiche Bewegung)
  const g = q('#dpieces');
  const old = new Map([...g.querySelectorAll('[data-piece]')].map((el) => [el.dataset.piece, el.style.transform]));
  let html = '';
  for (const p of v.players) {
    (v.pieces[p.id] || []).forEach((loc, idx) => {
      const key = `${p.id}:${idx}`;
      const xy = locXY(v, p.id, idx, loc);
      const cls = [movable.has(key) ? 'can' : '', picked === key ? 'picked' : '', canAct ? 'grab' : ''].join(' ');
      html += pieceSvg(v, p.id, idx, xy, cls);
      void old;
    });
  }
  g.innerHTML = html;
  for (const el of g.querySelectorAll('[data-piece]')) if (old.has(el.dataset.piece)) el.style.transform = old.get(el.dataset.piece);
  void g.getBoundingClientRect();
  placePieces();
  // Leuchtfelder
  const marks = q('#dmarks');
  const show = picked ? opts.filter((o) => `${o.owner}:${o.idx}` === picked) : [];
  marks.innerHTML = show.map((o, n) => {
    const [x, y] = targetXY(v, o);
    return `<circle cx="${x}" cy="${y}" r="2.9" class="dtarget${o.kind === 'swap' ? ' swap' : ''}" data-opt="${n}"/>`;
  }).join('');
  marks.dataset.count = show.length;
  // Ablagestapel in der Mitte
  const top = v.discardTop;
  q('#dpile').innerHTML = top ? `<g transform="translate(50 50) rotate(-30)"><rect x="-7" y="-10" width="14" height="20" rx="1.6" class="dcard ${CARDS[top].red ? 'red' : 'blue'}"/><text y="3.2" text-anchor="middle" class="dcardtxt">${esc(CARDS[top].short)}</text></g>`
    : '<g transform="translate(50 50) rotate(-30)"><text y="1.4" text-anchor="middle" class="dpaw">🐾</text></g>';
  void ctx; void actor;
}

// ---------- Aufbau ----------
function skeleton() {
  return `
  <div id="game" class="game dog-game">
    <header class="topbar">
      <button id="codeBtn" class="room-code" title="Einladungslink kopieren">Raum <b></b></button>
      <span id="deckName" class="deck-name"></span>
      <span class="spacer"></span>
      <button id="undoBtn" class="btn small undo" data-act="undo">↶ Zurück</button>
      <button class="btn ghost small" data-act="log">Verlauf</button>
      <button class="btn ghost small" data-act="menu">Menü</button>
    </header>
    <div id="status" class="status" hidden>Verbindung unterbrochen – verbinde neu …</div>
    <div class="xbody">
      <div class="xmain pmain">
        <div class="pgrid">
          <section class="pleft"><div id="dboardWrap" class="pboard-wrap"></div></section>
          <section class="pright">
            <div id="dpanel" class="tray ppanel"></div>
            <div id="dplayers" class="pothers"></div>
          </section>
        </div>
      </div>
      <aside id="log" class="log"><div class="log-head">Verlauf <button class="icon-btn" data-act="log" aria-label="Schließen">✕</button></div><ol id="logList"></ol></aside>
    </div>
    <section id="dhand" class="phand"></section>
    <div id="lobby"></div>
  </div>`;
}

export function render() {
  const ui = C.ui;
  const v = ui.view;
  if (!v || !ui.deck) return;
  let g = q('#game.dog-game');
  if (!g) {
    document.getElementById('app').innerHTML = skeleton();
    g = q('#game.dog-game');
    bind(g);
  }
  const key = `${v.game}:${v.roundNo}:${v.turn}:${v.phase}`;
  if (key !== lastKey) { lastKey = key; picked = null; if (!v.seven) { selCard = null; jokerAs = null; } }
  if (selCard && !cardOf(selCard)) { selCard = null; jokerAs = null; }
  if (v.sevenCard) selCard = v.sevenCard;

  applyLog(ui);
  q('#codeBtn b').textContent = ui.code || '';
  q('#deckName').textContent = `${ui.deck.name} · Spiel ${v.game}${v.roundNo ? ` · Runde ${v.roundNo} (${v.dealCount} Karten)` : ''}`;
  const undoBtn = q('#undoBtn');
  undoBtn.disabled = !v.undo;
  undoBtn.title = v.undo ? `Zurücknehmen: ${v.undo}` : 'Du hast gerade nichts zum Zurücknehmen';

  renderBoard();
  renderPanel();
  renderPlayers();
  renderHand();

  const logList = q('#logList');
  logList.innerHTML = v.log.map((e) => `<li>${esc(e.text)}</li>`).join('');
  logList.scrollTop = logList.scrollHeight;

  q('#lobby').innerHTML = v.started ? '' : lobbyHtml({
    title: ui.deck.name, view: v, minPlayers: ui.deck.minPlayers, maxPlayers: ui.deck.maxPlayers,
    code: ui.code, isHost: ui.mode === 'host',
  }).replace(/<p class="muted small-text">Du kannst auch schon alleine starten[^<]*<\/p>/, '')
    .replace('<button class="btn ghost" data-act="leave">', `<p class="muted small-text">Zu viert oder zu sechst: Teams (gegenüber). Zu zweit, dritt oder fünft: jeder für sich. Alle müssen vor dem Start im Raum sein.</p><button class="btn ghost" data-act="leave">`);
  q('#status').hidden = !ui.lost;
}

function renderPanel() {
  const { v, turnP, canAct, isHost, ctx, actor } = info();
  const el = q('#dpanel');
  if (v.finished) {
    el.innerHTML = `<div class="results"><div class="trophy-big">🏆</div><h2>Spiel ${v.game} ist vorbei</h2>
      <p class="tray-hint">${esc(v.log[v.log.length - 1]?.text || '')}</p>
      <div class="tray-actions"><button class="btn primary big" data-act="newGame">Neues Spiel</button></div></div>`;
    return;
  }
  if (v.phase === 'exchange') {
    const partner = v.mode === 'team' ? v.players.find((p) => p.id === partnerOf(ctx, v.me)) : null;
    const target = partner ? partner.name : 'deinen linken Nachbarn';
    const waiting = v.players.filter((p) => !p.gave).map((p) => esc(p.name));
    el.innerHTML = `<h3 class="ptitle">Kartentausch</h3>
      ${v.myGive ? `<p class="tray-hint">✓ Deine Karte ist ausgewählt. Warte auf: ${waiting.join(', ') || '…'}</p>`
        : `<p class="tray-hint">Wähle unten eine Karte, die du verdeckt an <b>${esc(target)}</b> gibst.</p>
           <div class="tray-actions"><button class="btn primary" data-act="give"${selCard ? '' : ' disabled'}>Karte an ${esc(target)} geben</button></div>`}`;
    return;
  }
  if (!turnP) { el.innerHTML = ''; return; }
  const head = `<div class="turn" style="--pc:${turnP.color}"><span class="dot"></span><b>${turnP.id === v.me ? 'Du bist dran!' : `${esc(turnP.name)} ist dran`}</b></div>`;
  if (!canAct) {
    el.innerHTML = `${head}<p class="tray-hint">Warte auf ${esc(turnP.name)} …</p>`;
    return;
  }
  const proxy = turnP.id !== v.me ? `<p class="tray-hint">${esc(turnP.name)} ist offline – du spielst für ${esc(turnP.name)}.</p>` : '';
  let body = '';
  if (v.stuck) {
    body = `<p class="tray-hint">Mit deinen Karten geht kein Zug. ${v.stuck.n === 1 ? 'Wähle eine Karte zum Abwerfen – du ziehst dafür eine neue.' : 'Auch die neue Karte geht nicht – wirf eine Karte ab.'}</p>
      <div class="tray-actions"><button class="btn primary" data-act="stuck"${selCard ? '' : ' disabled'}>Ausgewählte Karte abwerfen</button></div>`;
  } else if (v.seven) {
    body = `<div class="dseven"><b>7: noch ${v.seven.left} ${v.seven.left === 1 ? 'Schritt' : 'Schritte'}</b><span>Figur anfassen und auf ein leuchtendes Feld ziehen. Überholte Figuren werden verbrannt.</span></div>
      ${v.seven.left === 7 ? '<div class="tray-actions"><button class="btn ghost small" data-act="cancelSeven">7 abbrechen</button></div>' : ''}`;
  } else {
    const c = selCard && cardOf(selCard);
    const opts = currentOptions();
    const movers0 = new Set(opts.map((o) => o.owner));
    if (!c) body = '<p class="tray-hint">Wähle unten eine Karte. Danach leuchten die Figuren, die du damit ziehen kannst.</p>';
    else {
      body = `<div class="dcardinfo"><span class="dmini ${CARDS[c.t].red ? 'red' : 'blue'}">${esc(CARDS[c.t].short)}</span><div><b>${esc(CARDS[c.t].name)}</b><span>${esc(CARDS[c.t].text)}</span></div></div>`;
      if (c.t === 'J') {
        body += `<p class="tray-hint small">Als welche Karte gilt der Joker?</p><div class="djoker">${CARD_ORDER.filter((t) => t !== 'J').map((t) => `<button class="btn small${jokerAs === t ? ' on' : ''}" data-as="${t}">${esc(CARDS[t].short)}</button>`).join('')}</div>`;
      }
      const t = currentType();
      if (t) {
        if (opts.length) body += `<p class="tray-hint">Figur anfassen und auf ein leuchtendes Feld ziehen – oder Figur antippen, dann Feld antippen.${movers0.size && ![...movers0].includes(actor) ? ' (Du ziehst die Figuren deines Partners.)' : ''}</p>`;
        else if (t === 'T') body += `<p class="tray-hint">Gerade ist kein Tausch möglich.</p><div class="tray-actions"><button class="btn primary" data-act="noEffect">Ohne Wirkung ablegen</button></div>`;
        else body += '<p class="tray-hint">Mit dieser Karte geht gerade kein Zug.</p>';
      }
    }
    body += `<details class="dfree"><summary>Frei verschieben / Karte ohne Zug ablegen</summary>
      <p class="tray-hint small">Du kannst jede Figur auch frei irgendwohin ziehen – wie am echten Tisch (ohne Regelprüfung). Danach die gespielte Karte ablegen:</p>
      <button class="btn small" data-act="discard"${selCard ? '' : ' disabled'}>Ausgewählte Karte ohne Zug ablegen</button></details>`;
  }
  void isHost;
  el.innerHTML = head + proxy + body;
}

function renderPlayers() {
  const { v, ctx } = info();
  q('#dplayers').innerHTML = [...v.players].sort((a, b) => a.seat - b.seat).map((p) => {
    const inGoal = (v.pieces[p.id] || []).filter((l) => l.z === 'g').length;
    const partner = v.mode === 'team' ? v.players.find((x) => x.id === partnerOf(ctx, p.id)) : null;
    return `<div class="pop${p.id === v.turn ? ' cur' : ''}${p.connected ? '' : ' off'}" style="--pc:${p.color}">
      <span class="pdot"></span><b>${esc(p.name)}${p.id === v.me ? ' (du)' : ''}</b>
      <span class="pcount">🂠 ${p.count}</span><span class="pphase">🏁 ${inGoal}/${v.mode === 'team' ? 4 : 4}</span>
      ${partner ? `<span class="muted small-text">Team mit ${esc(partner.name)}</span>` : ''}
      ${p.out ? '<span class="tag">raus diese Runde</span>' : ''}${v.phase === 'exchange' && p.gave ? '<span class="tag">✓ getauscht</span>' : ''}
      <span class="muted">🏆 ${p.wins}</span></div>`;
  }).join('');
}

function renderHand() {
  const { v, meP } = info();
  const el = q('#dhand');
  if (!meP || !v.started) { el.innerHTML = ''; return; }
  const sorted = [...v.hand].sort((a, b) => CARD_ORDER.indexOf(a.t) - CARD_ORDER.indexOf(b.t));
  el.innerHTML = `<div class="phand-bar"><b>Deine Karten (${v.hand.length})</b></div>
    <div class="phand-row">${sorted.map((c) => `<button class="dcardbtn ${CARDS[c.t].red ? 'red' : 'blue'}${selCard === c.id ? ' sel' : ''}${v.myGive === c.id ? ' given' : ''}" data-card="${c.id}" title="${esc(CARDS[c.t].text)}">
      <span class="dc-big">${esc(CARDS[c.t].short)}</span><span class="dc-corner">${esc(CARDS[c.t].short)}</span><span class="dc-name">${esc(CARDS[c.t].name)}</span></button>`).join('') || '<span class="muted">Keine Karten</span>'}</div>`;
}

// ---------- Züge ausführen ----------
function runOption(o, dragged) {
  const { v } = info();
  const c = cardOf(selCard);
  const base = { owner: o.owner, idx: o.idx, to: o.to, dragged };
  picked = null;
  if (v.seven) return C.act({ type: 'seven', ...base });
  const as = c.t === 'J' ? jokerAs : undefined;
  if (currentType() === '7') {
    C.act({ type: 'play', cid: c.id, as });
    C.act({ type: 'seven', ...base });
    return;
  }
  C.act({ type: 'play', cid: c.id, as, ...base, other: o.other });
}

// Nächstes Feld unter einem Punkt (für freies Verschieben)
function nearestLoc(v, owner, x, y) {
  let best = null, bd = 3.4;
  TRACK_XY.forEach(([a, b], i) => { const d = Math.hypot(a - x, b - y); if (d < bd) { bd = d; best = { z: 't', i }; } });
  const seat = seatOf(v, owner);
  GOAL_XY[seat].forEach(([a, b], k) => { const d = Math.hypot(a - x, b - y); if (d < bd) { bd = d; best = { z: 'g', k }; } });
  HOME_XY[seat].forEach(([a, b]) => { const d = Math.hypot(a - x, b - y); if (d < bd) { bd = d; best = { z: 'h' }; } });
  return best;
}

// ---------- Figuren ziehen ----------
const drag = { el: null, key: null, x0: 0, y0: 0, pid: null, on: false, justDropped: false };
function svgPoint(e) {
  const svg = q('.dboard');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  const el = e.target.closest('[data-piece]');
  if (!el) return;
  const { canAct } = info();
  if (!canAct) return;
  Object.assign(drag, { el, key: el.dataset.piece, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false });
}
function onMove(e) {
  if (!drag.el || e.pointerId !== drag.pid) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.on = true;
    picked = drag.key;
    renderBoard();
    drag.el = q(`#dpieces [data-piece="${drag.key}"]`);
    drag.el.classList.add('dragging');
    q('#dpieces').appendChild(drag.el); // nach oben
  }
  e.preventDefault();
  const p = svgPoint(e);
  drag.el.style.transform = `translate(${p.x.toFixed(2)}px, ${(p.y - 1.5).toFixed(2)}px) scale(1.25)`;
  const marks = [...document.querySelectorAll('#dmarks .dtarget')];
  marks.forEach((m) => m.classList.toggle('hot', Math.hypot(Number(m.getAttribute('cx')) - p.x, Number(m.getAttribute('cy')) - p.y) < 3.2));
}
function onUp(e, cancelled) {
  if (!drag.el || e.pointerId !== drag.pid) return;
  const d = { ...drag };
  Object.assign(drag, { el: null, on: false });
  if (!d.on) return; // war nur ein Antippen → click-Handler
  drag.justDropped = true;
  setTimeout(() => { drag.justDropped = false; }, 60);
  d.el.classList.remove('dragging');
  if (cancelled) { picked = null; return render(); }
  const { v } = info();
  const p = svgPoint(e);
  const [owner, idxS] = d.key.split(':');
  const idx = Number(idxS);
  // 1) Leuchtfeld getroffen → Zug nach Regeln
  const opts = currentOptions().filter((o) => `${o.owner}:${o.idx}` === d.key);
  let best = null, bd = 3.4;
  for (const o of opts) { const [x, y] = targetXY(v, o); const dd = Math.hypot(x - p.x, y - p.y); if (dd < bd) { bd = dd; best = o; } }
  if (best) return runOption(best, true);
  // 2) sonst freies Verschieben auf das nächste Feld
  const loc = nearestLoc(v, owner, p.x, p.y);
  picked = null;
  if (!loc || sameLoc(loc, v.pieces[owner][idx])) return render();
  if (v.seven) { toast('Während der 7 bitte nur auf leuchtende Felder ziehen.', 'error'); return render(); }
  C.act({ type: 'free', owner, idx, to: loc });
  toast('Frei verschoben (ohne Karte). „↶ Zurück“ macht es rückgängig.');
}
window.addEventListener('pointermove', onMove, { passive: false });
window.addEventListener('pointerup', (e) => onUp(e, false));
window.addEventListener('pointercancel', (e) => onUp(e, true));

// ---------- Bedienung ----------
function onAct(name) {
  const { v } = info();
  switch (name) {
    case 'undo': picked = null; return C.act({ type: 'undo' });
    case 'log': return toggleLog(C.ui);
    case 'menu': return openMenu();
    case 'copy': return C.copyLink();
    case 'start': return C.act({ type: 'start' });
    case 'leave': return C.leave();
    case 'give': if (selCard) { const id = selCard; selCard = null; C.act({ type: 'give', cid: id }); } return;
    case 'cancelSeven': selCard = null; return C.act({ type: 'cancelSeven' });
    case 'noEffect': { const c = cardOf(selCard); if (c) C.act({ type: 'play', cid: c.id, as: c.t === 'J' ? 'T' : undefined, noEffect: true }); selCard = null; return; }
    case 'discard': if (selCard) { const id = selCard; confirmModal('Karte ohne Zug ablegen?', 'Die Karte wird abgelegt und dein Zug ist vorbei.', () => { selCard = null; C.act({ type: 'discard', cid: id }); }); } return;
    case 'stuck': if (selCard) { const id = selCard; selCard = null; C.act({ type: 'stuck', cid: id }); } return;
    case 'newGame': return C.act({ type: 'newGame' });
  }
  void v;
}
function openMenu() {
  const { isHost } = info();
  const items = [['Spielregeln', showRules], ['Die Karten', showCards]];
  items.push(['Neues Spiel', () => confirmModal('Neues Spiel starten?', 'Alle Figuren gehen zurück in den Zwinger.', () => C.act({ type: 'newGame' }))]);
  items.push(['Meinen Namen ändern', C.openRename]);
  items.push(['Einladungslink kopieren', C.copyLink]);
  if (isHost) items.push(['Siege zurücksetzen', () => confirmModal('Siege zurücksetzen?', 'Alle Siege werden auf 0 gesetzt.', () => C.act({ type: 'resetWins' }))]);
  items.push([C.ui.mode === 'host' ? 'Raum schließen' : 'Raum verlassen', C.leave, 'danger']);
  listModal('Menü', items);
}
function showRules() {
  modal(`<h2>Spielregeln: ${esc(C.ui.deck.name)}</h2><ul class="rules">${RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted small-text">So geht's hier: Karte wählen → Figur anfassen → auf ein leuchtendes Feld ziehen. Woanders hingezogen ist es ein freier Zug ohne Regelprüfung (danach die Karte „ohne Zug ablegen“). Vertippt? „↶ Zurück“.</p>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}
function showCards() {
  modal(`<h2>Die Karten</h2><div class="dcardlist">${CARD_ORDER.map((t) => `<div><span class="dmini ${CARDS[t].red ? 'red' : 'blue'}">${esc(CARDS[t].short)}</span><span>${esc(CARDS[t].text)}</span></div>`).join('')}</div>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}

function bind(g) {
  g.addEventListener('pointerdown', onDown);
  g.addEventListener('click', (e) => {
    if (drag.justDropped) return;
    const t = e.target;
    const a = t.closest('[data-act]');
    if (a) { if (!a.disabled) onAct(a.dataset.act); return; }
    if (t.closest('#codeBtn')) return C.copyLink();
    const as = t.closest('[data-as]');
    if (as) { jokerAs = as.dataset.as; picked = null; return render(); }
    const card = t.closest('[data-card]');
    if (card) {
      const { v } = info();
      if (v.seven) return toast('Erst die 7 zu Ende ziehen.', 'error');
      selCard = selCard === card.dataset.card ? null : card.dataset.card;
      jokerAs = null;
      picked = null;
      return render();
    }
    const mark = t.closest('[data-opt]');
    if (mark && picked) {
      const opts = currentOptions().filter((o) => `${o.owner}:${o.idx}` === picked);
      const o = opts[Number(mark.dataset.opt)];
      if (o) runOption(o, false);
      return;
    }
    const pc = t.closest('[data-piece]');
    if (pc) {
      const { canAct } = info();
      if (!canAct) return;
      picked = picked === pc.dataset.piece ? null : pc.dataset.piece;
      if (picked && !currentOptions().some((o) => `${o.owner}:${o.idx}` === picked)) toast(selCard || info().v.seven ? 'Diese Figur kann mit der Karte nicht ziehen – du kannst sie aber frei verschieben.' : 'Erst eine Karte wählen.');
      return renderBoard();
    }
  });
}
void movers;
