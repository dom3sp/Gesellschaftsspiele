import * as Cards from './game.js';
import * as Dice from './dice.js';
import { HostNet, ClientNet, makeCode, normalizeCode } from './net.js';
import { q, esc, store, modal, closeModal, listModal, confirmModal, toast, lobbyHtml } from './ui.js';
import { initDiceUI, render as renderDice, onDiceEvent } from './dice-ui.js';

const { rid } = Cards;
const $app = document.getElementById('app');
// Kartenspiele und Würfelspiele haben je eigene Spiellogik mit gleicher Schnittstelle.
const engine = (deck) => (deck.type === 'dice' ? Dice : Cards);

function myToken() {
  let t = store.get('kt-token', 'session');
  if (!t) { t = rid(16); store.set('kt-token', t, 'session'); }
  return t;
}
const HOST_SAVE = 'kt-host-save';
const SAVE_MAX_AGE = 12 * 3600 * 1000;

// ---------- Decks ----------
const deckCache = {};
async function loadDeck(id) {
  if (!deckCache[id]) {
    const r = await fetch(`decks/${encodeURIComponent(id)}/deck.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Deck „${id}“ nicht gefunden`);
    const d = await r.json();
    d.id = id;
    d.base = `decks/${id}/`;
    if (!Array.isArray(d.piles) || !d.piles.length) d.piles = [{ id: 'stapel', name: 'Stapel', faceUp: false }];
    d.startPile = d.startPile || d.piles[0].id;
    d.minPlayers = d.minPlayers || 2;
    d.maxPlayers = d.maxPlayers || 4;
    d.aspect = d.aspect || 0.667;
    d.deal = d.deal || 0;
    d.shouts = (d.shouts || []).map((s) => (typeof s === 'string' ? { text: s } : s));
    d.rules = d.rules || [];
    deckCache[id] = d;
  }
  return deckCache[id];
}

// ---------- App-Zustand ----------
const ui = {
  mode: null, // 'host' | 'client'
  net: null, code: null, deck: null, view: null, me: null,
  s: null, // nur beim Host: der echte Spielzustand
  sel: null, selActions: [], justDragged: false, logOpen: false, lost: false,
};

function cleanup() {
  if (ui.net) ui.net.destroy();
  store.del('kt-active', 'session');
  Object.assign(ui, { mode: null, net: null, code: null, deck: null, view: null, me: null, s: null, E: null, sel: null, lost: false, logOpen: false });
  closeModal();
}

function inviteLink() {
  return `${location.origin}${location.pathname}?r=${ui.code}`;
}

