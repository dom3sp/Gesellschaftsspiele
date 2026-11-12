// Oberfläche für das Würfelspiel: Würfelschale + Spielblock.
import { q, esc, modal, listModal, confirmModal, lobbyHtml } from './ui.js';
import { VARIANTS, categories, scoreOf, totals } from './dice.js';

let C = null; // { ui, act, copyLink, leave, openRename }
export function initDiceUI(ctx) { C = ctx; }

const randInt = (n) => Math.floor(Math.random() * n);

// ---------- Würfel-Animation ----------
const anim = { idx: new Set(), until: 0, timer: null };
const animating = () => anim.idx.size > 0 && performance.now() < anim.until;

export function onDiceEvent(ev) {
  if (ev.kind === 'roll') {
    anim.idx = new Set(ev.idx);
    anim.until = performance.now() + 850;
  }
}

const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function faceInner(v, sides) {
  if (v === null || v === undefined) return '<span class="die-q">?</span>';
  if (sides === 10) return `<span class="die-num">${v}</span>`;
  const on = new Set(PIPS[v]);
  return `<span class="pips">${Array.from({ length: 9 }, (_, i) => `<i${on.has(i) ? ' class="on"' : ''}></i>`).join('')}</span>`;
}
const randomFace = (sides) => (sides === 10 ? randInt(10) : 1 + randInt(6));

function dieHtml(d, i, rolling, canHold) {
  const cls = ['die', `d${d.sides}`];
  if (d.held) cls.push('held');
  if (rolling) cls.push('rolling');
  if (d.v === null) cls.push('blank');
  const style = rolling ? ` style="--spin:${(randInt(2) ? 1 : -1) * (300 + randInt(260))}deg;--dur:${0.6 + Math.random() * 0.25}s"` : '';
  const shape = d.sides === 10 ? '<svg class="d10-shape" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,3 97,38 82,84 50,97 18,84 3,38"/><path d="M3,38 L50,58 L97,38 M50,58 L50,97" /></svg>' : '';
  const label = d.v === null ? 'noch nicht gewürfelt' : `${d.v}${d.held ? ', behalten' : ''}`;
  return `<button class="${cls.join(' ')}" data-die="${i}" data-sides="${d.sides}"${canHold ? '' : ' disabled'}${style} aria-label="Würfel ${i + 1}: ${label}">
    ${shape}<span class="face">${faceInner(rolling ? randomFace(d.sides) : d.v, d.sides)}</span>${d.held ? '<span class="held-tag">behalten</span>' : ''}</button>`;
}

// ---------- Aufbau ----------
function skeleton() {
  return `
  <div id="game" class="game dice-game">
    <header class="topbar">
      <button id="codeBtn" class="room-code" title="Einladungslink kopieren">Raum <b></b></button>
      <span id="deckName" class="deck-name"></span>
      <span class="spacer"></span>
      <button id="undoBtn" class="btn small undo" data-act="undo">↶ Zurück</button>
      <button class="btn ghost small" data-act="log">Verlauf</button>
      <button class="btn ghost small" data-act="menu">Menü</button>
    </header>
    <div id="status" class="status" hidden>Verbindung unterbrochen – verbinde neu …</div>
    <div class="dg-body">
      <section id="tray" class="tray"></section>
      <section class="sheet-wrap"><table id="sheet" class="sheet"></table></section>
      <aside id="log" class="log"><div class="log-head">Verlauf <button class="icon-btn" data-act="log" aria-label="Schließen">✕</button></div><ol id="logList"></ol></aside>
    </div>
    <div id="lobby"></div>
  </div>`;
}

function ctxInfo() {
  const v = C.ui.view;
  const meP = v.players.find((p) => p.id === v.me);
  const turnP = v.players.find((p) => p.id === v.turn) || null;
  const isHost = !!(meP && meP.host);
  const canAct = !!(turnP && v.started && !v.finished && (turnP.id === v.me || (isHost && !turnP.connected)));
  const V = VARIANTS[v.variant] || VARIANTS.classic;
  const allHeld = v.rolled > 0 && v.dice.every((d) => d.held);
  const canRoll = canAct && v.rollsLeft > 0 && !allHeld;
  const canToken = canAct && V.tokens > 0 && v.rollsLeft === 0 && turnP.tokens > 0 && !allHeld;
  return { v, V, meP, turnP, isHost, canAct, canRoll, canToken, allHeld };
}

