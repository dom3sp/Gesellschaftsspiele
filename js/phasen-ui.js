// Oberfläche für das Phasen-Brettspiel: Spielbrett mit Steinen, Hand, Auslagen, Aktionen.
import { q, esc, modal, closeModal, listModal, confirmModal, lobbyHtml, toggleLog, applyLog, toast } from './ui.js';
import { faceInner } from './dice-ui.js';
import {
  BOARD, FIELD_TYPES, RAINBOW_CHOICES, GROUP_NAMES, PHASES, RULES, CARD_COLORS, GOAL,
  groupLabel, buildGroup, fitCard,
} from './phasen.js';

let C = null; // { ui, act, copyLink, leave, openRename }
export function initPhasenUI(ctx) { C = ctx; }

const randInt = (n) => Math.floor(Math.random() * n);
const L = BOARD.length;

// ---------- lokale Zustände ----------
const sel = new Set();             // ausgewählte Handkarten
let lay = null;                    // { groups: [[ids]...] } beim Phase-Auslegen
let sortBy = 'num';                // Hand sortieren nach Zahl oder Farbe
let lastKey = '';
const dice = { until: 0, timer: null };
const walk = { pid: null, path: [], i: 0, timer: null };
const rolling = () => performance.now() < dice.until;

export function onPhasenEvent(ev) {
  if (ev.kind === 'roll') dice.until = performance.now() + 800;
  if (ev.kind === 'move') {
    clearInterval(walk.timer);
    Object.assign(walk, { pid: ev.pid, path: ev.path, i: 0 });
    walk.timer = setInterval(() => {
      walk.i++;
      if (walk.i >= walk.path.length) { clearInterval(walk.timer); walk.timer = null; walk.pid = null; render(); return; }
      placePieces();
    }, 190);
  }
}

// ---------- Geometrie des Bretts (SVG 0..100) ----------
const deg = (a) => (a * Math.PI) / 180;
const SLOT_R = 37.6;
function slotXY(field) {
  const a = deg(field * (360 / L) - 90);
  return [50 + SLOT_R * Math.cos(a), 50 + SLOT_R * Math.sin(a)];
}
const SECT = 360 / 11; // 10 Phasen + Lorbeerkranz
function sectorPath(k, r1, r2) {
  const a0 = deg(-90 + k * SECT - SECT / 2 + 0.6), a1 = deg(-90 + k * SECT + SECT / 2 - 0.6);
  const p = (r, a) => `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(r2, a0)} A${r2} ${r2} 0 0 1 ${p(r2, a1)} L${p(r1, a1)} A${r1} ${r1} 0 0 0 ${p(r1, a0)} Z`;
}
function markerXY(phase, idx, count) {
  const k = phase >= GOAL ? 0 : phase;
  const spread = count > 1 ? (idx - (count - 1) / 2) * 5.2 : 0;
  const a = deg(-90 + k * SECT + spread);
  const r = 21.3 + (count > 3 ? (idx % 2) * 3 : 0);
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
}
const ICON = { g1: '+1', g2: '+2', g3: '+3', b: '🃏', p: '+1↻', gr: '🔍', m: '⇅', l: '👥', o: '❓', r: '★' };

function boardSvg() {
  const fields = BOARD.map((t, i) => {
    const ft = FIELD_TYPES[t];
    const start = i === 0;
    return `<g transform="rotate(${(i * 360) / L} 50 50)" class="bfield" data-field="${i}">
      <rect x="${start ? 45.6 : 46.35}" y="${start ? 2.2 : 3}" width="${start ? 8.8 : 7.3}" height="${start ? 14.6 : 13.2}" rx="1.4" fill="${ft.color}" stroke="${start ? '#fff' : 'rgba(0,0,0,.35)'}" stroke-width="${start ? 0.5 : 0.25}"/>
      <rect x="${start ? 45.6 : 46.35}" y="${start ? 2.2 : 3}" width="${start ? 8.8 : 7.3}" height="2.2" rx="1" fill="rgba(255,255,255,.22)"/>
      <circle cx="50" cy="12.4" r="2.5" fill="rgba(0,0,0,.28)"/>
      <text x="50" y="${start ? 7.6 : 7.9}" text-anchor="middle" class="ficon${t.startsWith('g') ? ' num' : ''}">${ICON[t]}</text>
    </g>`;
  }).join('');
  const sectors = Array.from({ length: 11 }, (_, k) => {
    const c = deg(-90 + k * SECT);
    const tx = 50 + 26.6 * Math.cos(c), ty = 50 + 26.6 * Math.sin(c);
    const label = k === 0 ? '🏆' : String(k);
    return `<path d="${sectorPath(k, 17.2, 31.6)}" class="psect${k === 0 ? ' goal' : ''}" data-phase="${k}"/>
      <text x="${tx.toFixed(2)}" y="${(ty + 1.3).toFixed(2)}" text-anchor="middle" class="plabel${k === 0 ? ' goal' : ''}">${label}</text>`;
  }).join('');
  return `<svg class="pboard" viewBox="0 0 100 100" role="img" aria-label="Spielbrett">
    <rect x="0.5" y="0.5" width="99" height="99" rx="4" class="bbg"/>
    <circle cx="50" cy="50" r="48.6" class="bring"/>
    ${fields}
    <circle cx="50" cy="50" r="32.6" class="bring2"/>
    ${sectors}
    <circle cx="50" cy="50" r="16.4" class="bcenter"/>
    <g id="pcenter"></g>
    <g id="pmarkers"></g>
    <g id="ppieces"></g>
  </svg>`;
}

