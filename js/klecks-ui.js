// Oberfläche für das Farbblock-Würfelspiel: Würfel wählen + Felder auf dem Blatt markieren.
import { q, esc, modal, closeModal, listModal, confirmModal, lobbyHtml, toggleLog, applyLog, toast } from './ui.js';
import { faceInner } from './dice-ui.js';
import {
  VARIANTS, RULES, COLORS, COLOR_KEYS, LETTERS, TOP, BOT, JOKERS, W, H, START_COL, SOLO_ROLLS,
  colorAt, neighbors, checkMove, diceRule, score,
} from './klecks.js';

let C = null; // { ui, act, copyLink, leave, openRename }
export function initKlecksUI(ctx) { C = ctx; }

const randInt = (n) => Math.floor(Math.random() * n);
const anim = { idx: new Set(), until: 0, timer: null };
const animating = () => anim.idx.size > 0 && performance.now() < anim.until;
export function onKlecksEvent(ev) {
  if (ev.kind === 'roll') { anim.idx = new Set(ev.idx); anim.until = performance.now() + 850; }
}

// Eigene Auswahl (nur lokal, bis „Eintragen“ gedrückt wird)
const sel = { key: '', c: null, n: null, cells: new Set() };

function skeleton() {
  return `
  <div id="game" class="game klecks-game">
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
        <section id="ktray" class="tray xtray ktray"></section>
        <section id="kme" class="kme"></section>
        <section id="kopps" class="xopps"></section>
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
  const myPick = v.picks ? v.picks[v.me] : null;
  const rule = running ? diceRule(v, v.me) : { wait: 'x', usable: [] };
  const canChoose = running && v.rolled && !myPick && !rule.wait && !animating();
  const all = v.players.map((p) => v.sheets[p.id]);
  return { v, V, meP, turnP, isHost, running, canTurn, myPick, rule, canChoose, all, solo: v.players.length === 1 };
}

function syncSel() {
  const v = C.ui.view;
  const key = `${v.game}:${v.round}`;
  if (sel.key !== key || (v.picks && v.picks[v.me])) {
    sel.key = key; sel.c = null; sel.n = null; sel.cells = new Set();
  }
}

export function render() {
  const ui = C.ui;
  const v = ui.view;
  if (!v || !ui.deck) return;
  let g = q('#game.klecks-game');
  if (!g) {
    document.getElementById('app').innerHTML = skeleton();
    g = q('#game.klecks-game');
    bind(g);
  }
  syncSel();
  const { V } = info();
  applyLog(ui);
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
      document.querySelectorAll('.kdie.rolling').forEach((el) => {
        const face = el.querySelector('.face');
        if (el.dataset.kind === 'c') { const k = [...COLOR_KEYS, 'j'][randInt(6)]; el.dataset.col = k; face.innerHTML = k === 'j' ? '<span class="kq">?</span>' : ''; }
        else { const n = randInt(6); face.innerHTML = n ? faceInner(n, 6) : '<span class="kq">?</span>'; }
      });
    }, 70);
  }
}

// ---------- Würfel & Aktionen ----------
function dieHtml(d, i, st) {
  const { v, rule, canChoose } = st;
  if (d.v === null && v.rolled) return '';
  const roll = animating() && anim.idx.has(i);
  const cls = ['die', 'kdie', `k${d.t}`];
  if (roll) cls.push('rolling');
  if (d.v === null) cls.push('blank');
  const usable = canChoose && rule.usable[i];
  const ap = v.picks && v.turn ? v.picks[v.turn] : null;
  const takenByActive = ap && !ap.pass && (ap.c === i || ap.n === i);
  const myPick = v.picks && v.picks[v.me];
  if (myPick && !myPick.pass && (myPick.c === i || myPick.n === i)) cls.push('used');
  if ((d.t === 'c' ? sel.c : sel.n) === i) cls.push('chosen');
  if (canChoose && !rule.usable[i]) cls.push('taken');
  const col = d.t === 'c' ? (roll ? 'g' : d.v || 'none') : '';
  let face;
  if (d.v === null) face = '<span class="die-q">?</span>';
  else if (d.t === 'c') face = d.v === 'j' ? '<span class="kq">?</span>' : '';
  else face = d.v === 0 ? '<span class="kq">?</span>' : faceInner(d.v, 6);
  const style = roll ? ` style="--spin:${(randInt(2) ? 1 : -1) * (300 + randInt(260))}deg;--dur:${0.6 + Math.random() * 0.25}s"` : '';
  const label = d.t === 'c' ? (d.v === 'j' ? 'Farb-Joker' : COLORS[d.v] || '–') : d.v === 0 ? 'Zahlen-Joker' : d.v ?? '–';
  const tag = takenByActive && v.round > 3 && v.players.length > 1 ? `<span class="ktag">${esc(v.players.find((p) => p.id === v.turn)?.name || '')}</span>` : '';
  return `<div class="xdie-wrap"><button class="${cls.join(' ')}" data-die="${i}" data-kind="${d.t}" data-col="${col}"${usable ? '' : ' disabled'}${style} aria-label="${label}"><span class="face">${face}</span></button>${tag}</div>`;
}

function renderTray() {
  const st = info();
  const { v, V, turnP, canTurn, myPick, rule, canChoose, all, solo } = st;
  const el = q('#ktray');
  if (v.finished) {
    const res = v.players.map((p) => ({ p, sc: score(V, v.sheets[p.id], all) })).sort((a, b) => b.sc.total - a.sc.total || b.sc.jokers - a.sc.jokers);
    const best = res.length ? res[0] : null;
    el.innerHTML = `<div class="results">
      <div class="trophy-big">🏆</div>
      <h2>Spiel ${v.game} ist vorbei</h2>
      <ol class="ranking">${res.map((r) => `<li class="${best && r.sc.total === best.sc.total && r.sc.jokers === best.sc.jokers ? 'win' : ''}" style="--pc:${r.p.color}"><span class="dot"></span><b>${esc(r.p.name)}</b><span class="pts">${r.sc.total}</span></li>`).join('')}</ol>
      <div class="tray-actions"><button class="btn primary big" data-act="newGame">Neues Spiel</button></div>
    </div>`;
    return;
  }
  const isMe = turnP && turnP.id === v.me;
  const head = turnP ? `<div class="turn" style="--pc:${turnP.color}"><span class="dot"></span><b>${isMe ? 'Du würfelst!' : `${esc(turnP.name)} würfelt`}</b>
    <span class="muted">${v.rolled && v.round ? `${v.round}. Wurf${solo ? ` von ${SOLO_ROLLS}` : ''}` : ''}</span></div>` : '';
  const dice = `<div class="dice xdice kdice">
    <div class="kgroup">${v.dice.slice(0, 3).map((d, i) => dieHtml(d, i, st)).join('')}</div>
    <div class="kgroup">${v.dice.slice(3).map((d, i) => dieHtml(d, i + 3, st)).join('')}</div></div>`;

  let actions = '';
  let hint = '';
  if (!v.rolled) {
    if (canTurn) actions = `<button class="btn primary big roll-btn" data-act="roll"${animating() ? ' disabled' : ''}>🎲 Würfeln</button>`;
    hint = canTurn ? (turnP.id !== v.me ? `${esc(turnP.name)} ist offline – du würfelst für ${esc(turnP.name)}.` : 'Würfle, wenn alle bereit sind.') : `Warte, bis ${esc(turnP ? turnP.name : '')} würfelt.`;
  } else if (animating()) {
    hint = '…';
  } else if (myPick) {
    hint = myPick.pass ? 'Du hast gepasst.' : '✓ Eingetragen.';
    const waiting = v.players.filter((p) => !v.picks[p.id]).map((p) => p.name);
    if (waiting.length) hint += ` Noch am Wählen: ${waiting.map(esc).join(', ')}.`;
  } else if (rule.wait === 'active') {
    hint = `Warte, bis ${esc(turnP.name)} gewählt hat – danach darfst du aus den übrigen Würfeln wählen.`;
  } else {
    const chk = selCheck(st);
    const ready = !chk.error;
    actions = `<button class="btn primary big roll-btn" data-act="commit"${ready ? '' : ' disabled'}>✓ Eintragen</button>
      <button class="btn" data-act="pass">Passen</button>
      ${sel.cells.size ? '<button class="btn ghost" data-act="clear">Auswahl löschen</button>' : ''}`;
    if (sel.c === null || sel.n === null) hint = `Tippe 1 Farbwürfel und 1 Zahlenwürfel an${v.round <= 3 && !solo ? ' (in den ersten 3 Würfen dürfen alle aus allen Würfeln wählen)' : ''}.`;
    else hint = ready ? `Passt! ${chk.cost ? `Kostet ${chk.cost} „!“. ` : ''}Tippe „Eintragen“.` : esc(chk.error);
  }
  if (v.rolled && canTurn && !animating()) {
    actions += `<button class="btn ${myPick ? 'primary big roll-btn' : 'ghost'}" data-act="endTurn">Zug beenden →</button>`;
  }
  el.innerHTML = `${head}${dice}${actions ? `<div class="tray-actions">${actions}</div>` : ''}<p class="tray-hint">${hint}</p>`;
}

function selCheck(st) {
  const { v, V } = st;
  if (sel.c === null || sel.n === null) return { error: 'Würfel wählen.' };
  return checkMove(V, v.sheets[v.me], v.dice, sel.c, sel.n, [...sel.cells]);
}

// ---------- Eigenes Blatt ----------
function sheetHtml(p, interactive) {
  const st = info();
  const { v, V, all, canChoose } = st;
  const sh = v.sheets[p.id];
  const sc = score(V, sh, all);
  const crossed = new Set(sh.x);
  const stars = new Set(V.stars);
  const reach = new Set();
  if (interactive && canChoose) {
    for (let i = 0; i < W * H; i++) {
      if (crossed.has(i)) continue;
      if (i % W === START_COL || neighbors(i).some((n) => crossed.has(n) || sel.cells.has(n))) reach.add(i);
    }
  }
  const head = LETTERS.map((L, c) => `<div class="khead${c === START_COL ? ' start' : ''}${c in sh.colDone ? ' done' : ''}">${L}</div>`).join('');
  const cells = Array.from({ length: W * H }, (_, i) => {
    const col = colorAt(V, i);
    const cls = ['kcell', `k-${col}`];
    if (i % W === START_COL) cls.push('hcol');
    if (stars.has(i)) cls.push('star');
    if (crossed.has(i)) cls.push('x');
    else if (sel.cells.has(i)) cls.push('sel');
    else if (reach.has(i)) cls.push('reach');
    const click = interactive && canChoose && !crossed.has(i);
    return `<button class="${cls.join(' ')}"${click ? ` data-cell="${i}"` : ' tabindex="-1"'} aria-label="${LETTERS[i % W]}${Math.floor(i / W) + 1} ${COLORS[col]}${stars.has(i) ? ' Stern' : ''}${crossed.has(i) ? ' angekreuzt' : ''}"></button>`;
  }).join('');
  const done = (c) => sc.colPts[c] !== null;
  const topRow = TOP.map((n, c) => `<div class="kpt${done(c) && !sc.lostTop[c] ? ' got' : ''}${sc.lostTop[c] ? ' lost' : ''}${c === START_COL ? ' start' : ''}">${n}</div>`).join('');
  const botRow = BOT.map((n, c) => `<div class="kpt low${done(c) && sc.lostTop[c] ? ' got' : ''}${c === START_COL ? ' start' : ''}">${n}</div>`).join('');
  const bonus = COLOR_KEYS.map((k) => {
    const got = sc.colorPts[k];
    return `<div class="kbonus k-${k}"><span class="${got === 5 ? 'got' : ''}${sc.lostFive[k] ? ' lost' : ''}">5</span><span class="${got === 3 ? 'got' : ''}">3</span></div>`;
  }).join('');
  const jok = Array.from({ length: JOKERS }, (_, k) => `<span class="kjok${k < sh.jok ? ' used' : ''}">!</span>`).join('');
  return `<div class="ksheet">
    <div class="kgrid-wrap">
      <div class="kgrid kheads">${head}</div>
      <div class="kgrid kcells">${cells}</div>
      <div class="kgrid kpts">${topRow}</div>
      <div class="kgrid kpts">${botRow}</div>
      <div class="kjoks"><span class="kjok-label"><b>?</b> = </span>${jok}</div>
    </div>
    <div class="kside">
      <div class="kbonuses">${bonus}</div>
      <div class="ksum"><span>Bonus</span><b>${sc.bonus}</b></div>
      <div class="ksum"><span>A–O</span><b>+ ${sc.cols}</b></div>
      <div class="ksum"><span>! (+1)</span><b>+ ${sc.jokers}</b></div>
      <div class="ksum"><span>★ (−2)</span><b>− ${sc.stars}</b></div>
      <div class="ksum total"><span>Total</span><b>${sc.total}</b></div>
    </div>
  </div>`;
}

function renderMe() {
  const { v, meP } = info();
  const el = q('#kme');
  if (!meP || !v.sheets[meP.id]) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="xme-head" style="--pc:${meP.color}"><span class="dot"></span><b>Dein Blatt</b><span class="muted">🏆 ${meP.wins}</span></div>${sheetHtml(meP, true)}`;
}

