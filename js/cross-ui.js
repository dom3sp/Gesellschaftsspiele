// Oberfläche für das Ankreuz-Würfelspiel: Würfel + digitaler Zettel.
import { q, esc, modal, closeModal, listModal, confirmModal, lobbyHtml } from './ui.js';
import { faceInner } from './dice-ui.js';
import { VARIANTS, COLORS, RULES, score, tri } from './cross.js';

let C = null; // { ui, act, copyLink, leave, openRename }
export function initCrossUI(ctx) { C = ctx; }

const randInt = (n) => Math.floor(Math.random() * n);
const anim = { idx: new Set(), until: 0, timer: null };
const animating = () => anim.idx.size > 0 && performance.now() < anim.until;

export function onCrossEvent(ev) {
  if (ev.kind === 'roll') { anim.idx = new Set(ev.idx); anim.until = performance.now() + 850; }
}

const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="4.5" y="10" width="15" height="11" rx="2.5" fill="currentColor"/></svg>';

function skeleton() {
  return `
  <div id="game" class="game cross-game">
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
      <div class="xmain">
        <section id="xtray" class="tray xtray"></section>
        <section id="xme" class="xme"></section>
        <section id="xopps" class="xopps"></section>
      </div>
      <aside id="log" class="log"><div class="log-head">Verlauf <button class="icon-btn" data-act="log" aria-label="Schließen">✕</button></div><ol id="logList"></ol></aside>
    </div>
    <div id="lobby"></div>
  </div>`;
}

function info() {
  const v = C.ui.view;
  const V = VARIANTS[v.variant] || VARIANTS.classic;
  const meP = v.players.find((p) => p.id === v.me);
  const turnP = v.players.find((p) => p.id === v.turn) || null;
  const isHost = !!(meP && meP.host);
  const running = v.started && !v.finished;
  const canTurn = !!(running && turnP && (turnP.id === v.me || (isHost && !turnP.connected)));
  return { v, V, meP, turnP, isHost, running, canTurn };
}

export function render() {
  const ui = C.ui;
  const v = ui.view;
  if (!v || !ui.deck) return;
  let g = q('#game.cross-game');
  if (!g) {
    document.getElementById('app').innerHTML = skeleton();
    g = q('#game.cross-game');
    bind(g);
  }
  const { V } = info();
  g.classList.toggle('log-open', !!ui.logOpen);
  q('#codeBtn b').textContent = ui.code || '';
  q('#deckName').textContent = `${ui.deck.name} ${V.name} · Spiel ${v.game}`;
  const undoBtn = q('#undoBtn');
  undoBtn.disabled = !v.undo;
  undoBtn.title = v.undo ? `Zurücknehmen: ${v.undo}` : 'Du hast nichts zum Zurücknehmen';

  renderTray();
  renderMe();
  renderOpps();

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
      document.querySelectorAll('.xdie.rolling .face').forEach((el) => { el.innerHTML = faceInner(1 + randInt(6), 6); });
    }, 70);
  }
}