async function copyLink() {
  const link = inviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Einladungslink kopiert!');
  } catch {
    modal(`<h2>Einladungslink</h2><p class="muted">Kopiere diesen Link und schick ihn deinen Mitspielern:</p>
      <input class="input" readonly value="${esc(link)}" onclick="this.select()">
      <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
  }
}

// ======================================================================
// Startseite
// ======================================================================
async function showHome(message) {
  cleanup();
  const pre = normalizeCode(new URLSearchParams(location.search).get('r'));
  let ids = [];
  try { ids = await (await fetch('decks/index.json', { cache: 'no-cache' })).json(); } catch {}
  const decks = (await Promise.all(ids.map((id) => loadDeck(id).catch(() => null)))).filter(Boolean);
  const saved = store.get(HOST_SAVE);
  const canResume = saved && Date.now() - saved.at < SAVE_MAX_AGE && decks.some((d) => d.id === saved.deckId);

  $app.innerHTML = `
  <main class="home">
    <header class="hero">
      <div class="logo" aria-hidden="true"><span></span><span></span><span></span></div>
      <h1>Kartentisch</h1>
      <p class="sub">Kartenspiele zusammen spielen – wie am echten Tisch.</p>
    </header>
    ${message ? `<div class="notice">${esc(message)}</div>` : ''}
    <section class="panel">
      <h2>Raum beitreten</h2>
      <p class="muted">Gib den Code ein, den du bekommen hast.</p>
      <div class="row">
        <input id="code" class="input code-input" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(pre)}">
        <button id="join" class="btn primary">Weiter</button>
      </div>
    </section>
    <section class="panel">
      <h2>Neuen Raum erstellen</h2>
      <p class="muted">Wähle ein Spiel – du bekommst einen Code für deine Mitspieler.</p>
      <div class="decks">
        ${decks.map((d) => `
          <button class="deck-tile${d.type === 'dice' ? ' dice-tile' : ''}" data-deck="${esc(d.id)}">
            <img src="${esc(d.base + (d.cover || d.back))}" alt="">
            <span class="deck-text">
              <b>${esc(d.name)}</b>
              <span>${esc(d.description || '')}</span>
              <small>${d.minPlayers}–${d.maxPlayers} Spieler · ${d.type === 'dice'
                ? Object.values(Dice.VARIANTS).map((v) => v.name).join(' oder ')
                : `${d.cards.reduce((n, c) => n + (c.count || 1), 0)} Karten`}</small>
            </span>
          </button>`).join('') || '<p class="muted">Keine Decks gefunden.</p>'}
      </div>
    </section>
    ${canResume ? `
    <section class="panel">
      <h2>Letzten Raum fortsetzen</h2>
      <p class="muted">Du hattest Raum <b>${esc(saved.code)}</b> erstellt. Deine Mitspieler werden automatisch wieder verbunden.</p>
      <div class="row"><button id="resume" class="btn">Raum ${esc(saved.code)} fortsetzen</button><button id="forget" class="btn ghost">Verwerfen</button></div>
    </section>` : ''}
  </main>`;

  const codeInp = q('#code');
  codeInp.addEventListener('input', () => { codeInp.value = normalizeCode(codeInp.value); });
  const doJoin = () => {
    const code = normalizeCode(codeInp.value);
    if (code.length !== 4) { toast('Der Raum-Code hat 4 Buchstaben.', 'error'); codeInp.focus(); return; }
    showNameStep({ code });
  };
  q('#join').onclick = doJoin;
  codeInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  $app.querySelectorAll('[data-deck]').forEach((b) => {
    b.onclick = () => {
      const deck = decks.find((d) => d.id === b.dataset.deck);
      if (deck.type === 'dice') showVariantStep(deck);
      else showNameStep({ deck });
    };
  });
  if (canResume) {
    q('#resume').onclick = () => startHost(saved.deckId, null, saved);
    q('#forget').onclick = () => { store.del(HOST_SAVE); showHome(); };
  }
  // Über einen Einladungslink gekommen → direkt zur Namenseingabe.
  if (pre.length === 4 && !message) showNameStep({ code: pre });
}

// Würfelspiel: erst die Variante wählen, dann den Namen.
function showVariantStep(deck) {
  const V = Dice.VARIANTS;
  $app.innerHTML = `
  <main class="home narrow">
    <section class="panel name-step">
      <p class="step-kicker">Neuer Raum · <b>${esc(deck.name)}</b></p>
      <h2>Welche Variante?</h2>
      <div class="variants">
        ${Object.values(V).map((v) => `
          <button class="variant-tile" data-variant="${v.id}">
            <span class="variant-dice">${v.dice.map((s) => `<i class="${s === 10 ? 'd10' : ''}"></i>`).join('')}</span>
            <b>${esc(deck.name)} ${esc(v.name)}</b>
            <span>${esc(v.short)}</span>
          </button>`).join('')}
      </div>
      <button id="back" class="btn ghost full">← Zurück</button>
    </section>
  </main>`;
  $app.querySelectorAll('[data-variant]').forEach((b) => { b.onclick = () => showNameStep({ deck, variant: b.dataset.variant }); });
  q('#back').onclick = () => showHome();
}

// Schritt 2: Namen eingeben (beim Beitreten und beim Erstellen).
function showNameStep({ code, deck, variant }) {
  const title = deck ? esc(deck.name) + (variant ? ` ${esc(Dice.VARIANTS[variant].name)}` : '') : '';
  $app.innerHTML = `
  <main class="home narrow">
    <section class="panel name-step">
      <p class="step-kicker">${code ? `Raum <b class="code-tag">${esc(code)}</b>` : `Neuer Raum · <b>${title}</b>`}</p>
      <h2>Wie heißt du?</h2>
      <p class="muted">So sehen dich die anderen am Tisch.</p>
      <input id="name" class="input big-input" maxlength="20" placeholder="Dein Name" autocomplete="off" spellcheck="false">
      <button id="go" class="btn primary big full">${code ? 'Beitreten' : 'Raum erstellen'}</button>
      <button id="back" class="btn ghost full">← Zurück</button>
    </section>
  </main>`;
  const inp = q('#name');
  inp.focus();
  const go = () => {
    const name = inp.value.trim();
    if (!name) { toast('Bitte gib deinen Namen ein.', 'error'); inp.focus(); return; }
    if (code) startClient(code, name);
    else startHost(deck.id, name, null, variant);
  };
  q('#go').onclick = go;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  q('#back').onclick = () => {
    if (variant) return showVariantStep(deck);
    history.replaceState(null, '', location.pathname);
    showHome();
  };
}

function showConnecting(text) {
  $app.innerHTML = `<main class="home center"><div class="spinner"></div><p>${esc(text)}</p><button class="btn ghost" id="cancel">Abbrechen</button></main>`;
  q('#cancel').onclick = () => showHome();
}

// ======================================================================
// Host
// ======================================================================
async function startHost(deckId, name, resume, variant) {
  cleanup();
  let deck;
  try { deck = await loadDeck(deckId); } catch (e) { return showHome(e.message); }
  const E = engine(deck);
  let s, me, code;
  if (resume) {
    s = resume.s; me = resume.me; code = resume.code;
    for (const p of s.players) if (p.id !== me) p.connected = false;
  } else {
    s = E.createState(deck, deckId, variant);
    me = E.addPlayer(s, deck, name, null, true).id;
    code = makeCode();
  }
  Object.assign(ui, { mode: 'host', deck, s, me, code, E });
  showConnecting(resume ? `Raum ${code} wird wieder geöffnet …` : 'Raum wird erstellt …');

  ui.net = new HostNet(code, {
    ready(c) { ui.code = c; hostSync(); },
    hello(conn, msg) {
      const p = ui.E.addPlayer(ui.s, ui.deck, msg.name, String(msg.token || ''));
      if (!p) {
        conn.send({ type: 'reject', reason: 'Der Raum ist leider voll.' });
        setTimeout(() => { try { conn.close(); } catch {} }, 500);
        return;
      }
      ui.net.bind(p.id, conn);
      conn.send({ type: 'welcome', pid: p.id, deckId: ui.s.deckId, code: ui.code });
      hostSync();
    },
    action(pid, a) { hostApply(pid, a); },
    lost(pid) { ui.E.setConnected(ui.s, pid, false); hostSync(); },
    fatal(m) { showHome(m); },
  }, { fixedCode: !!resume });
}

function hostApply(pid, a) {
  let res;
  try {
    res = ui.E.applyAction(ui.s, ui.deck, pid, a);
  } catch (e) {
    if (pid === ui.me) toast(e.message, 'error');
    else ui.net.sendTo(pid, { type: 'error', message: e.message });
    return;
  }
  for (const ev of res.events) {
    if (ev.kind === 'kicked') {
      ui.net.sendTo(ev.pid, { type: 'reject', reason: 'Du wurdest vom Host aus dem Raum entfernt.' });
      ui.net.unbind(ev.pid);
      continue;
    }
    ui.net.broadcast({ type: 'event', ev });
    showEvent(ev);
  }
  hostSync();
}

function hostSync() {
  if (ui.mode !== 'host' || !ui.net) return;
  for (const p of ui.s.players) {
    if (p.id !== ui.me) ui.net.sendTo(p.id, { type: 'state', view: ui.E.viewFor(ui.s, ui.deck, p.id) });
  }
  ui.view = ui.E.viewFor(ui.s, ui.deck, ui.me);
  store.set(HOST_SAVE, { code: ui.code, deckId: ui.s.deckId, me: ui.me, s: ui.s, at: Date.now() });
  renderGame();
}

// ======================================================================
// Mitspieler
// ======================================================================
function startClient(code, name) {
  cleanup();
  Object.assign(ui, { mode: 'client', code });
  showConnecting(`Verbinde mit Raum ${code} …`);
  ui.net = new ClientNet(code, myToken(), name, {
    async welcome(msg) {
      ui.me = msg.pid;
      store.set('kt-active', { code, name }, 'session');
      if (new URLSearchParams(location.search).get('r') !== code) history.replaceState(null, '', `?r=${code}`);
      try { ui.deck = await loadDeck(msg.deckId); } catch (e) { showHome(e.message); return; }
      renderGame();
    },
    state(view) { ui.view = view; renderGame(); },
    event(ev) { showEvent(ev); },
    reject(reason) { showHome(reason); },
    error(m) { toast(m, 'error'); },
    failed(m) { showHome(m); },
    status(st) { ui.lost = st === 'lost'; renderStatus(); },
  });
}

function act(a) {
  if (ui.mode === 'host') hostApply(ui.me, a);
  else if (ui.net) ui.net.send({ type: 'action', action: a });
}

function leave() {
  if (ui.mode === 'host') {
    confirmModal('Raum schließen?', 'Alle Mitspieler verlieren die Verbindung. Du kannst den Raum später auf der Startseite fortsetzen.', () => {
      history.replaceState(null, '', location.pathname);
      showHome();
    });
  } else {
    confirmModal('Raum verlassen?', 'Deine Karten bleiben im Raum. Mit dem gleichen Code kommst du wieder rein.', () => showHome());
  }
}

// ======================================================================
// Spieltisch
// ======================================================================
function skeleton() {
  return `
  <div id="game" class="game">
    <header class="topbar">
      <button id="codeBtn" class="room-code" title="Einladungslink kopieren">Raum <b></b></button>
      <span id="deckName" class="deck-name"></span>
      <span class="spacer"></span>
      <button id="undoBtn" class="btn small undo" data-act="undo">↶ Zurück</button>
      <button class="btn ghost small" data-act="log">Verlauf</button>
      <button class="btn ghost small" data-act="menu">Menü</button>
    </header>
    <div id="status" class="status" hidden>Verbindung unterbrochen – verbinde neu …</div>
    <section id="opps" class="opps"></section>
    <section class="board">
      <div id="piles" class="piles"></div>
      <div id="table" class="table" data-drop="table"><span class="table-hint">Tisch</span><div id="tableCards"></div></div>
      <aside id="log" class="log"><div class="log-head">Verlauf <button class="icon-btn" data-act="log" aria-label="Schließen">✕</button></div><ol id="logList"></ol></aside>
    </section>
    <div id="ticker" class="ticker"></div>
    <section class="me">
      <div id="selbar" class="selbar" hidden></div>
      <div id="mebar" class="mebar"></div>
      <div id="hand" class="hand" data-drop="hand"><div id="handRow" class="hand-row"></div></div>
    </section>
    <div id="lobby"></div>
  </div>`;
}

function cardHtml(t, src, id, cls = '', style = '') {
  const d = ui.deck;
  const face = t !== null && t !== undefined;
  const img = face ? d.cards[t].image : d.back;
  const alt = face ? d.cards[t].name : 'Rückseite';
  return `<div class="card ${cls}"${src ? ` data-src="${src}"` : ''}${style ? ` style="${style}"` : ''} title="${esc(alt)}"><img src="${esc(d.base + img)}" alt="${esc(alt)}" draggable="false"></div>`;
}

function renderGame() {
  const v = ui.view, d = ui.deck;
  if (!v || !d) return;
  if (d.type === 'dice') return renderDice();
  let g = q('#game');
  if (!g) {
    $app.innerHTML = skeleton();
    g = q('#game');
    bindGame(g);
  }
  g.style.setProperty('--aspect', d.aspect);
  g.classList.toggle('no-table', d.table === false);
  g.classList.toggle('log-open', ui.logOpen);
  q('#codeBtn b').textContent = ui.code || '';
  q('#deckName').textContent = d.name + (v.started ? ` · Runde ${v.round}` : '');
  const undoBtn = q('#undoBtn');
  undoBtn.disabled = !v.undo;
  undoBtn.title = v.undo ? `Zurücknehmen: ${v.undo}` : 'Nichts zum Zurücknehmen';

  if (ui.sel && !selExists(ui.sel)) ui.sel = null;
  const isSel = (kind, id) => ui.sel && ui.sel.kind === kind && ui.sel.id === id;
  const others = v.players.filter((p) => p.id !== v.me);

  // Mitspieler
  q('#opps').innerHTML = others.map((p) => `
    <div class="opp${p.connected ? '' : ' off'}" data-drop="player:${p.id}" style="--pc:${p.color}">
      <div class="opp-name"><span class="dot"></span><b>${esc(p.name)}</b>${p.host ? '<span class="tag">Host</span>' : ''}</div>
      <div class="opp-hand">${Array.from({ length: Math.min(p.count, 12) }, () => `<span class="mini" style="background-image:url('${esc(d.base + d.back)}')"></span>`).join('')}<span class="opp-count">${p.count}</span></div>
      <div class="opp-wins" title="Siege">🏆 ${p.wins}${p.connected ? '' : ' · offline'}</div>
      ${p.cards ? `<div class="opp-reveal">${p.cards.map((c) => cardHtml(c.t, '', '', 'xs')).join('')}</div>` : ''}
    </div>`).join('') || '<div class="opp-empty">Noch keine Mitspieler – teile den Raum-Code!</div>';

  // Stapel
  q('#piles').innerHTML = v.piles.map((p) => {
    const def = d.piles.find((x) => x.id === p.id);
    const depth = p.count > 30 ? 3 : p.count > 10 ? 2 : p.count > 1 ? 1 : 0;
    let top;
    if (!p.count) top = '<div class="card slot"><span>leer</span></div>';
    else top = cardHtml(p.top ? p.top.t : null, `pile:${p.id}`, '', `depth-${depth}${isSel('pile', p.id) ? ' sel' : ''}`);
    return `<div class="pile" data-drop="pile:${p.id}">
      <div class="pile-card">${top}</div>
      <div class="pile-info"><span class="pile-name">${esc(def.name)}</span><b>${p.count}</b><button class="icon-btn" data-pilemenu="${p.id}" aria-label="Stapel-Optionen">⋯</button></div>
    </div>`;
  }).join('');

  // Tisch
  q('#tableCards').innerHTML = v.table.map((c) =>
    cardHtml(c.up ? c.t : null, `table:${c.id}`, c.id, `tcard${isSel('table', c.id) ? ' sel' : ''}`, `left:${(c.x * 100).toFixed(2)}%;top:${(c.y * 100).toFixed(2)}%`)
  ).join('');
  q('.table-hint').hidden = v.table.length > 0;

  // Eigene Hand
  const meP = v.players.find((p) => p.id === v.me) || { name: '?', wins: 0, color: '#fff' };
  q('#handRow').innerHTML = v.hand.map((c) => cardHtml(c.t, `hand:${c.id}`, c.id, isSel('hand', c.id) ? 'sel' : '')).join('')
    || '<div class="hand-empty">Keine Karten auf der Hand</div>';
  q('#mebar').innerHTML = `
    <div class="me-name" style="--pc:${meP.color}"><span class="dot"></span><b>${esc(meP.name)}</b><span class="muted">${v.hand.length} Karten · 🏆 ${meP.wins}</span></div>
    <div class="me-actions">
      ${d.shouts.map((sh, i) => `<button class="btn shout" data-shout="${i}"${sh.color ? ` style="--sc:${esc(sh.color)}"` : ''}>${esc(sh.text)}</button>`).join('')}
      <button class="btn ghost small" data-act="sort">Sortieren</button>
      <button class="btn ghost small" data-act="reveal">${meP.revealed ? 'Hand verbergen' : 'Hand zeigen'}</button>
      <button class="btn win small" data-act="win">🏆 Gewonnen</button>
    </div>`;

  // Verlauf
  const logList = q('#logList');
  logList.innerHTML = v.log.map((e) => `<li>${esc(e.text)}</li>`).join('');
  logList.scrollTop = logList.scrollHeight;
  q('#ticker').textContent = v.log.length ? v.log[v.log.length - 1].text : '';

  renderSelbar();
  renderLobby();
  renderStatus();
  layoutHand();
}

function renderStatus() {
  const el = q('#status');
  if (el) el.hidden = !ui.lost;
}

function selExists(sel) {
  const v = ui.view;
  if (sel.kind === 'hand') return v.hand.some((c) => c.id === sel.id);
  if (sel.kind === 'table') return v.table.some((c) => c.id === sel.id);
  if (sel.kind === 'pile') return v.piles.some((p) => p.id === sel.id && p.count > 0);
  return false;
}

function randPos() {
  return { x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 };
}

function renderSelbar() {
  const el = q('#selbar');
  const sel = ui.sel, v = ui.view, d = ui.deck;
  if (!sel) { el.hidden = true; el.innerHTML = ''; ui.selActions = []; return; }
  const btns = [];
  let title = '';
  const hasTable = d.table !== false;
  if (sel.kind === 'hand') {
    const c = v.hand.find((x) => x.id === sel.id);
    title = d.cards[c.t].name;
    for (const p of d.piles) btns.push([`Auf „${p.name}“`, { type: 'move', cid: sel.id, to: { kind: 'pile', id: p.id } }]);
    if (hasTable) {
      btns.push(['Offen auf den Tisch', { type: 'move', cid: sel.id, to: { kind: 'table', up: true, ...randPos() } }]);
      btns.push(['Verdeckt auf den Tisch', { type: 'move', cid: sel.id, to: { kind: 'table', up: false, ...randPos() } }]);
    }
    for (const p of v.players) if (p.id !== v.me) btns.push([`An ${p.name} geben`, { type: 'move', cid: sel.id, to: { kind: 'player', pid: p.id } }]);
  } else if (sel.kind === 'table') {
    const c = v.table.find((x) => x.id === sel.id);
    title = c.up ? d.cards[c.t].name : 'Verdeckte Karte';
    btns.push([c.up ? 'Umdrehen (verdeckt)' : 'Aufdecken', { type: 'flip', cid: sel.id }]);
    btns.push(['Auf die Hand', { type: 'move', cid: sel.id, to: { kind: 'hand' } }]);
    for (const p of d.piles) btns.push([`Auf „${p.name}“`, { type: 'move', cid: sel.id, to: { kind: 'pile', id: p.id } }]);
  } else if (sel.kind === 'pile') {
    const p = v.piles.find((x) => x.id === sel.id);
    const def = d.piles.find((x) => x.id === sel.id);
    title = p.top ? `${d.cards[p.top.t].name} (oben auf „${def.name}“)` : `Oberste Karte von „${def.name}“`;
    btns.push(['Auf die Hand', { type: 'move', fromPile: sel.id, to: { kind: 'hand' } }]);
    for (const o of d.piles) if (o.id !== sel.id) btns.push([`Auf „${o.name}“`, { type: 'move', fromPile: sel.id, to: { kind: 'pile', id: o.id } }]);
    if (hasTable) btns.push(['Auf den Tisch', { type: 'move', fromPile: sel.id, to: { kind: 'table', ...randPos() } }]);
  }
  ui.selActions = btns.map((b) => b[1]);
  el.hidden = false;
  el.innerHTML = `<div class="selbar-title">${esc(title)}</div>
    <div class="selbar-btns">${btns.map((b, i) => `<button class="btn small" data-sel="${i}">${esc(b[0])}</button>`).join('')}
    <button class="btn ghost small" data-sel="x">Abbrechen</button></div>`;
}

function renderLobby() {
  const el = q('#lobby');
  const v = ui.view, d = ui.deck;
  if (v.started) { el.innerHTML = ''; return; }
  el.innerHTML = lobbyHtml({ title: d.name, view: v, minPlayers: d.minPlayers, maxPlayers: d.maxPlayers, code: ui.code, isHost: ui.mode === 'host' });
}

// Handkarten überlappen, damit sie in die Breite passen.
function layoutHand() {
  const h = q('#hand'), row = q('#handRow');
  if (!h || !row) return;
  const cards = row.querySelectorAll('.card');
  const n = cards.length;
  if (!n) return;
  const cw = cards[0].offsetWidth;
  const avail = h.clientWidth - 24;
  let step = n > 1 ? Math.min(cw + 6, (avail - cw) / (n - 1)) : 0;
  step = Math.max(step, Math.min(cw * 0.34, 34));
  cards.forEach((c, i) => { c.style.marginLeft = i ? `${step - cw}px` : '0'; });
}

// ---------- Menüs ----------
function onAct(name) {
  const v = ui.view, d = ui.deck;
  switch (name) {
    case 'menu': return openMenu();
    case 'undo': ui.sel = null; return act({ type: 'undo' });
    case 'log': ui.logOpen = !ui.logOpen; q('#game').classList.toggle('log-open', ui.logOpen); return;
    case 'copy': return copyLink();
    case 'start': return act({ type: 'start' });
    case 'leave': return leave();
    case 'sort': return act({ type: 'sortHand' });
    case 'reveal': return act({ type: 'reveal' });
    case 'win': {
      const meFirst = [...v.players].sort((a, b) => (a.id === v.me ? -1 : b.id === v.me ? 1 : 0));
      return listModal('Wer hat gewonnen?', meFirst.map((p) => [p.id === v.me ? `Ich (${p.name})` : p.name, () => act({ type: 'win', pid: p.id })]));
    }
  }
  void d;
}

function openMenu() {
  const v = ui.view, d = ui.deck;
  const items = [
    ['Karten austeilen …', () => openDeal(d.startPile)],
    ['Neue Runde (alle Karten einsammeln & mischen)', () => confirmModal('Neue Runde starten?', 'Alle Karten – auch die auf den Händen – werden eingesammelt und gemischt.', () => act({ type: 'newRound' }))],
  ];
  if (d.rules.length) items.push(['Spielregeln', showRules]);
  items.push(['Meinen Namen ändern', openRename]);
  items.push(['Einladungslink kopieren', copyLink]);
  if (ui.mode === 'host') {
    items.push(['Siege zurücksetzen', () => confirmModal('Siege zurücksetzen?', 'Alle Siege werden auf 0 gesetzt.', () => act({ type: 'resetWins' }))]);
    for (const p of v.players) {
      if (p.id !== v.me) items.push([`${p.name} aus dem Raum entfernen`, () => confirmModal(`${p.name} entfernen?`, 'Die Handkarten kommen zurück in den Stapel.', () => act({ type: 'kick', pid: p.id })), 'danger']);
    }
  }
  items.push([ui.mode === 'host' ? 'Raum schließen' : 'Raum verlassen', leave, 'danger']);
  listModal('Menü', items);
}

function openPileMenu(id) {
  const v = ui.view, d = ui.deck;
  const def = d.piles.find((p) => p.id === id);
  const p = v.piles.find((x) => x.id === id);
  const items = [];
  if (p.count) {
    items.push(['Mischen', () => act({ type: 'shuffle', pile: id })]);
    items.push(['Eine Karte ziehen', () => act({ type: 'draw', pile: id })]);
    items.push(['Mehrere Karten ziehen …', () => openDraw(id)]);
    items.push(['Karten austeilen …', () => openDeal(id)]);
  }
  for (const o of d.piles) {
    if (o.id !== id && p.count > 1) items.push([`Alle außer der obersten unter „${o.name}“ mischen`, () => act({ type: 'recycle', from: id, to: o.id })]);
  }
  if (!items.length) items.push(['Der Stapel ist leer', () => {}]);
  listModal(`${def.name} (${p.count})`, items);
}

function numberModal(title, text, def, max, okLabel, onOk) {
  modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
    <div class="stepper"><button class="btn" data-step="-1" aria-label="weniger">−</button><input id="num" class="input" type="number" inputmode="numeric" min="1" max="${max}" value="${def}"><button class="btn" data-step="1" aria-label="mehr">+</button></div>
    <div class="row end"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`,
  (m) => {
    const inp = q('#num', m);
    m.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => { inp.value = Math.min(max, Math.max(1, (parseInt(inp.value, 10) || 0) + Number(b.dataset.step))); }; });
    q('[data-ok]', m).onclick = () => { const n = parseInt(inp.value, 10); closeModal(); if (n > 0) onOk(n); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') q('[data-ok]', m).click(); });
  });
}