function cardSvg(x, y, w, h, card, act, label) {
  if (!card) return `<g${act ? ` data-act="${act}" class="clickable"` : ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" class="cslot"/><text x="${x + w / 2}" y="${y + h / 2 + 1}" text-anchor="middle" class="ctext small">leer</text>${label}</g>`;
  if (card === 'back') {
    return `<g${act ? ` data-act="${act}" class="clickable"` : ''}>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" fill="#fff"/>
      <rect x="${x + 0.7}" y="${y + 0.7}" width="${w / 2 - 0.7}" height="${h / 2 - 0.7}" fill="#5c4bd1"/><rect x="${x + w / 2}" y="${y + 0.7}" width="${w / 2 - 0.7}" height="${h / 2 - 0.7}" fill="#e03131"/>
      <rect x="${x + 0.7}" y="${y + h / 2}" width="${w / 2 - 0.7}" height="${h / 2 - 0.7}" fill="#f59f00"/><rect x="${x + w / 2}" y="${y + h / 2}" width="${w / 2 - 0.7}" height="${h / 2 - 0.7}" fill="#2f9e44"/>
      ${label}</g>`;
  }
  return `<g${act ? ` data-act="${act}" class="clickable"` : ''}>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" fill="#fff" stroke="${COLHEX[card.c]}" stroke-width="0.6"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 2.4}" text-anchor="middle" class="ctext" fill="${COLHEX[card.c]}">${card.n}</text>${label}</g>`;
}
const COLHEX = { r: '#e03131', b: '#5c4bd1', y: '#f59f00', g: '#2f9e44' };

// Steine, Phasenanzeiger, Stapel aktualisieren (ohne das Brett neu zu bauen)
function placePieces() {
  const v = C.ui.view;
  const g = q('#ppieces');
  if (!g || !v) return;
  const pos = (p) => (walk.pid === p.id && walk.path.length ? walk.path[Math.min(walk.i, walk.path.length - 1)] : p.pos);
  const atStart = v.players.filter((p) => pos(p) === 0);
  let html = g.innerHTML ? null : '';
  for (const p of v.players) {
    let [x, y] = slotXY(pos(p));
    if (pos(p) === 0 && atStart.length > 1) {
      const k = atStart.indexOf(p);
      x += (k - (atStart.length - 1) / 2) * 2.4;
      y += (k % 2) * 2.2 - 1;
    }
    const el = g.querySelector(`[data-piece="${p.id}"]`);
    const tf = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    if (el) el.style.transform = tf;
    else {
      if (html === null) html = '';
      html += `<g class="piece${p.id === v.turn ? ' cur' : ''}" data-piece="${p.id}" style="transform:${tf}"><circle r="2.7" class="pshadow" cy="0.6"/><circle r="2.5" fill="${p.color}" stroke="${p.color === '#f1f3f5' ? '#888' : '#fff'}" stroke-width="0.5"/><circle r="1.2" fill="rgba(255,255,255,.35)" cx="-0.6" cy="-0.7"/></g>`;
    }
  }
  if (html) g.insertAdjacentHTML('beforeend', html);
}