function renderOpps() {
  const { v, V, all } = info();
  const others = v.players.filter((p) => p.id !== v.me);
  const el = q('#kopps');
  if (!others.length) { el.innerHTML = ''; return; }
  el.innerHTML = others.map((p) => {
    const sh = v.sheets[p.id];
    const sc = score(V, sh, all);
    const crossed = new Set(sh.x);
    const pick = v.picks && v.picks[p.id];
    const state = !v.rolled || v.finished ? '' : pick ? (pick.pass ? 'passt' : '✓ fertig') : 'wählt …';
    const mini = Array.from({ length: W * H }, (_, i) => `<i class="k-${colorAt(V, i)}${crossed.has(i) ? ' x' : ''}"></i>`).join('');
    return `<div class="xopp${p.connected ? '' : ' off'}${p.id === v.turn && !v.finished ? ' cur' : ''}" style="--pc:${p.color}">
      <div class="xopp-head"><span class="dot"></span><b>${esc(p.name)}</b>${p.id === v.turn && !v.finished ? '<span class="tag">würfelt</span>' : ''}${state ? `<span class="tag">${state}</span>` : ''}<span class="spacer"></span><span class="muted">🏆 ${p.wins}</span></div>
      <div class="kmini">${mini}</div>
      <div class="xopp-foot"><span>Farben: ${Object.keys(sh.colorDone).length}/5 · „!“ übrig: ${JOKERS - sh.jok}</span><b>${sc.total} Punkte</b></div>
    </div>`;
  }).join('');
}