// ---------- Würfel ----------
function renderTray() {
  const { v, V, turnP, canTurn } = info();
  const el = q('#xtray');
  if (v.finished) {
    const res = v.players.map((p) => ({ p, t: score(v.sheets[p.id]).total })).sort((a, b) => b.t - a.t);
    const best = res.length ? res[0].t : 0;
    el.innerHTML = `<div class="results">
      <div class="trophy-big">🏆</div>
      <h2>Spiel ${v.game} ist vorbei</h2>
      <ol class="ranking">${res.map((r) => `<li class="${r.t === best ? 'win' : ''}" style="--pc:${r.p.color}"><span class="dot"></span><b>${esc(r.p.name)}</b><span class="pts">${r.t}</span></li>`).join('')}</ol>
      <div class="tray-actions"><button class="btn primary big" data-act="newGame">Neues Spiel</button></div>
    </div>`;
    return;
  }
  const rolling = animating();
  const isMe = turnP && turnP.id === v.me;
  const dice = v.dice.map((d, i) => {
    const color = d.c;
    const r = i - 2;
    const out = r >= 0 && v.removed[r];
    const locked = r >= 0 && r in v.locks;
    const roll = rolling && anim.idx.has(i);
    const style = roll ? ` style="--spin:${(randInt(2) ? 1 : -1) * (300 + randInt(260))}deg;--dur:${0.6 + Math.random() * 0.25}s"` : '';
    const toggle = r >= 0 && (out || locked) && v.started
      ? `<button class="die-toggle${locked && !out ? ' pulse' : ''}" data-toggle="${r}">${out ? '↺ zurück' : '✕ raus'}</button>` : '';
    return `<div class="xdie-wrap"><div class="die xdie c-${color}${out ? ' out' : ''}${roll ? ' rolling' : ''}${d.v === null && !out ? ' blank' : ''}"${style}
      aria-label="${color === 'white' ? 'Weiß' : COLORS[color].name}: ${out ? 'raus' : d.v ?? '–'}"><span class="face">${out ? '<span class="die-out">✕</span>' : faceInner(roll ? 1 + randInt(6) : d.v, 6)}</span></div>${toggle}</div>`;
  }).join('');

  const white = v.rolled && !rolling ? v.dice[0].v + v.dice[1].v : null;
  let head = '';
  if (turnP) {
    head = `<div class="turn" style="--pc:${turnP.color}"><span class="dot"></span><b>${isMe ? 'Du würfelst!' : `${esc(turnP.name)} würfelt`}</b></div>`;
  }
  let hint = '';
  if (white !== null) {
    hint = isMe
      ? `Weiß zusammen: <b>${white}</b> – in jeder Reihe möglich. Zusätzlich darfst du weiß + farbig in der passenden Farbe ankreuzen.`
      : `Weiß zusammen: <b>${white}</b> – du darfst die ${white} in einer Reihe ankreuzen.`;
  } else if (!v.rolled) {
    hint = canTurn ? (turnP.id !== v.me ? `${esc(turnP.name)} ist offline – du würfelst für ${esc(turnP.name)}.` : 'Würfle, wenn alle bereit sind.') : `Warte, bis ${esc(turnP ? turnP.name : '')} würfelt.`;
  }
  let btn = '';
  if (canTurn && !v.rolled) btn = `<button class="btn primary big roll-btn" data-act="roll"${rolling ? ' disabled' : ''}>🎲 Würfeln</button>`;
  else if (canTurn && v.rolled) btn = `<button class="btn primary big roll-btn" data-act="endTurn"${rolling ? ' disabled' : ''}>Zug beenden →</button>`;

  el.innerHTML = `${head}<div class="dice xdice">${dice}</div>
    ${btn ? `<div class="tray-actions">${btn}</div>` : ''}
    <p class="tray-hint">${hint}</p>`;
}