function renderBoard() {
  const v = C.ui.view;
  let wrap = q('#pboardWrap');
  if (!wrap.querySelector('svg')) wrap.innerHTML = boardSvg();
  // Steine neu (Klassen ändern sich), Position mit Animation
  const g = q('#ppieces');
  const old = new Map([...g.querySelectorAll('[data-piece]')].map((el) => [el.dataset.piece, el.style.transform]));
  g.innerHTML = '';
  for (const p of v.players) {
    if (old.has(p.id)) g.insertAdjacentHTML('beforeend', `<g class="piece${p.id === v.turn ? ' cur' : ''}" data-piece="${p.id}" style="transform:${old.get(p.id)}"><circle r="2.7" class="pshadow" cy="0.6"/><circle r="2.5" fill="${p.color}" stroke="${p.color === '#f1f3f5' ? '#888' : '#fff'}" stroke-width="0.5"/><circle r="1.2" fill="rgba(255,255,255,.35)" cx="-0.6" cy="-0.7"/></g>`);
  }
  void g.getBoundingClientRect(); // alte Position übernehmen, damit der Übergang animiert
  placePieces();
  // Phasenanzeiger
  const byPhase = {};
  for (const p of v.players) (byPhase[Math.min(p.phase, GOAL)] = byPhase[Math.min(p.phase, GOAL)] || []).push(p);
  q('#pmarkers').innerHTML = v.players.map((p) => {
    const list = byPhase[Math.min(p.phase, GOAL)];
    const [x, y] = markerXY(p.phase, list.indexOf(p), list.length);
    return `<g class="marker" style="transform:translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)"><circle r="1.9" fill="${p.color}" stroke="${p.color === '#f1f3f5' ? '#888' : '#fff'}" stroke-width="0.45"/>${p.laid ? '<circle r="0.7" fill="#fff"/>' : ''}</g>`;
  }).join('');
  // Stapel in der Mitte
  const { canAct } = info();
  const takeNow = canAct && v.step === 'action' && v.pending && v.pending.type === 'take';
  q('#pcenter').innerHTML =
    cardSvg(37.6, 42.2, 11, 15.6, v.drawCount ? 'back' : null, takeNow && v.drawCount ? 'takeDraw' : '', `<text x="43.1" y="60.6" text-anchor="middle" class="ctext small light">${v.drawCount}</text>`) +
    cardSvg(51.4, 42.2, 11, 15.6, v.discardTop, takeNow && v.discardTop ? 'takeDiscard' : '', `<text x="56.9" y="60.6" text-anchor="middle" class="ctext small light">${v.discardCount}</text>`) +
    (takeNow ? '<circle cx="50" cy="50" r="15.6" class="pulse-ring"/>' : '');
  // aktives Feld hervorheben
  wrap.querySelectorAll('.bfield.hl').forEach((e) => e.classList.remove('hl'));
  const turnP = v.players.find((p) => p.id === v.turn);
  if (turnP && v.step !== 'roll' && v.step !== 'move' && !walk.pid) wrap.querySelector(`.bfield[data-field="${turnP.pos}"]`)?.classList.add('hl');
}

// ---------- Hilfen ----------
function info() {
  const v = C.ui.view;
  const meP = v.players.find((p) => p.id === v.me);
  const turnP = v.players.find((p) => p.id === v.turn) || null;
  const isHost = !!(meP && meP.host);
  const running = v.started && !v.finished;
  const canAct = !!(running && turnP && (turnP.id === v.me || (isHost && !turnP.connected)));
  const myTurn = !!(turnP && turnP.id === v.me);
  return { v, meP, turnP, isHost, running, canAct, myTurn };
}
// Wohin käme der Stein? (gleiche Regel wie im Spiel: besetzte Felder zählen nicht)
function landing(v, pid, steps) {
  const occ = new Set(v.players.filter((p) => p.id !== pid && p.pos !== 0).map((p) => p.pos));
  let pos = v.players.find((p) => p.id === pid).pos;
  while (steps > 0) { pos = (pos + 1) % L; if (!occ.has(pos)) steps--; }
  return pos;
}
function freeOf(v, pid, group) {
  const me = v.players.find((p) => p.id === pid);
  const occ = new Set(v.players.filter((p) => p.id !== pid && p.pos !== 0).map((p) => p.pos));
  for (let k = 1; k < L; k++) {
    const f = (me.pos + k) % L;
    if (FIELD_TYPES[BOARD[f]].group === group && !occ.has(f)) return f;
  }
  return -1;
}
const handCard = (id) => C.ui.view.hand.find((h) => h.id === id);
function cardHtml(c, opts = {}) {
  const cls = ['pc'];
  if (c.j) cls.push('joker');
  else cls.push(`pc-${c.c}`);
  if (opts.sel) cls.push('sel');
  if (opts.small) cls.push('small');
  if (opts.dim) cls.push('dim');
  const inner = c.j
    ? `<span class="pj">J</span>${opts.showV && c.v ? `<span class="pv">${c.v}</span>` : ''}`
    : `<span class="pn">${c.n}</span><span class="pcorner">${c.n}</span>`;
  return `<${opts.tag || 'div'} class="${cls.join(' ')}"${opts.attr || ''}>${inner}</${opts.tag || 'div'}>`;
}
function sortedHand() {
  const h = [...C.ui.view.hand];
  const key = (c) => (c.j ? 1000 : sortBy === 'num' ? c.n * 10 + 'rbyg'.indexOf(c.c) : 'rbyg'.indexOf(c.c) * 100 + c.n);
  return h.sort((a, b) => key(a) - key(b));
}