export function render() {
  const ui = C.ui;
  const v = ui.view;
  if (!v || !ui.deck) return;
  let g = q('#game.dice-game');
  if (!g) {
    document.getElementById('app').innerHTML = skeleton();
    g = q('#game.dice-game');
    bind(g);
  }
  const { V } = ctxInfo();
  g.classList.toggle('log-open', !!ui.logOpen);
  q('#codeBtn b').textContent = ui.code || '';
  q('#deckName').textContent = `${ui.deck.name} ${V.name} · Spiel ${v.game}`;
  const undoBtn = q('#undoBtn');
  undoBtn.disabled = !v.undo;
  undoBtn.title = v.undo ? `Zurücknehmen: ${v.undo}` : 'Nichts zum Zurücknehmen';

  renderTray();
  renderSheet();

  const logList = q('#logList');
  logList.innerHTML = v.log.map((e) => `<li>${esc(e.text)}</li>`).join('');
  logList.scrollTop = logList.scrollHeight;

  q('#lobby').innerHTML = v.started ? '' : lobbyHtml({
    title: `${ui.deck.name} ${V.name}`, view: v, minPlayers: ui.deck.minPlayers, maxPlayers: ui.deck.maxPlayers,
    code: ui.code, isHost: ui.mode === 'host',
  });
  q('#status').hidden = !ui.lost;

  if (animating() && !anim.timer) {
    anim.timer = setInterval(() => {
      if (!animating()) {
        clearInterval(anim.timer);
        anim.timer = null;
        anim.idx.clear();
        render();
        return;
      }
      document.querySelectorAll('.die.rolling').forEach((el) => {
        const sides = Number(el.dataset.sides);
        el.querySelector('.face').innerHTML = faceInner(randomFace(sides), sides);
      });
    }, 70);
  }
}

function renderTray() {
  const { v, V, turnP, canAct, canRoll, canToken, allHeld } = ctxInfo();
  const el = q('#tray');
  if (v.finished) {
    const res = v.players.map((p) => ({ p, t: totals(v.variant, v.sheets[p.id]).total })).sort((a, b) => b.t - a.t);
    const best = res.length ? res[0].t : 0;
    el.innerHTML = `<div class="results">
      <div class="trophy-big">🏆</div>
      <h2>Spiel ${v.game} ist vorbei</h2>
      <ol class="ranking">${res.map((r) => `<li class="${r.t === best ? 'win' : ''}" style="--pc:${r.p.color}"><span class="dot"></span><b>${esc(r.p.name)}</b><span class="pts">${r.t}</span></li>`).join('')}</ol>
      <div class="tray-actions">
        <button class="btn primary big" data-act="newGame">Neues Spiel</button>
      </div>
      <p class="tray-hint">Andere Variante? Über das Menü.</p>
    </div>`;
    return;
  }
  const rolling = animating();
  const isMe = turnP && turnP.id === v.me;
  let head = '';
  if (turnP) {
    head = `<div class="turn" style="--pc:${turnP.color}"><span class="dot"></span><b>${isMe ? 'Du bist dran!' : `${esc(turnP.name)} ist dran`}</b>
      <span class="rolls">${[0, 1, 2].map((i) => `<i class="${i < 3 - v.rollsLeft ? 'used' : ''}"></i>`).join('')}</span>
      ${V.tokens ? `<span class="tokens" title="Tokens von ${esc(turnP.name)}">${Array.from({ length: V.tokens }, (_, i) => `<i class="${i < turnP.tokens ? '' : 'used'}">🪙</i>`).join('')}</span>` : ''}
    </div>`;
  }
  let hint;
  if (!canAct) {
    hint = turnP ? `Warte, bis ${esc(turnP.name)} fertig ist.` : '';
  } else {
    const proxy = turnP.id !== v.me ? `${esc(turnP.name)} ist offline – du spielst für ${esc(turnP.name)}. ` : '';
    if (v.rolled === 0) hint = `${proxy}Würfle, um zu beginnen.`;
    else if (allHeld) hint = `${proxy}Alle Würfel behalten – wähle ein Feld im Block oder gib einen Würfel frei.`;
    else if (v.rollsLeft === 0 && !canToken) hint = `${proxy}Keine Würfe mehr – tippe ein Feld im Block an.`;
    else hint = `${proxy}Tippe Würfel an, die du behalten willst – oder wähle direkt ein Feld im Block.`;
  }
  const rollLabel = v.rolled === 0 ? 'Würfeln' : 'Nochmal würfeln';
  el.innerHTML = `${head}
    <div class="dice">${v.dice.map((d, i) => dieHtml(d, i, rolling && anim.idx.has(i), canAct && v.rolled > 0 && !rolling)).join('')}</div>
    <div class="tray-actions">
      <button class="btn primary big roll-btn" data-act="roll"${canRoll && !rolling ? '' : ' disabled'}>🎲 ${rollLabel}<small>${v.rollsLeft} ${v.rollsLeft === 1 ? 'Wurf' : 'Würfe'} übrig</small></button>
      ${V.tokens ? `<button class="btn token-btn" data-act="token"${canToken && !rolling ? '' : ' disabled'}>🪙 Token einlösen<small>${turnP ? turnP.tokens : 0} übrig</small></button>` : ''}
    </div>
    <p class="tray-hint">${hint}</p>`;
}