// ---------- Eigener Zettel ----------
function sheetHtml(p, interactive) {
  const { v, V, running } = info();
  const sh = v.sheets[p.id];
  const sc = score(sh);
  const rolledNow = v.rolled && !animating();
  const white = rolledNow ? v.dice[0].v + v.dice[1].v : null;
  const isTurn = p.id === v.turn;

  const rows = V.rows.map((row, r) => {
    const crossed = new Set(sh.rows[r]);
    const last = sh.rows[r].length ? Math.max(...sh.rows[r]) : -1;
    const closed = r in v.locks;
    const lockedByMe = sh.locked.includes(r);
    const colorDie = v.dice[r + 2] && !v.removed[r] ? v.dice[r + 2].v : null;
    const colorSums = rolledNow && isTurn && colorDie !== null ? [v.dice[0].v + colorDie, v.dice[1].v + colorDie] : [];
    const cells = row.nums.map((n, i) => {
      const cls = ['xcell'];
      let attrs = '';
      if (crossed.has(i)) cls.push('x');
      else if (i < last) cls.push('gone');
      else if (closed) cls.push('gone');
      else {
        const isLast = i === row.nums.length - 1;
        if (isLast && sh.rows[r].length < 5) cls.push('need5');
        else if (interactive && running) { cls.push('open'); attrs = ` data-row="${r}" data-i="${i}"`; }
        if (n === white) cls.push('hint-w');
        if (colorSums.includes(n)) cls.push('hint-c');
      }
      if (i === row.nums.length - 1) cls.push('lastcell');
      return `<button class="${cls.join(' ')}"${attrs}${attrs ? '' : ' tabindex="-1"'} aria-label="${COLORS[row.color].name} ${n}${crossed.has(i) ? ' angekreuzt' : ''}"><span>${n}</span></button>`;
    }).join('');
    return `<div class="xrow c-${row.color}${closed ? ' closed' : ''}">
      <div class="xcells">${cells}</div>
      <div class="xlock${lockedByMe ? ' mine' : closed ? ' other' : ''}" title="${lockedByMe ? 'Von dir geschlossen (zählt als Kreuz)' : closed ? 'Geschlossen' : 'Schloss: letztes Feld ab 5 Kreuzen'}">${LOCK_SVG}</div>
    </div>`;
  }).join('');

  const totalCrosses = sc.counts.reduce((a, b) => a + b, 0);
  const legend = Array.from({ length: 12 }, (_, k) => `<div class="xleg${sc.counts.includes(k + 1) ? ' hit' : ''}"><b>${k + 1}×</b><span>${tri(k + 1)}</span></div>`).join('');
  const pens = Array.from({ length: 4 }, (_, k) => `<span class="xpen${k < sh.pen ? ' on' : ''}">${k < sh.pen ? '✕' : ''}</span>`).join('');
  const result = V.rows.map((row, r) => `<div class="xres c-${row.color}"><b>${sc.rows[r]}</b><small>${sc.counts[r]}×</small></div>`).join('<span class="op">+</span>');

  return `<div class="xsheet${interactive ? ' interactive' : ''}">
    ${rows}
    <div class="xfoot">
      <div class="xlegend"><div class="xleg head"><b>Kreuze</b><span>Punkte</span></div>${legend}</div>
      <div class="xpens"><div class="xpens-label">Fehlwürfe je −5</div><div class="xpens-boxes">${pens}</div>
        ${interactive ? `<button class="btn small xpen-btn" data-act="penalty"${running && sh.pen < 4 ? '' : ' disabled'}>Fehlwurf (−5)</button>` : ''}</div>
    </div>
    <div class="xresult"><span class="xres-label">Ergebnis</span>${result}<span class="op">−</span><div class="xres pen"><b>${sc.pen}</b><small>${sh.pen}×</small></div><span class="op">=</span><div class="xres total"><b>${sc.total}</b><small>${totalCrosses} ${totalCrosses === 1 ? 'Kreuz' : 'Kreuze'}</small></div></div>
  </div>`;
}