// ---------- Aufbau ----------
function skeleton() {
  return `
  <div id="game" class="game phasen-game">
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
          <section class="pleft"><div id="pboardWrap" class="pboard-wrap"></div></section>
          <section class="pright">
            <div id="ppanel" class="tray ppanel"></div>
            <div id="pothers" class="pothers"></div>
            <div id="pmelds" class="pmelds"></div>
          </section>
        </div>
      </div>
      <aside id="log" class="log"><div class="log-head">Verlauf <button class="icon-btn" data-act="log" aria-label="Schließen">✕</button></div><ol id="logList"></ol></aside>
    </div>
    <section id="phand" class="phand"></section>
    <div id="lobby"></div>
  </div>`;
}

export function render() {
  const ui = C.ui;
  const v = ui.view;
  if (!v || !ui.deck) return;
  let g = q('#game.phasen-game');
  if (!g) {
    document.getElementById('app').innerHTML = skeleton();
    g = q('#game.phasen-game');
    bind(g);
  }
  // Auswahl aufräumen, wenn sich der Spielstand grundlegend geändert hat
  const key = `${v.game}:${v.durchgang}:${v.turn}:${v.step}:${v.pending ? v.pending.type : ''}`;
  if (key !== lastKey) {
    if (v.step !== 'play' || !lastKey.includes(':play')) lay = null;
    lastKey = key;
  }
  for (const id of [...sel]) if (!handCard(id)) sel.delete(id);
  if (lay) lay.groups = lay.groups.map((gr) => gr.filter((id) => handCard(id)));

  applyLog(ui);
  q('#codeBtn b').textContent = ui.code || '';
  q('#deckName').textContent = `${ui.deck.name} · Spiel ${v.game}${v.durchgang ? ` · Durchgang ${v.durchgang}` : ''}`;
  const undoBtn = q('#undoBtn');
  undoBtn.disabled = !v.undo;
  undoBtn.title = v.undo ? `Zurücknehmen: ${v.undo}` : 'Du hast gerade nichts zum Zurücknehmen';

  renderBoard();
  renderPanel();
  renderOthers();
  renderMelds();
  renderHand();

  const logList = q('#logList');
  logList.innerHTML = v.log.map((e) => `<li>${esc(e.text)}</li>`).join('');
  logList.scrollTop = logList.scrollHeight;

  q('#lobby').innerHTML = v.started ? '' : lobbyHtml({
    title: ui.deck.name, view: v, minPlayers: ui.deck.minPlayers, maxPlayers: ui.deck.maxPlayers,
    code: ui.code, isHost: ui.mode === 'host',
  });
  q('#status').hidden = !ui.lost;

  if (rolling() && !dice.timer) {
    dice.timer = setInterval(() => {
      if (!rolling()) { clearInterval(dice.timer); dice.timer = null; render(); return; }
      document.querySelectorAll('.pdie.rolling .face').forEach((el) => { el.innerHTML = faceInner(1 + randInt(6), 6); });
    }, 70);
  }
}

// ---------- Aktionsbereich ----------
function diceHtml(v) {
  if (!v.dice) return '';
  const r = rolling();
  return `<div class="dice pdice">${v.dice.map((d) => `<div class="die pdie${r ? ' rolling' : ''}"${r ? ` style="--spin:${(randInt(2) ? 1 : -1) * (300 + randInt(260))}deg;--dur:${0.6 + Math.random() * 0.2}s"` : ''}><span class="face">${faceInner(r ? 1 + randInt(6) : d, 6)}</span></div>`).join('')}</div>`;
}