function openRename() {
  const me = ui.view.players.find((p) => p.id === ui.view.me);
  modal(`<h2>Namen ändern</h2>
    <input id="newName" class="input" maxlength="20" value="${esc(me ? me.name : '')}" autocomplete="off" spellcheck="false">
    <div class="row end"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" data-ok>Speichern</button></div>`,
  (m) => {
    const inp = q('#newName', m);
    inp.focus();
    inp.select();
    const ok = () => {
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      closeModal();
      act({ type: 'rename', name });
    };
    q('[data-ok]', m).onclick = ok;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });
}

function openDeal(pileId) {
  const def = ui.deck.piles.find((p) => p.id === pileId);
  numberModal('Karten austeilen', `Jeder Spieler bekommt so viele Karten von „${def.name}“:`, ui.deck.deal || 7, 60, 'Austeilen', (n) => act({ type: 'deal', pile: pileId, count: n }));
}

function openDraw(pileId) {
  const def = ui.deck.piles.find((p) => p.id === pileId);
  numberModal('Karten ziehen', `Wie viele Karten ziehst du von „${def.name}“?`, 2, 30, 'Ziehen', (n) => act({ type: 'draw', pile: pileId, count: n }));
}

function showRules() {
  modal(`<h2>Spielregeln: ${esc(ui.deck.name)}</h2><ul class="rules">${ui.deck.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted small-text">Die Website prüft keine Regeln – ihr spielt wie am echten Tisch.</p>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}

// ---------- Meldungen ----------
function showEvent(ev) {
  if (ev.kind === 'roll') {
    onDiceEvent(ev);
  } else if (ev.kind === 'undo') {
    toast(`↶ ${ev.name} hat zurückgenommen: ${ev.label}`);
  } else if (ev.kind === 'shout') {
    const b = document.createElement('div');
    b.className = 'shout-bubble';
    b.style.setProperty('--pc', ev.color || '#fff');
    b.innerHTML = `<small>${esc(ev.name)}</small>${esc(ev.text)}`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2400);
  } else if (ev.kind === 'win') {
    const b = document.createElement('div');
    b.className = 'win-banner';
    b.style.setProperty('--pc', ev.color || '#ffd43b');
    b.innerHTML = `<div><span class="trophy">🏆</span><b>${esc(ev.name)}</b> hat gewonnen!</div>`;
    b.onclick = () => b.remove();
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 4000);
  }
}

// ======================================================================
// Klicken & Ziehen
// ======================================================================
function parseSrc(src) {
  const i = src.indexOf(':');
  return { kind: src.slice(0, i), id: src.slice(i + 1) };
}

function tablePos(x, y) {
  const r = q('#table').getBoundingClientRect();
  return {
    x: Math.min(0.97, Math.max(0.03, (x - r.left) / r.width)),
    y: Math.min(0.95, Math.max(0.05, (y - r.top) / r.height)),
  };
}

// Baut die Aktion "Karte aus sel nach target bewegen".
function buildMove(sel, target, pt) {
  const src = sel.kind === 'pile' ? { fromPile: sel.id } : { cid: sel.id };
  if (target === 'table') {
    if (ui.deck.table === false) return null;
    return { type: 'move', ...src, to: { kind: 'table', ...(pt ? tablePos(pt.x, pt.y) : randPos()) } };
  }
  if (target === 'hand') return sel.kind === 'hand' ? null : { type: 'move', ...src, to: { kind: 'hand' } };
  if (target.startsWith('pile:')) {
    const id = target.slice(5);
    if (sel.kind === 'pile' && sel.id === id) return null;
    return { type: 'move', ...src, to: { kind: 'pile', id } };
  }
  if (target.startsWith('player:')) return { type: 'move', ...src, to: { kind: 'player', pid: target.slice(7) } };
  return null;
}

function pileFaceUp(id) {
  const def = ui.deck.piles.find((p) => p.id === id);
  return !!(def && def.faceUp);
}

function bindGame(g) {
  g.addEventListener('click', (e) => {
    if (ui.justDragged) return;
    const t = e.target;
    const actBtn = t.closest('[data-act]');
    if (actBtn) return onAct(actBtn.dataset.act);
    if (t.closest('#codeBtn')) return copyLink();
    const sh = t.closest('[data-shout]');
    if (sh) return act({ type: 'shout', text: ui.deck.shouts[Number(sh.dataset.shout)].text });
    const pm = t.closest('[data-pilemenu]');
    if (pm) return openPileMenu(pm.dataset.pilemenu);
    const sb = t.closest('[data-sel]');
    if (sb) {
      const a = sb.dataset.sel === 'x' ? null : ui.selActions[Number(sb.dataset.sel)];
      ui.sel = null;
      if (a) act(a);
      renderGame();
      return;
    }

    const cardEl = t.closest('[data-src]');
    if (cardEl) {
      const { kind, id } = parseSrc(cardEl.dataset.src);
      if (kind === 'pile') {
        if (ui.sel && !(ui.sel.kind === 'pile' && ui.sel.id === id)) {
          const a = buildMove(ui.sel, `pile:${id}`, null);
          ui.sel = null;
          if (a) act(a);
          renderGame();
          return;
        }
        if (!pileFaceUp(id)) { act({ type: 'draw', pile: id }); return; }
      }
      ui.sel = ui.sel && ui.sel.kind === kind && ui.sel.id === id ? null : { kind, id };
      renderGame();
      return;
    }

    const drop = t.closest('[data-drop]');
    if (ui.sel && drop) {
      const a = buildMove(ui.sel, drop.dataset.drop, { x: e.clientX, y: e.clientY });
      ui.sel = null;
      if (a) act(a);
      renderGame();
      return;
    }
    if (ui.sel && !t.closest('#selbar')) { ui.sel = null; renderGame(); }
  });

  g.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-src^="table:"]');
    if (el) { ui.sel = null; act({ type: 'flip', cid: parseSrc(el.dataset.src).id }); }
  });

  g.addEventListener('pointerdown', onDown);
}

let drag = null;

function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  const el = e.target.closest('[data-src]');
  if (!el) return;
  drag = { el, src: el.dataset.src, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false, hot: null };
}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('[data-drop]') : null;
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
    const r = drag.el.getBoundingClientRect();
    const gh = drag.el.cloneNode(true);
    gh.classList.add('ghost');
    gh.classList.remove('sel', 'tcard');
    gh.removeAttribute('style');
    gh.style.width = `${r.width}px`;
    gh.style.height = `${r.height}px`;
    document.body.appendChild(gh);
    Object.assign(drag, { on: true, ghost: gh, w: r.width, h: r.height });
    drag.el.classList.add('dragging');
    document.body.classList.add('is-dragging');
    if (ui.sel) { ui.sel = null; renderSelbar(); }
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${e.clientX - drag.w / 2}px, ${e.clientY - drag.h / 2}px) rotate(4deg)`;
  const t = dropTargetAt(e.clientX, e.clientY);
  if (t !== drag.hot) {
    drag.hot?.classList.remove('drop-hot');
    t?.classList.add('drop-hot');
    drag.hot = t;
  }
}

function endDrag(e, cancelled) {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag;
  drag = null;
  if (!d.on) return;
  d.ghost.remove();
  d.el.classList.remove('dragging');
  d.hot?.classList.remove('drop-hot');
  document.body.classList.remove('is-dragging');
  ui.justDragged = true;
  setTimeout(() => { ui.justDragged = false; }, 60);
  if (cancelled) return;
  const t = dropTargetAt(e.clientX, e.clientY);
  if (!t) return;
  const target = t.dataset.drop;
  const sel = parseSrc(d.src);
  if (target === 'hand' && sel.kind === 'hand') {
    act({ type: 'reorder', cid: sel.id, index: handIndexAt(e.clientX, sel.id) });
    return;
  }
  const a = buildMove(sel, target, { x: e.clientX, y: e.clientY });
  if (a) act(a);
}

function handIndexAt(x, exclude) {
  const cards = [...document.querySelectorAll('#handRow .card')].filter((c) => c.dataset.src !== `hand:${exclude}`);
  const idx = cards.findIndex((c, i) => {
    const r = c.getBoundingClientRect();
    const next = cards[i + 1]?.getBoundingClientRect();
    const visibleRight = next ? Math.min(r.right, next.left) : r.right;
    return x < (r.left + visibleRight) / 2;
  });
  return idx < 0 ? cards.length : idx;
}

window.addEventListener('pointermove', onMove, { passive: false });
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));
window.addEventListener('resize', layoutHand);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && ui.view?.undo && !e.target.closest('input')) {
    e.preventDefault();
    ui.sel = null;
    act({ type: 'undo' });
    return;
  }
  if (e.key === 'Escape') {
    if (q('.modal')) closeModal();
    else if (ui.sel) { ui.sel = null; renderGame(); }
  }
});
window.addEventListener('beforeunload', (e) => {
  if (ui.mode === 'host' && ui.view && ui.s.players.length > 1) { e.preventDefault(); e.returnValue = ''; }
});

initDiceUI({ ui, act, copyLink, leave, openRename });

// Nach Neuladen automatisch wieder in den Raum (gleicher Platz, gleiche Karten).
const active = store.get('kt-active', 'session');
if (active && active.code === normalizeCode(new URLSearchParams(location.search).get('r'))) startClient(active.code, active.name);
else showHome();