function renderSheet() {
  const { v, V, canAct } = ctxInfo();
  const cats = categories(v.variant);
  const showPreview = v.rolled > 0 && !v.finished && !animating();
  const ps = v.players;
  const tot = Object.fromEntries(ps.map((p) => [p.id, totals(v.variant, v.sheets[p.id])]));
  const colCls = (p) => `pc${p.id === v.turn && !v.finished ? ' cur' : ''}`;

  const cell = (p, c) => {
    const val = v.sheets[p.id] ? v.sheets[p.id][c.id] : undefined;
    if (typeof val === 'number') return `<td class="${colCls(p)} filled${val === 0 ? ' zero' : ''}">${val === 0 ? '–' : val}</td>`;
    if (showPreview && p.id === v.turn) {
      const pv = scoreOf(v.variant, c.id, v.dice);
      const pick = canAct ? ` pick" data-cat="${c.id}" title="${esc(c.name)}: ${pv} eintragen` : '';
      return `<td class="${colCls(p)} preview${pv ? '' : ' zero'}${pick}">${pv}</td>`;
    }
    return `<td class="${colCls(p)}"></td>`;
  };
  const catRow = (c) => `<tr><th class="cat" scope="row"><b>${esc(c.name)}</b><small>${esc(c.hint)}</small></th>${ps.map((p) => cell(p, c)).join('')}</tr>`;
  const sumRow = (label, fn, cls = '') => `<tr class="sum ${cls}"><th class="cat" scope="row"><b>${label}</b></th>${ps.map((p) => `<td class="${colCls(p)}">${fn(p)}</td>`).join('')}</tr>`;
  const upperDone = (p) => cats.filter((c) => c.upper).every((c) => typeof v.sheets[p.id]?.[c.id] === 'number');

  q('#sheet').innerHTML = `
    <thead><tr><th class="cat corner">Spiel ${v.game}<small>${esc(V.name)}</small></th>${ps.map((p) => `
      <th class="${colCls(p)} phead${p.connected ? '' : ' off'}" style="--pc:${p.color}"><span class="dot"></span><b>${esc(p.name)}</b>
        <small>🏆 ${p.wins}${V.tokens ? ` · 🪙 ${p.tokens}` : ''}</small></th>`).join('')}</tr></thead>
    <tbody>
      ${cats.filter((c) => c.upper).map(catRow).join('')}
      ${sumRow('Summe oben', (p) => tot[p.id].upper)}
      ${sumRow(`Bonus <small>ab ${V.bonusAt} → +${V.bonus}</small>`, (p) => (tot[p.id].bonus ? `+${tot[p.id].bonus}` : upperDone(p) ? '–' : `<small class="need">noch ${V.bonusAt - tot[p.id].upper}</small>`))}
      ${sumRow('Gesamt oben', (p) => tot[p.id].upperTotal, 'strong')}
      <tr class="gap"><td colspan="${ps.length + 1}"></td></tr>
      ${cats.filter((c) => !c.upper).map(catRow).join('')}
      ${sumRow('Gesamt unten', (p) => tot[p.id].lower)}
      ${sumRow('Gesamt oben', (p) => tot[p.id].upperTotal)}
      ${sumRow('Endsumme', (p) => tot[p.id].total, 'final')}
    </tbody>`;
}