function renderPanel() {
  const { v, meP, turnP, canAct, myTurn, isHost } = info();
  const el = q('#ppanel');
  if (v.finished) {
    const res = [...v.players].sort((a, b) => b.phase - a.phase);
    el.innerHTML = `<div class="results">
      <div class="trophy-big">🏆</div><h2>Spiel ${v.game} ist vorbei</h2>
      <ol class="ranking">${res.map((p) => `<li class="${p.phase >= GOAL ? 'win' : ''}" style="--pc:${p.color}"><span class="dot"></span><b>${esc(p.name)}</b><span class="pts">${p.phase >= GOAL ? '🏆' : `Phase ${p.phase}`}</span></li>`).join('')}</ol>
      <div class="tray-actions"><button class="btn primary big" data-act="newGame">Neues Spiel</button></div></div>`;
    return;
  }
  if (v.step === 'keep') {
    const mine = v.keepPending.includes(v.me);
    const waiting = v.players.filter((p) => v.keepPending.includes(p.id));
    let body = `<h3 class="ptitle">Durchgang ${v.durchgang} ist vorbei</h3>`;
    if (mine) body += `<p class="tray-hint">Du hast deine Phase nicht geschafft und darfst <b>5 Karten behalten</b>. Wähle sie unten aus (${sel.size}/5).</p>
      <div class="tray-actions"><button class="btn primary big" data-act="keep"${sel.size === 5 ? '' : ' disabled'}>Diese 5 behalten</button></div>`;
    else body += `<p class="tray-hint">Warte, bis ${waiting.map((p) => esc(p.name)).join(', ')} 5 Karten ausgewählt ${waiting.length > 1 ? 'haben' : 'hat'}.</p>`;
    if (isHost) for (const p of waiting) if (!p.connected && p.id !== v.me) body += `<button class="btn small" data-keepauto="${p.id}">Für ${esc(p.name)} automatisch wählen</button>`;
    el.innerHTML = body;
    return;
  }
  if (!turnP) { el.innerHTML = ''; return; }
  const ph = meP ? PHASES[Math.min(meP.phase, 10)] : null;
  const head = `<div class="turn" style="--pc:${turnP.color}"><span class="dot"></span><b>${myTurn ? 'Du bist dran!' : `${esc(turnP.name)} ist dran`}</b>${v.extra ? '<span class="tag">+ Extra-Zug</span>' : ''}</div>`;
  const myPhase = meP && ph ? `<div class="pmyphase"><span>Deine Phase ${meP.phase}</span><b>${esc(ph.text)}</b>${meP.laid ? '<em>✓ liegt aus</em>' : ''}</div>` : '';
  let body = '';
  const proxy = canAct && !myTurn ? `<p class="tray-hint">${esc(turnP.name)} ist offline – du spielst für ${esc(turnP.name)}.</p>` : '';

  if (!canAct) {
    const what = {
      roll: 'würfelt gleich', move: 'wählt einen Würfel', action: 'führt die Aktion aus', play: 'legt aus oder wirft ab',
    }[v.step] || '';
    body = `${diceHtml(v)}<p class="tray-hint">${esc(turnP.name)} ${what} …</p>`;
  } else if (v.step === 'roll') {
    body = `<div class="tray-actions"><button class="btn primary big" data-act="roll">🎲 Würfeln</button></div><p class="tray-hint">Schritt 1: würfeln und den Stein ziehen.</p>`;
  } else if (v.step === 'move') {
    if (rolling()) body = diceHtml(v);
    else {
      const [a, b] = v.dice;
      const opts = a === b ? [[0, a], [2, a * 2]] : [[0, a], [1, b]];
      body = `${diceHtml(v)}<p class="tray-hint">Welchen Wert nimmst du?</p><div class="pmoves">${opts.map(([use, n]) => {
        const f = landing(v, turnP.id, n);
        const ft = FIELD_TYPES[BOARD[f]];
        return `<button class="btn pmove" data-move="${use}" style="--fc:${ft.color}"><b>${n} ${n === 1 ? 'Feld' : 'Felder'}</b><small>→ ${esc(ft.name)}</small></button>`;
      }).join('')}</div>`;
    }
  } else if (v.step === 'action') {
    const pd = v.pending || {};
    const ft = FIELD_TYPES[BOARD[turnP.pos]];
    body = `<div class="paction" style="--fc:${ft.color}"><b>${esc(ft.name)}</b><span>${esc(ft.help)}</span></div>`;
    if (pd.type === 'take') {
      body += `<p class="tray-hint">Noch ${pd.left} ${pd.left === 1 ? 'Karte' : 'Karten'} nehmen – woher?</p><div class="tray-actions">
        <button class="btn primary" data-act="takeDraw"${v.drawCount ? '' : ' disabled'}>Aufnahmestapel (verdeckt)</button>
        <button class="btn" data-act="takeDiscard"${v.discardTop ? '' : ' disabled'}>Ablage: ${v.discardTop ? `${CARD_COLORS[v.discardTop.c]} ${v.discardTop.n}` : 'leer'}</button></div>`;
    } else if (pd.type === 'green') {
      body += `<div class="tray-actions"><button class="btn primary" data-act="green">Ablagestapel durchsuchen</button></div>`;
    } else if (pd.type === 'magenta') {
      body += `<p class="tray-hint">Wähle unten 1–4 Karten zum Abwerfen (${sel.size} gewählt).</p><div class="tray-actions">
        <button class="btn primary" data-act="magenta"${sel.size >= 1 && sel.size <= 4 ? '' : ' disabled'}>${sel.size || '…'} abwerfen, ${sel.size ? sel.size + 1 : '…'} nehmen</button></div>`;
    } else if (pd.type === 'orange') {
      body += `<div class="porange"><div class="pdir"><button class="btn small${orangeDir === 1 ? ' on' : ''}" data-dir="1">↻ im Uhrzeigersinn</button><button class="btn small${orangeDir === -1 ? ' on' : ''}" data-dir="-1">↺ gegen den Uhrzeigersinn</button></div>
        <p class="tray-hint">Nach welcher Zahl fragst du?</p><div class="pnums">${Array.from({ length: 12 }, (_, i) => `<button class="btn" data-ask="${i + 1}">${i + 1}</button>`).join('')}</div></div>`;
    } else if (pd.type === 'rainbow') {
      body += `<p class="tray-hint">Welche Aktion wählst du?</p><div class="prainbow">${RAINBOW_CHOICES.map((k) => {
        const f = freeOf(v, turnP.id, k);
        const col = FIELD_TYPES[BOARD[f]]?.color || '#666';
        return `<button class="btn" data-rainbow="${k}" style="--fc:${col}"${f < 0 ? ' disabled title="alle Felder besetzt"' : ''}>${esc(GROUP_NAMES[k])}</button>`;
      }).join('')}</div>`;
    }
  } else if (v.step === 'play') {
    const me = v.players.find((p) => p.id === turnP.id);
    if (lay) body = layPanel(me);
    else {
      body = `<p class="tray-hint">Schritt 2: Phase auslegen oder anlegen (freiwillig) – Schritt 3: eine Karte abwerfen.</p>
      <div class="tray-actions">
        ${!me.laid ? '<button class="btn primary" data-act="layStart">Phase auslegen …</button>' : ''}
        <button class="btn ${me.laid ? 'primary' : ''}" data-act="discard"${sel.size === 1 ? '' : ' disabled'}>${sel.size === 1 ? 'Ausgewählte Karte abwerfen' : 'Zum Abwerfen 1 Karte wählen'}</button>
      </div>
      ${me.laid ? '<p class="tray-hint small">Anlegen: Karte unten antippen, dann auf eine Auslage tippen.</p>' : ''}`;
    }
  }
  el.innerHTML = head + proxy + body + myPhase;
}
let orangeDir = 1;