function renderMe() {
  const { v, meP } = info();
  const el = q('#xme');
  if (!meP || !v.sheets[meP.id]) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="xme-head" style="--pc:${meP.color}"><span class="dot"></span><b>Dein Zettel</b><span class="muted">🏆 ${meP.wins}</span></div>${sheetHtml(meP, true)}`;
}

function renderOpps() {
  const { v, V } = info();
  const others = v.players.filter((p) => p.id !== v.me);
  const el = q('#xopps');
  if (!others.length) { el.innerHTML = '<div class="opp-empty">Noch keine Mitspieler – teile den Raum-Code!</div>'; return; }
  el.innerHTML = others.map((p) => {
    const sh = v.sheets[p.id];
    const sc = score(sh);
    const mini = V.rows.map((row, r) => {
      const crossed = new Set(sh.rows[r]);
      const last = sh.rows[r].length ? Math.max(...sh.rows[r]) : -1;
      return `<div class="mrow c-${row.color}">${row.nums.map((n, i) => `<i class="${crossed.has(i) ? 'x' : i < last ? 'gone' : ''}">${crossed.has(i) ? '' : n}</i>`).join('')}<i class="mlock${sh.locked.includes(r) ? ' x' : ''}"></i><span class="mpts">${sc.rows[r]}</span></div>`;
    }).join('');
    return `<div class="xopp${p.connected ? '' : ' off'}${p.id === v.turn && !v.finished ? ' cur' : ''}" style="--pc:${p.color}">
      <div class="xopp-head"><span class="dot"></span><b>${esc(p.name)}</b>${p.id === v.turn && !v.finished ? '<span class="tag">würfelt</span>' : ''}<span class="spacer"></span><span class="muted">🏆 ${p.wins}</span></div>
      <div class="xmini">${mini}</div>
      <div class="xopp-foot"><span>Fehlwürfe: ${'✕'.repeat(sh.pen) || '–'}</span><b>${sc.total} Punkte</b></div>
    </div>`;
  }).join('');
}

// ---------- Bedienung ----------
function endTurn() {
  const { v, turnP } = info();
  if (turnP && turnP.id === v.me && v.turnCrosses === 0) {
    modal(`<h2>Nichts angekreuzt</h2><p class="muted">Du hast in diesem Zug nichts angekreuzt. Wer würfelt und nichts ankreuzt, bekommt einen Fehlwurf (−5).</p>
      <div class="list"><button class="btn primary list-btn" data-pen>Fehlwurf eintragen & weiter</button><button class="btn list-btn" data-nopen>Ohne Fehlwurf weiter</button></div>
      <div class="row end"><button class="btn ghost" data-close>Abbrechen</button></div>`, (m) => {
      q('[data-pen]', m).onclick = () => { closeModal(); C.act({ type: 'penalty' }); C.act({ type: 'endTurn' }); };
      q('[data-nopen]', m).onclick = () => { closeModal(); C.act({ type: 'endTurn' }); };
    });
    return;
  }
  C.act({ type: 'endTurn' });
}

function onAct(name) {
  switch (name) {
    case 'undo': return C.act({ type: 'undo' });
    case 'log': C.ui.logOpen = !C.ui.logOpen; q('#game').classList.toggle('log-open', C.ui.logOpen); return;
    case 'menu': return openMenu();
    case 'copy': return C.copyLink();
    case 'start': return C.act({ type: 'start' });
    case 'leave': return C.leave();
    case 'roll': if (!animating()) C.act({ type: 'roll' }); return;
    case 'endTurn': if (!animating()) endTurn(); return;
    case 'penalty': return C.act({ type: 'penalty' });
    case 'newGame': return C.act({ type: 'newGame' });
  }
}

function openMenu() {
  const { v, isHost } = info();
  const items = [['Spielregeln', showRules]];
  for (const nv of Object.values(VARIANTS)) {
    items.push([`Neues Spiel: ${C.ui.deck.name} ${nv.name}`, () => confirmModal(`Neues Spiel (${nv.name}) starten?`, v.finished ? 'Alle Zettel werden geleert.' : 'Das laufende Spiel wird abgebrochen und alle Zettel werden geleert. (Mit „Zurück“ rückgängig zu machen.)', () => C.act({ type: 'newGame', variant: nv.id }))]);
  }
  items.push(['Meinen Namen ändern', C.openRename]);
  items.push(['Einladungslink kopieren', C.copyLink]);
  if (isHost) {
    items.push(['Siege zurücksetzen', () => confirmModal('Siege zurücksetzen?', 'Alle Siege werden auf 0 gesetzt.', () => C.act({ type: 'resetWins' }))]);
    for (const p of v.players) {
      if (p.id !== v.me) items.push([`${p.name} aus dem Raum entfernen`, () => confirmModal(`${p.name} entfernen?`, 'Der Zettel von diesem Spieler wird gelöscht.', () => C.act({ type: 'kick', pid: p.id })), 'danger']);
    }
  }
  items.push([C.ui.mode === 'host' ? 'Raum schließen' : 'Raum verlassen', C.leave, 'danger']);
  listModal('Menü', items);
}

function showRules() {
  modal(`<h2>Spielregeln: ${esc(C.ui.deck.name)}</h2><ul class="rules">${RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted small-text">Tippe auf deinem Zettel ein Feld an, um es anzukreuzen. Felder, die zum Wurf passen, leuchten. Punkte rechnet die Website aus. Vertippt? „↶ Zurück“ nimmt deinen letzten Schritt zurück.</p>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}

function bind(g) {
  g.addEventListener('click', (e) => {
    const t = e.target;
    const a = t.closest('[data-act]');
    if (a) { if (!a.disabled) onAct(a.dataset.act); return; }
    if (t.closest('#codeBtn')) return C.copyLink();
    const tg = t.closest('[data-toggle]');
    if (tg) return C.act({ type: 'toggleDie', row: Number(tg.dataset.toggle) });
    const cell = t.closest('[data-row]');
    if (cell) C.act({ type: 'cross', row: Number(cell.dataset.row), i: Number(cell.dataset.i) });
  });
}