// ---------- Bedienung ----------
function onAct(name) {
  const { canRoll, canToken } = ctxInfo();
  switch (name) {
    case 'undo': return C.act({ type: 'undo' });
    case 'log': C.ui.logOpen = !C.ui.logOpen; q('#game').classList.toggle('log-open', C.ui.logOpen); return;
    case 'menu': return openMenu();
    case 'copy': return C.copyLink();
    case 'start': return C.act({ type: 'start' });
    case 'leave': return C.leave();
    case 'roll': if (canRoll && !animating()) C.act({ type: 'roll' }); return;
    case 'token': if (canToken && !animating()) C.act({ type: 'roll', token: true }); return;
    case 'newGame': return C.act({ type: 'newGame' });
  }
}

function openMenu() {
  const { v, V, isHost } = ctxInfo();
  const items = [['Spielregeln', showRules]];
  for (const nv of Object.values(VARIANTS)) {
    items.push([`Neues Spiel: ${C.ui.deck.name} ${nv.name}`, () => confirmModal(`Neues Spiel (${nv.name}) starten?`, v.finished ? 'Alle Blätter werden geleert.' : 'Das laufende Spiel wird abgebrochen und alle Blätter werden geleert. (Mit „Zurück“ rückgängig zu machen.)', () => C.act({ type: 'newGame', variant: nv.id }))]);
  }
  items.push(['Meinen Namen ändern', C.openRename]);
  items.push(['Einladungslink kopieren', C.copyLink]);
  if (isHost) {
    items.push(['Siege zurücksetzen', () => confirmModal('Siege zurücksetzen?', 'Alle Siege werden auf 0 gesetzt.', () => C.act({ type: 'resetWins' }))]);
    for (const p of v.players) {
      if (p.id !== v.me) items.push([`${p.name} aus dem Raum entfernen`, () => confirmModal(`${p.name} entfernen?`, 'Das Blatt von diesem Spieler wird gelöscht.', () => C.act({ type: 'kick', pid: p.id })), 'danger']);
    }
  }
  items.push([C.ui.mode === 'host' ? 'Raum schließen' : 'Raum verlassen', C.leave, 'danger']);
  void V;
  listModal('Menü', items);
}

function showRules() {
  const { V } = ctxInfo();
  modal(`<h2>Spielregeln: ${esc(C.ui.deck.name)} ${esc(V.name)}</h2><ul class="rules">${V.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted small-text">Die Punkte rechnet die Website automatisch aus – beim Antippen eines Felds wird der angezeigte Wert eingetragen. Vertippt? „↶ Zurück“.</p>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}

function bind(g) {
  g.addEventListener('click', (e) => {
    const t = e.target;
    const a = t.closest('[data-act]');
    if (a) { if (!a.disabled) onAct(a.dataset.act); return; }
    if (t.closest('#codeBtn')) return C.copyLink();
    const die = t.closest('[data-die]');
    if (die) {
      if (die.disabled || animating()) return;
      die.classList.toggle('held'); // sofort zeigen, der Host bestätigt
      C.act({ type: 'hold', i: Number(die.dataset.die) });
      return;
    }
    const cell = t.closest('[data-cat]');
    if (cell && !animating()) C.act({ type: 'score', cat: cell.dataset.cat });
  });
}

window.addEventListener('keydown', (e) => {
  if (!C || C.ui.deck?.type !== 'dice' || !C.ui.view?.started) return;
  if (e.code !== 'Space' || e.target.closest('input, textarea') || q('.modal')) return;
  e.preventDefault();
  const { canRoll } = ctxInfo();
  if (canRoll && !animating()) C.act({ type: 'roll' });
});