function layPanel(me) {
  const ph = PHASES[me.phase];
  const rows = ph.groups.map((g, gi) => {
    const ids = lay.groups[gi];
    const res = ids.length ? buildGroup(g, ids.map(handCard)) : null;
    const ok = res && !res.error;
    return `<div class="playgroup${ok ? ' ok' : ''}">
      <div class="plg-head"><b>${gi + 1}. ${esc(groupLabel(g))}</b>${ok ? '<span class="okmark">✓</span>' : ''}</div>
      <div class="plg-cards">${ids.map((id) => cardHtml(handCard(id), { small: true, tag: 'button', attr: ` data-unlay="${id}"` })).join('') || '<span class="muted small-text">noch leer</span>'}</div>
      ${res && res.error ? `<div class="plg-err">${esc(res.error)}</div>` : ''}
      <button class="btn small" data-addto="${gi}"${sel.size ? '' : ' disabled'}>＋ ${sel.size || ''} ausgewählte hinzufügen</button>
    </div>`;
  }).join('');
  const allOk = ph.groups.every((g, gi) => lay.groups[gi].length && !buildGroup(g, lay.groups[gi].map(handCard)).error);
  return `<h3 class="ptitle">Phase ${me.phase} auslegen: ${esc(ph.text)}</h3>
    <p class="tray-hint small">Karten unten antippen und dem passenden Teil hinzufügen. Antippen im Teil nimmt sie wieder heraus.</p>
    ${rows}
    <div class="tray-actions"><button class="btn primary" data-act="layDo"${allOk ? '' : ' disabled'}>✓ Phase auslegen</button><button class="btn ghost" data-act="layCancel">Abbrechen</button></div>`;
}

// ---------- Mitspieler, Auslagen, Hand ----------
function renderOthers() {
  const { v } = info();
  q('#pothers').innerHTML = v.players.map((p) => `
    <div class="pop${p.id === v.turn ? ' cur' : ''}${p.connected ? '' : ' off'}" style="--pc:${p.color}">
      <span class="pdot"></span><b>${esc(p.name)}${p.id === v.me ? ' (du)' : ''}</b>
      <span class="pphase">Phase ${Math.min(p.phase, 10)}${p.laid ? ' ✓' : ''}</span>
      <span class="pcount">🂠 ${p.count}</span>
      <span class="muted">🏆 ${p.wins}</span>
      ${p.jokers && p.jokers.length ? `<span class="pjokers" title="Joker auf der Hand (Vorderseite)">${p.jokers.map((c) => cardHtml(c, { small: true })).join('')}</span>` : ''}
    </div>`).join('');
}