// ---------- Bedienung ----------
function endTurn() {
  const { v } = info();
  const notDone = v.players.filter((p) => p.id !== v.turn && !v.picks[p.id]).map((p) => p.name);
  const go = () => C.act({ type: 'endTurn' });
  if (!v.picks[v.turn] && v.turn === v.me) {
    return confirmModal('Passen und Zug beenden?', 'Du hast für diesen Wurf nichts eingetragen.', go);
  }
  if (notDone.length) {
    return confirmModal('Noch nicht alle fertig', `${notDone.join(', ')} ${notDone.length > 1 ? 'haben' : 'hat'} noch nicht gewählt. Trotzdem weiter?`, go);
  }
  go();
}

function onAct(name) {
  const st = info();
  switch (name) {
    case 'undo': return C.act({ type: 'undo' });
    case 'log': return toggleLog(C.ui);
    case 'menu': return openMenu();
    case 'copy': return C.copyLink();
    case 'start': return C.act({ type: 'start' });
    case 'leave': return C.leave();
    case 'roll': if (!animating()) C.act({ type: 'roll' }); return;
    case 'endTurn': if (!animating()) endTurn(); return;
    case 'pass': return C.act({ type: 'pass' });
    case 'clear': sel.cells.clear(); return render();
    case 'commit': {
      const chk = selCheck(st);
      if (chk.error) return toast(chk.error, 'error');
      return C.act({ type: 'commit', c: sel.c, n: sel.n, cells: [...sel.cells] });
    }
    case 'newGame': return C.act({ type: 'newGame' });
  }
}

function openMenu() {
  const { v, isHost } = info();
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
  listModal('Menü', items);
}

function showRules() {
  modal(`<h2>Spielregeln: ${esc(C.ui.deck.name)}</h2><ul class="rules">${RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="muted small-text">So geht's hier: Würfel antippen (1 Farbe + 1 Zahl), dann die Felder auf deinem Blatt antippen und „Eintragen“. Die Website prüft die Regeln und rechnet die Punkte aus. Vertippt? „↶ Zurück“.</p>
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
      if (die.disabled) return;
      const i = Number(die.dataset.die);
      if (die.dataset.kind === 'c') sel.c = sel.c === i ? null : i;
      else sel.n = sel.n === i ? null : i;
      return render();
    }
    const cell = t.closest('[data-cell]');
    if (cell) {
      const i = Number(cell.dataset.cell);
      if (sel.cells.has(i)) sel.cells.delete(i);
      else if (sel.cells.size >= 5) toast('Höchstens 5 Felder pro Wurf.', 'error');
      else sel.cells.add(i);
      render();
    }
  });
}