function renderMelds() {
  const { v, canAct, turnP } = info();
  const el = q('#pmelds');
  if (!v.melds.length) { el.innerHTML = ''; return; }
  const actor = turnP ? v.players.find((p) => p.id === turnP.id) : null;
  const canAppend = canAct && v.step === 'play' && actor && actor.laid && sel.size === 1 && !lay;
  const owners = [...new Set(v.melds.map((m) => m.owner))];
  el.innerHTML = `<h3 class="ptitle">Ausgelegte Phasen</h3>` + owners.map((oid) => {
    const p = v.players.find((x) => x.id === oid);
    const ms = v.melds.filter((m) => m.owner === oid);
    return `<div class="pmeldrow" style="--pc:${p ? p.color : '#999'}"><div class="pmr-name"><span class="pdot"></span>${esc(p ? p.name : 'Weg')}</div>
      <div class="pmr-groups">${ms.map((m) => {
        const label = m.kind === 'set' ? `${m.val}er` : m.kind === 'color' ? CARD_COLORS[m.col] : `${m.lo}–${m.hi}`;
        let fits = false;
        if (canAppend) { const c = handCard([...sel][0]); fits = c && !fitCard(m, c).error; }
        return `<button class="pmeld${canAppend ? (fits ? ' fits' : ' nofit') : ''}" data-meld="${m.id}"${canAppend ? '' : ' tabindex="-1"'}>
          <span class="pml">${esc(label)}</span><span class="pmc">${m.cards.map((c) => cardHtml(c, { small: true, showV: true })).join('')}</span></button>`;
      }).join('')}</div></div>`;
  }).join('');
}

function renderHand() {
  const { v, meP } = info();
  const el = q('#phand');
  if (!meP || !v.started) { el.innerHTML = ''; return; }
  const inLay = new Set(lay ? lay.groups.flat() : []);
  const cards = sortedHand().filter((c) => !inLay.has(c.id));
  el.innerHTML = `<div class="phand-bar"><b>Deine Hand (${v.hand.length})</b>
      <button class="btn ghost small" data-act="sort">Sortieren: ${sortBy === 'num' ? 'Zahl' : 'Farbe'}</button>
      ${sel.size ? `<button class="btn ghost small" data-act="unsel">Auswahl aufheben (${sel.size})</button>` : ''}</div>
    <div class="phand-row">${cards.map((c) => cardHtml(c, { sel: sel.has(c.id), tag: 'button', attr: ` data-card="${c.id}"` })).join('') || '<span class="muted">Keine Karten</span>'}</div>`;
}

// ---------- Bedienung ----------
function openGreen() {
  const v = C.ui.view;
  if (!v.discardAll) return;
  modal(`<h2>Ablagestapel durchsuchen</h2><p class="muted">Tippe die Karte an, die du nehmen möchtest (oben = zuletzt abgelegt).</p>
    <div class="pgreen">${v.discardAll.map((c) => cardHtml(c, { tag: 'button', attr: ` data-green="${c.id}"` })).join('')}</div>
    <div class="row end"><button class="btn ghost" data-close>Schließen</button></div>`, (m) => {
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-green]');
      if (!b) return;
      closeModal();
      C.act({ type: 'green', cid: b.dataset.green });
    });
  });
}

function onAct(name) {
  const { v } = info();
  switch (name) {
    case 'undo': lay = null; return C.act({ type: 'undo' });
    case 'log': return toggleLog(C.ui);
    case 'menu': return openMenu();
    case 'copy': return C.copyLink();
    case 'start': return C.act({ type: 'start' });
    case 'leave': return C.leave();
    case 'roll': return C.act({ type: 'roll' });
    case 'takeDraw': return C.act({ type: 'take', from: 'draw' });
    case 'takeDiscard': return C.act({ type: 'take', from: 'discard' });
    case 'green': return openGreen();
    case 'magenta': { const ids = [...sel]; sel.clear(); return C.act({ type: 'magenta', cids: ids }); }
    case 'discard': {
      if (sel.size !== 1) return toast('Wähle genau 1 Karte zum Abwerfen.', 'error');
      const id = [...sel][0];
      sel.clear();
      return C.act({ type: 'discard', cid: id });
    }
    case 'layStart': {
      const me = v.players.find((p) => p.id === v.turn);
      lay = { groups: PHASES[me.phase].groups.map(() => []) };
      return render();
    }
    case 'layCancel': lay = null; return render();
    case 'layDo': { const groups = lay.groups; lay = null; sel.clear(); return C.act({ type: 'lay', groups }); }
    case 'keep': { const ids = [...sel]; sel.clear(); return C.act({ type: 'keep', cids: ids }); }
    case 'sort': sortBy = sortBy === 'num' ? 'col' : 'num'; return renderHand();
    case 'unsel': sel.clear(); return render();
    case 'newGame': return C.act({ type: 'newGame' });
  }
}

function openMenu() {
  const { v, isHost } = info();
  const items = [['Spielregeln', showRules], ['Die 10 Phasen', showPhases], ['Die Aktionsfelder', showFields]];
  items.push(['Neues Spiel', () => confirmModal('Neues Spiel starten?', 'Alle Steine gehen zurück auf Start und alle beginnen wieder bei Phase 1.', () => C.act({ type: 'newGame' }))]);
  items.push(['Meinen Namen ändern', C.openRename]);
  items.push(['Einladungslink kopieren', C.copyLink]);
  if (isHost) {
    items.push(['Siege zurücksetzen', () => confirmModal('Siege zurücksetzen?', 'Alle Siege werden auf 0 gesetzt.', () => C.act({ type: 'resetWins' }))]);
    for (const p of v.players) {
      if (p.id !== v.me) items.push([`${p.name} aus dem Raum entfernen`, () => confirmModal(`${p.name} entfernen?`, 'Die Handkarten kommen zurück in den Aufnahmestapel.', () => C.act({ type: 'kick', pid: p.id })), 'danger']);
    }
  }
  items.push([C.ui.mode === 'host' ? 'Raum schließen' : 'Raum verlassen', C.leave, 'danger']);
  listModal('Menü', items);
}
function showRules() {
  modal(`<h2>Spielregeln: ${esc(C.ui.deck.name)}</h2><ul class="rules">${RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted small-text">Die Website prüft Phasen und Anlegen und rückt die Phasenanzeiger automatisch vor. Vertippt? „↶ Zurück“ – das geht bis zum nächsten Würfeln.</p>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}
function showPhases() {
  modal(`<h2>Die 10 Phasen</h2><ol class="rules pphases">${PHASES.slice(1).map((p) => `<li>${esc(p.text)}</li>`).join('')}</ol>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}
function showFields() {
  const seen = new Set();
  const list = Object.entries(FIELD_TYPES).filter(([k]) => { const g = k.startsWith('g') ? 'g' : k; if (seen.has(g)) return false; seen.add(g); return true; });
  modal(`<h2>Die Aktionsfelder</h2><div class="pfields">${list.map(([k, f]) => `<div class="pfield" style="--fc:${f.color}"><span class="pficon">${ICON[k]}</span><div><b>${esc(k.startsWith('g') ? '+1 / +2 / +3 Karten' : f.name)}</b><p>${esc(f.help)}</p></div></div>`).join('')}</div>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}

function bind(g) {
  g.addEventListener('click', (e) => {
    const t = e.target;
    const a = t.closest('[data-act]');
    if (a) { if (!a.disabled) onAct(a.dataset.act); return; }
    if (t.closest('#codeBtn')) return C.copyLink();
    const mv = t.closest('[data-move]');
    if (mv) return C.act({ type: 'move', use: Number(mv.dataset.move) });
    const dir = t.closest('[data-dir]');
    if (dir) { orangeDir = Number(dir.dataset.dir); return renderPanel(); }
    const ask = t.closest('[data-ask]');
    if (ask) return C.act({ type: 'orange', num: Number(ask.dataset.ask), dir: orangeDir });
    const rb = t.closest('[data-rainbow]');
    if (rb && !rb.disabled) return C.act({ type: 'rainbow', kind: rb.dataset.rainbow });
    const ka = t.closest('[data-keepauto]');
    if (ka) return C.act({ type: 'keep', for: ka.dataset.keepauto, auto: true });
    const add = t.closest('[data-addto]');
    if (add && lay) { const gi = Number(add.dataset.addto); lay.groups[gi].push(...sel); sel.clear(); return render(); }
    const un = t.closest('[data-unlay]');
    if (un && lay) { lay.groups = lay.groups.map((gr) => gr.filter((id) => id !== un.dataset.unlay)); return render(); }
    const meld = t.closest('[data-meld]');
    if (meld) {
      const { v, canAct } = info();
      if (!canAct || v.step !== 'play' || sel.size !== 1) { if (canAct && v.step === 'play') toast('Erst eine Karte aus deiner Hand antippen.', 'error'); return; }
      const id = [...sel][0];
      sel.clear();
      return C.act({ type: 'append', cid: id, meld: meld.dataset.meld });
    }
    const card = t.closest('[data-card]');
    if (card) {
      const id = card.dataset.card;
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      return render();
    }
  });
}
