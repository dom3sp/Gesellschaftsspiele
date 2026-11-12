// Lauf-Kartenspiel mit Figuren ("Wuff!") – Spielzustand, läuft nur beim Host.
// Gleiche Schnittstelle wie die anderen Spiele. Die Zugregeln (options/fwd/…) sind reine Funktionen,
// damit die Oberfläche dieselben Leuchtfelder berechnen kann.

import { rid } from './game.js';

const MAX_LOG = 100;
const UNDO_MAX = 40;
const fail = (msg) => new Error(msg);
const randInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const L = 96;     // Felder auf der Laufbahn
export const SEG = 16;   // Felder pro Farbe
export const COLORS = [
  { key: 'green', name: 'Grün', hex: '#2f9e44' },
  { key: 'cyan', name: 'Hellblau', hex: '#4dabf7' },
  { key: 'orange', name: 'Orange', hex: '#f08c00' },
  { key: 'red', name: 'Rot', hex: '#e03131' },
  { key: 'yellow', name: 'Gelb', hex: '#fcc419' },
  { key: 'pink', name: 'Pink', hex: '#d6336c' },
];
// Welche Plätze (Farben) bei wie vielen Spielern – Partner sitzen sich gegenüber (Platz + 3)
export const SEATS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
export const DEAL = [6, 5, 4, 3, 2];
export const CARDS = {
  A: { name: 'Ass', red: true, short: 'A', text: 'Start – oder 1 bzw. 11 Felder vor' },
  2: { name: '2', short: '2', text: '2 Felder vor' },
  3: { name: '3', short: '3', text: '3 Felder vor' },
  4: { name: '4 ±', red: true, short: '4±', text: '4 Felder vor oder zurück' },
  5: { name: '5', short: '5', text: '5 Felder vor' },
  6: { name: '6', short: '6', text: '6 Felder vor' },
  7: { name: '7', red: true, short: '7', text: '7 Schritte – beliebig auf eigene Figuren aufteilbar. Überholte Figuren sind verbrannt!' },
  8: { name: '8', short: '8', text: '8 Felder vor' },
  9: { name: '9', short: '9', text: '9 Felder vor' },
  10: { name: '10', short: '10', text: '10 Felder vor' },
  12: { name: '12', short: '12', text: '12 Felder vor' },
  K: { name: 'König', red: true, short: 'K', text: 'Start – oder 13 Felder vor' },
  T: { name: 'Tausch', red: true, short: '⇄', text: 'Eine eigene Figur mit einer fremden tauschen (nicht geschützte, nicht im Ziel)' },
  J: { name: 'Joker', red: true, short: '?', text: 'Gilt als jede andere Karte' },
};
export const CARD_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', 'K', 'T', 'J'];
const NUM = { 2: 2, 3: 3, 5: 5, 6: 6, 8: 8, 9: 9, 10: 10, 12: 12 };

export const RULES = [
  'Zu viert oder zu sechst spielen die Gegenübersitzenden als Team. Gewonnen hat das Team, das zuerst alle Figuren im Ziel hat. Wer fertig ist, zieht mit seinen Karten die Figuren des Partners.',
  'Es werden 6, 5, 4, 3, 2, dann wieder 6 … Karten ausgeteilt. Vorher tauschen die Partner verdeckt eine Karte. Es wird nicht nachgezogen.',
  'Wer dran ist, spielt eine Karte und zieht entsprechend. Wer keinen Zug machen kann, scheidet für diese Runde aus – seine Karten verfallen.',
  'Blaue Karten: so viele Felder vorwärts. Überspringen ist erlaubt. Wer auf einem besetzten Feld landet, schlägt die Figur dort (auch eine eigene) zurück in den Zwinger.',
  'Ass: Start oder 1/11 · König: Start oder 13 · 4: vor oder zurück · 7: aufteilen, überholte Figuren werden verbrannt · Tausch: eigene mit fremder Figur tauschen · Joker: jede Karte.',
  'Eine Figur auf ihrem eigenen Startfeld ist geschützt: Sie kann nicht geschlagen, getauscht oder überholt werden und blockiert alle – auch die eigenen.',
  'Ins Ziel geht es nur vorwärts über das eigene Startfeld (nicht direkt vom Startfeld aus). Im Ziel wird nicht übersprungen, geschlagen oder rückwärts gezogen.',
  'Jede Karte muss vollständig ausgeführt werden – auch die 7.',
  'Bei 2, 3 und 5 Spielern spielt jeder für sich mit 4 Figuren (eine steht sofort auf dem Startfeld, 3 im Zwinger), gibt vor der Runde eine Karte nach links weiter und darf, wenn er nicht ziehen kann, eine Karte abwerfen und eine neue ziehen. Wer zuerst alle 4 Figuren im Ziel hat, gewinnt.',
];

// ---------------------------------------------------------------------------
// Reine Zugregeln. ctx = { players: [{ id, seat }], pieces: { pid: [loc] }, mode }
// loc = { z: 'h' } | { z: 't', i } | { z: 'g', k }
// ---------------------------------------------------------------------------
export const startOf = (seat) => seat * SEG;
const seatOf = (ctx, pid) => ctx.players.find((p) => p.id === pid)?.seat;
export function partnerOf(ctx, pid) {
  if (ctx.mode !== 'team') return null;
  const seat = seatOf(ctx, pid);
  return ctx.players.find((p) => p.seat === (seat + 3) % 6)?.id || null;
}
export const sameLoc = (a, b) => a && b && a.z === b.z && (a.z === 'h' || (a.z === 't' ? a.i === b.i : a.k === b.k));
export const allInGoal = (ctx, pid) => {
  const ps = ctx.pieces[pid] || [];
  return ps.length > 0 && ps.every((l) => l.z === 'g');
};
export function movers(ctx, pid) {
  if (ctx.mode === 'team' && allInGoal(ctx, pid)) { const p = partnerOf(ctx, pid); return p ? [p] : [pid]; }
  return [pid];
}
function occMap(ctx) {
  const m = new Map();
  for (const p of ctx.players) (ctx.pieces[p.id] || []).forEach((l, idx) => { if (l.z === 't') m.set(l.i, { owner: p.id, idx }); });
  return m;
}
function isProtected(ctx, occ, i) {
  const o = occ.get(i);
  return !!o && startOf(seatOf(ctx, o.owner)) === i;
}
const goalFree = (ctx, owner, k) => !(ctx.pieces[owner] || []).some((l) => l.z === 'g' && l.k === k);

// Vorwärts n Schritte. Liefert mögliche Ergebnisse (Laufbahn und/oder Ziel).
export function fwd(ctx, owner, idx, n, occ = occMap(ctx)) {
  const loc = ctx.pieces[owner][idx];
  if (loc.z === 'h' || n <= 0) return [];
  if (loc.z === 'g') {
    const t = loc.k + n;
    if (t > 3) return [];
    const path = [];
    for (let k = loc.k + 1; k <= t; k++) { if (!goalFree(ctx, owner, k)) return []; path.push({ z: 'g', k }); }
    return [{ to: { z: 'g', k: t }, path, passed: [] }];
  }
  const S = startOf(seatOf(ctx, owner));
  const res = [];
  const path = [];
  for (let step = 1; step <= n; step++) {
    const pos = (loc.i + step) % L;
    if (isProtected(ctx, occ, pos)) return res; // geschützte Figur: nicht überholen, nicht schlagen
    path.push({ z: 't', i: pos });
    if (pos === S && step < n) {
      const r = n - step;
      if (r <= 4) {
        const gp = [];
        let ok = true;
        for (let k = 0; k < r; k++) { if (!goalFree(ctx, owner, k)) { ok = false; break; } gp.push({ z: 'g', k }); }
        if (ok) res.push({ to: { z: 'g', k: r - 1 }, path: [...path, ...gp], passed: path.map((x) => x.i) });
      }
    }
  }
  res.push({ to: { z: 't', i: (loc.i + n) % L }, path, passed: path.slice(0, -1).map((x) => x.i) });
  return res;
}
function back4(ctx, owner, idx, occ = occMap(ctx)) {
  const loc = ctx.pieces[owner][idx];
  if (loc.z !== 't') return [];
  const path = [];
  for (let step = 1; step <= 4; step++) {
    const pos = (loc.i - step + L) % L;
    if (isProtected(ctx, occ, pos)) return [];
    path.push({ z: 't', i: pos });
  }
  return [{ to: { z: 't', i: path[3].i }, path, passed: [], back: true }];
}
function startMove(ctx, owner, idx, occ = occMap(ctx)) {
  if (ctx.pieces[owner][idx].z !== 'h') return [];
  const S = startOf(seatOf(ctx, owner));
  const o = occ.get(S);
  if (o && o.owner === owner) return []; // eigene Figur steht geschützt auf dem Startfeld
  return [{ to: { z: 't', i: S }, path: [{ z: 't', i: S }], passed: [], start: true }];
}

// Alle Züge für eine Karte (außer 7). Ergebnis: [{ owner, idx, to, path, passed, kind, other? }]
export function options(ctx, pid, type) {
  const occ = occMap(ctx);
  const out = [];
  const add = (owner, idx, list, kind = 'move') => list.forEach((r) => out.push({ owner, idx, kind: r.start ? 'start' : kind, ...r }));
  for (const owner of movers(ctx, pid)) {
    (ctx.pieces[owner] || []).forEach((_, idx) => {
      if (type === 'A') { add(owner, idx, startMove(ctx, owner, idx, occ)); add(owner, idx, fwd(ctx, owner, idx, 1, occ)); add(owner, idx, fwd(ctx, owner, idx, 11, occ)); }
      else if (type === 'K') { add(owner, idx, startMove(ctx, owner, idx, occ)); add(owner, idx, fwd(ctx, owner, idx, 13, occ)); }
      else if (type === '4') { add(owner, idx, fwd(ctx, owner, idx, 4, occ)); add(owner, idx, back4(ctx, owner, idx, occ)); }
      else if (NUM[type]) add(owner, idx, fwd(ctx, owner, idx, NUM[type], occ));
    });
    if (type === 'T') {
      (ctx.pieces[owner] || []).forEach((l, idx) => {
        if (l.z !== 't' || isProtected(ctx, occ, l.i)) return;
        for (const p of ctx.players) {
          if (p.id === owner) continue;
          (ctx.pieces[p.id] || []).forEach((m, j) => {
            if (m.z !== 't' || isProtected(ctx, occ, m.i)) return;
            out.push({ owner, idx, kind: 'swap', to: { z: 't', i: m.i }, path: [], passed: [], other: { owner: p.id, idx: j } });
          });
        }
      });
    }
  }
  return out;
}

// 7er-Teilschritte mit k Schritten
export function sevenOptions(ctx, pid, maxK) {
  const occ = occMap(ctx);
  const out = [];
  for (const owner of movers(ctx, pid)) {
    (ctx.pieces[owner] || []).forEach((_, idx) => {
      for (let k = 1; k <= maxK; k++) fwd(ctx, owner, idx, k, occ).forEach((r) => out.push({ owner, idx, kind: 'seven', k, ...r }));
    });
  }
  return out;
}
const cloneCtx = (ctx) => ({ players: ctx.players, mode: ctx.mode, pieces: JSON.parse(JSON.stringify(ctx.pieces)) });
// Zug auf einen ctx anwenden (auch für Simulationen). Liefert geschlagene Figuren.
export function applyOpt(ctx, opt, burn) {
  const occ = occMap(ctx);
  const hit = [];
  const home = (o) => { ctx.pieces[o.owner][o.idx] = { z: 'h' }; hit.push(o); };
  const me = { owner: opt.owner, idx: opt.idx };
  if (opt.kind === 'swap') {
    const a = ctx.pieces[opt.owner][opt.idx], b = ctx.pieces[opt.other.owner][opt.other.idx];
    ctx.pieces[opt.owner][opt.idx] = b;
    ctx.pieces[opt.other.owner][opt.other.idx] = a;
    return hit;
  }
  if (burn) for (const i of opt.passed) { const o = occ.get(i); if (o && !(o.owner === me.owner && o.idx === me.idx)) home(o); }
  if (opt.to.z === 't') { const o = occ.get(opt.to.i); if (o && !(o.owner === me.owner && o.idx === me.idx) && ctx.pieces[o.owner][o.idx].z === 't') home(o); }
  ctx.pieces[opt.owner][opt.idx] = { ...opt.to };
  return hit;
}
// Lassen sich "left" Schritte komplett verteilen?
export function canSeven(ctx, pid, left, memo = new Map()) {
  if (left === 0) return true;
  const key = `${left}|${JSON.stringify(ctx.pieces)}`;
  if (memo.has(key)) return memo.get(key);
  let ok = false;
  for (const o of sevenOptions(ctx, pid, left)) {
    const c = cloneCtx(ctx);
    applyOpt(c, o, true);
    if (canSeven(c, pid, left - o.k, memo)) { ok = true; break; }
  }
  memo.set(key, ok);
  return ok;
}
// Kann diese Karte gespielt werden? (Tausch geht immer – notfalls ohne Wirkung)
export function playable(ctx, pid, type) {
  if (type === 'T' || type === 'J') return true;
  if (type === '7') return canSeven(ctx, pid, 7);
  return options(ctx, pid, type).length > 0;
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
function log(s, text) {
  s.log.push({ n: ++s.seq, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}
const P = (s, pid) => s.players.find((p) => p.id === pid);
const ctxOf = (s) => ({ players: s.players, pieces: s.pieces, mode: s.mode });
const cname = (t) => (CARDS[t].red ? CARDS[t].name : `eine ${CARDS[t].name}`);

export function createState(deck, deckId) {
  const s = {
    kind: 'dog', deckId, variant: 'classic', started: false, finished: false, game: 1, seq: 0,
    players: [], mode: 'team', pieces: {}, cards: {}, deck: [], discard: [], hands: {},
    roundNo: 0, dealer: 0, phase: 'lobby', turn: null, exch: {}, out: {}, seven: null, stuck: null,
    log: [], undo: [],
  };
  for (const t of CARD_ORDER) for (let k = 0; k < (t === 'J' ? 6 : 8); k++) { let id; do id = rid(5); while (s.cards[id]); s.cards[id] = t; }
  return s;
}

export function addPlayer(s, deck, name, token, isHost = false) {
  name = String(name || '').trim().slice(0, 20) || 'Spieler';
  if (token) {
    const ex = s.players.find((p) => p.token === token);
    if (ex) { ex.connected = true; log(s, `${ex.name} ist wieder da`); return ex; }
  }
  if (s.started || s.players.length >= deck.maxPlayers) return null;
  const p = { id: rid(6), name, token: token || null, host: isHost, connected: true, wins: 0, seat: s.players.length, color: COLORS[s.players.length].hex };
  s.players.push(p);
  s.hands[p.id] = [];
  log(s, `${p.name} ${isHost ? 'hat den Raum erstellt' : 'ist beigetreten'}`);
  return p;
}

export function setConnected(s, pid, on) {
  const p = P(s, pid);
  if (!p || p.connected === on) return;
  p.connected = on;
  log(s, `${p.name} ${on ? 'ist wieder da' : 'hat die Verbindung verloren'}`);
}

function setupPieces(s) {
  for (const p of s.players) {
    s.pieces[p.id] = s.mode === 'team' ? [{ z: 'h' }, { z: 'h' }, { z: 'h' }, { z: 'h' }]
      : [{ z: 't', i: startOf(p.seat) }, { z: 'h' }, { z: 'h' }, { z: 'h' }]; // allein: 1 auf dem Start, 3 im Zwinger
  }
}

function newRound(s) {
  s.roundNo++;
  const n = s.players.length;
  const count = DEAL[(s.roundNo - 1) % DEAL.length];
  for (const p of s.players) { s.discard.push(...s.hands[p.id]); s.hands[p.id] = []; }
  if (s.deck.length < count * n) { s.deck = shuffle([...s.deck, ...s.discard]); s.discard = []; log(s, 'Der Ablagestapel wird neu gemischt'); }
  const dealOrder = [];
  let q = nextPlayer(s, s.players[s.dealer].id);
  for (let k = 0; k < n; k++) { dealOrder.push(q.id); q = nextPlayer(s, q.id); }
  for (let k = 0; k < count; k++) for (const id of dealOrder) s.hands[id].push(s.deck.pop());
  if (s.lastEvents) s.lastEvents.push({ kind: 'deal', count, order: dealOrder, dealer: s.players[s.dealer].id });
  s.exch = {};
  s.out = {};
  s.seven = null;
  s.stuck = null;
  s.phase = 'exchange';
  s.turn = null;
  s.undo = [];
  log(s, `Runde ${s.roundNo}: ${P(s, s.players[s.dealer].id).name} teilt je ${count} Karten aus – jetzt ${s.mode === 'team' ? 'mit dem Partner' : 'nach links'} eine Karte tauschen`);
}

const order = (s) => [...s.players].sort((a, b) => a.seat - b.seat);
function nextPlayer(s, pid) {
  const o = order(s);
  const i = o.findIndex((p) => p.id === pid);
  return o[(i + 1) % o.length];
}
const hasCards = (s, pid) => (s.hands[pid] || []).length > 0;

// Spieler an die Reihe bringen – wer nicht ziehen kann, scheidet aus (Team) bzw. darf tauschen (allein).
function beginTurn(s, start) {
  let p = start;
  for (let guard = 0; guard < s.players.length + 1; guard++) {
    if (hasCards(s, p.id) && !s.out[p.id]) {
      const ctx = ctxOf(s);
      const can = s.hands[p.id].some((cid) => playable(ctx, p.id, s.cards[cid]));
      if (can) { s.turn = p.id; s.phase = 'play'; return; }
      if (s.mode === 'solo') { s.turn = p.id; s.phase = 'play'; s.stuck = { pid: p.id, n: 1 }; log(s, `${p.name} kann nicht ziehen – darf eine Karte abwerfen und eine neue ziehen`); return; }
      s.out[p.id] = true;
      s.discard.push(...s.hands[p.id]);
      s.hands[p.id] = [];
      log(s, `${p.name} kann nicht ziehen und scheidet für diese Runde aus`);
    }
    p = nextPlayer(s, p.id);
  }
  // niemand kann mehr → neue Runde
  s.dealer = (s.dealer + 1) % s.players.length;
  newRound(s);
}
function endTurn(s, pid) {
  s.seven = null;
  s.stuck = null;
  if (checkWin(s)) return;
  if (s.players.every((p) => !hasCards(s, p.id))) {
    s.dealer = (s.dealer + 1) % s.players.length;
    newRound(s);
    return;
  }
  beginTurn(s, nextPlayer(s, pid));
}
function checkWin(s) {
  const ctx = ctxOf(s);
  let winners = null;
  if (s.mode === 'team') {
    for (const p of s.players) {
      const q = partnerOf(ctx, p.id);
      if (allInGoal(ctx, p.id) && (!q || allInGoal(ctx, q))) { winners = [p, ...(q ? [P(s, q)] : [])]; break; }
    }
  } else {
    const p = s.players.find((x) => allInGoal(ctx, x.id));
    if (p) winners = [p];
  }
  if (!winners) return false;
  s.finished = true;
  s.phase = 'over';
  s.turn = null;
  for (const w of winners) w.wins++;
  const names = winners.map((w) => w.name).join(' & ');
  s.lastEvents.push({ kind: 'win', name: names, color: winners[0].color });
  log(s, `🏆 ${names} ${winners.length > 1 ? 'haben' : 'hat'} alle Figuren im Ziel und ${winners.length > 1 ? 'gewinnen' : 'gewinnt'}!`);
  return true;
}

// ---------- Zurück ----------
const SNAP = ['pieces', 'hands', 'deck', 'discard', 'turn', 'phase', 'seven', 'stuck', 'out', 'exch', 'roundNo', 'dealer', 'finished'];
function snapshot(s) {
  const o = {};
  for (const k of SNAP) o[k] = s[k];
  o.wins = Object.fromEntries(s.players.map((p) => [p.id, p.wins]));
  return JSON.parse(JSON.stringify(o));
}
function restore(s, snap) {
  for (const k of SNAP) s[k] = snap[k];
  for (const p of s.players) if (p.id in snap.wins) p.wins = snap.wins[p.id];
}
const UNDOABLE = new Set(['play', 'seven', 'free', 'discard', 'stuck']);

export function applyAction(s, deck, pid, a) {
  if (!Array.isArray(s.undo)) s.undo = [];
  s.lastEvents = [];
  const me0 = P(s, pid);
  if (a && a.type === 'undo') {
    if (!me0) throw fail('Unbekannter Spieler.');
    const last = s.undo[s.undo.length - 1];
    if (!last || last.pid !== pid) throw fail('Du hast gerade nichts zum Zurücknehmen.');
    s.undo.pop();
    restore(s, last.snap);
    log(s, `↶ ${me0.name} nimmt zurück: ${last.label}`);
    return { events: [{ kind: 'undo', name: me0.name, label: last.label }] };
  }
  const undoable = me0 && a && UNDOABLE.has(a.type);
  const snap = undoable ? snapshot(s) : null;
  const seqBefore = s.seq;
  const roundBefore = s.roundNo;
  applyInner(s, deck, pid, a);
  if (undoable && s.seq !== seqBefore && s.roundNo === roundBefore) {
    const entry = s.log.find((e) => e.n === seqBefore + 1) || s.log[s.log.length - 1];
    s.undo.push({ pid, snap, label: entry.text });
    if (s.undo.length > UNDO_MAX) s.undo.splice(0, s.undo.length - UNDO_MAX);
  }
  return { events: s.lastEvents };
}

function applyInner(s, deck, pid, a) {
  const me = P(s, pid);
  if (!me) throw fail('Unbekannter Spieler.');
  const N = me.name;
  const needHost = () => { if (!me.host) throw fail('Das darf nur der Host.'); };
  const needTurn = () => {
    if (s.phase !== 'play') throw fail(s.phase === 'exchange' ? 'Erst wird eine Karte getauscht.' : 'Das geht gerade nicht.');
    const t = P(s, s.turn);
    if (!t) throw fail('Gerade ist niemand dran.');
    if (t.id !== pid && !(me.host && !t.connected)) throw fail(`${t.name} ist dran.`);
    return t;
  };
  const takeCard = (t, cid) => {
    const h = s.hands[t.id];
    const i = h.indexOf(cid);
    if (i < 0) throw fail('Diese Karte hast du nicht.');
    h.splice(i, 1);
    s.discard.push(cid);
    s.lastEvents.push({ kind: 'cardPlayed', by: t.id, t: s.cards[cid] });
  };
  const moveEvent = (opt, dragged) => s.lastEvents.push({ kind: 'dmove', owner: opt.owner, idx: opt.idx, path: opt.path, by: pid, dragged: !!dragged });
  const hitText = (hit, burn) => (hit.length ? ` – ${hit.map((h) => P(s, h.owner).name).join(', ')} ${burn ? 'verbrannt' : 'geschlagen'}!` : '');

  switch (a && a.type) {
    case 'start': {
      needHost();
      if (s.started) break;
      if (s.players.length < 2) throw fail('Es braucht mindestens 2 Spieler.');
      const n = s.players.length;
      s.mode = n === 4 || n === 6 ? 'team' : 'solo';
      SEATS[n].forEach((seat, k) => { s.players[k].seat = seat; s.players[k].color = COLORS[seat].hex; });
      s.started = true;
      setupPieces(s);
      s.deck = shuffle(Object.keys(s.cards));
      s.dealer = 0;
      log(s, s.mode === 'team' ? `Spiel beginnt – Teams: ${teamsText(s)}` : 'Spiel beginnt – jeder spielt für sich (4 Figuren, eine steht schon auf dem Start)');
      newRound(s);
      break;
    }

    case 'give': {
      if (s.phase !== 'exchange') throw fail('Gerade wird nicht getauscht.');
      if (!s.hands[pid].includes(a.cid)) throw fail('Diese Karte hast du nicht.');
      s.exch[pid] = a.cid;
      const all = s.players.every((p) => s.exch[p.id]);
      if (!all) { log(s, `${N} hat eine Karte zum Tauschen ausgewählt`); break; }
      const ctx = ctxOf(s);
      const moves = s.players.map((p) => ({ from: p.id, to: s.mode === 'team' ? partnerOf(ctx, p.id) : nextPlayer(s, p.id).id, cid: s.exch[p.id] }));
      for (const m of moves) { const h = s.hands[m.from]; h.splice(h.indexOf(m.cid), 1); }
      for (const m of moves) s.hands[m.to].push(m.cid);
      s.exch = {};
      log(s, 'Karten sind getauscht');
      beginTurn(s, nextPlayer(s, s.players[s.dealer].id));
      break;
    }

    case 'play': {
      const t = needTurn();
      if (s.seven) throw fail('Erst die 7 zu Ende ziehen.');
      if (s.stuck) throw fail('Du kannst gerade nicht ziehen – wirf eine Karte ab.');
      const real = s.cards[a.cid];
      if (!real || !s.hands[t.id].includes(a.cid)) throw fail('Diese Karte hast du nicht.');
      const type = real === 'J' ? a.as : real;
      if (!CARDS[type] || type === 'J') throw fail('Wähle, als welche Karte der Joker gilt.');
      const ctx = ctxOf(s);
      const label = real === 'J' ? `einen Joker (als ${CARDS[type].name})` : cname(type);
      if (type === '7') {
        if (!canSeven(ctx, t.id, 7)) throw fail('Die 7 lässt sich gerade nicht komplett ziehen.');
        s.seven = { cid: a.cid, left: 7, label };
        log(s, `${t.name} spielt ${label} – 7 Schritte aufteilen`);
        break;
      }
      if (type === 'T' && a.noEffect) {
        if (options(ctx, t.id, 'T').length) throw fail('Es gibt einen möglichen Tausch – der muss gemacht werden.');
        takeCard(t, a.cid);
        log(s, `${t.name} legt ${label} ohne Wirkung ab`);
        endTurn(s, t.id);
        break;
      }
      const opts = options(ctx, t.id, type);
      const opt = opts.find((o) => o.owner === a.owner && o.idx === Number(a.idx) && sameLoc(o.to, a.to) && (o.kind !== 'swap' || !a.other || (o.other.owner === a.other.owner && o.other.idx === Number(a.other.idx))));
      if (!opt) throw fail('Dieser Zug geht mit dieser Karte nicht.');
      takeCard(t, a.cid);
      const hit = applyOpt(s, opt, false);
      for (const h of hit) void h;
      moveEvent(opt, a.dragged);
      const whose = opt.owner === t.id ? '' : ` (Figur von ${P(s, opt.owner).name})`;
      let what;
      if (opt.kind === 'start') what = 'bringt eine Figur aufs Startfeld';
      else if (opt.kind === 'swap') what = `tauscht mit ${P(s, opt.other.owner).name}`;
      else if (opt.to.z === 'g') what = 'zieht ins Ziel';
      else what = opt.back ? 'zieht 4 zurück' : 'zieht';
      log(s, `${t.name} spielt ${label} und ${what}${whose}${hitText(hit)}`);
      endTurn(s, t.id);
      break;
    }

    case 'seven': {
      const t = needTurn();
      if (!s.seven) throw fail('Gerade wird keine 7 gezogen.');
      const ctx = ctxOf(s);
      const opts = sevenOptions(ctx, t.id, s.seven.left).filter((o) => o.owner === a.owner && o.idx === Number(a.idx) && sameLoc(o.to, a.to));
      const opt = opts.find((o) => { const c = cloneCtx(ctx); applyOpt(c, o, true); return canSeven(c, t.id, s.seven.left - o.k); });
      if (!opt) throw fail(opts.length ? 'Danach blieben Schritte übrig, die keine Figur mehr gehen kann.' : 'Dorthin kommt die Figur mit der 7 nicht.');
      const hit = applyOpt(s, opt, true);
      moveEvent(opt, a.dragged);
      s.seven.left -= opt.k;
      log(s, `${t.name} zieht ${opt.k} ${opt.k === 1 ? 'Schritt' : 'Schritte'}${opt.owner === t.id ? '' : ` mit ${P(s, opt.owner).name}`}${opt.to.z === 'g' ? ' ins Ziel' : ''}${hitText(hit, true)}${s.seven.left ? ` (noch ${s.seven.left})` : ''}`);
      if (s.seven.left === 0) { takeCard(t, s.seven.cid); endTurn(s, t.id); }
      break;
    }

    case 'cancelSeven': {
      needTurn();
      if (!s.seven || s.seven.left !== 7) throw fail('Die 7 ist schon angefangen – „Zurück“ nimmt Schritte zurück.');
      s.seven = null;
      break;
    }

    case 'free': {
      // Freies Verschieben wie am echten Tisch (ohne Karte, ohne Regelprüfung)
      const t = needTurn();
      const owner = P(s, a.owner);
      if (!owner) throw fail('Diese Figur gibt es nicht.');
      const idx = Number(a.idx);
      if (!s.pieces[owner.id][idx]) throw fail('Diese Figur gibt es nicht.');
      const to = a.to || {};
      let dest;
      if (to.z === 'h') dest = { z: 'h' };
      else if (to.z === 't' && to.i >= 0 && to.i < L) dest = { z: 't', i: to.i };
      else if (to.z === 'g' && to.k >= 0 && to.k <= 3) {
        if (to.owner && to.owner !== owner.id) throw fail('In ein fremdes Ziel geht das nicht.');
        if (!goalFree(ctxOf(s), owner.id, to.k)) throw fail('Dieses Zielfeld ist schon besetzt.');
        dest = { z: 'g', k: to.k };
      } else throw fail('Ungültiges Feld.');
      let hitTxt = '';
      if (dest.z === 't') {
        const o = occMap(ctxOf(s)).get(dest.i);
        if (o && !(o.owner === owner.id && o.idx === idx)) { s.pieces[o.owner][o.idx] = { z: 'h' }; hitTxt = ` – ${P(s, o.owner).name} muss zurück in den Zwinger`; }
      }
      s.pieces[owner.id][idx] = dest;
      log(s, `${t.name} verschiebt ${owner.id === t.id ? 'eine eigene Figur' : `eine Figur von ${owner.name}`} frei${dest.z === 'h' ? ' in den Zwinger' : dest.z === 'g' ? ' ins Ziel' : ''}${hitTxt}`);
      checkWin(s);
      break;
    }

    case 'discard': {
      // Karte ohne Zug ablegen (z. B. nach freiem Verschieben)
      const t = needTurn();
      if (s.seven) throw fail('Erst die 7 zu Ende ziehen.');
      const type = s.cards[a.cid];
      takeCard(t, a.cid);
      log(s, `${t.name} legt ${cname(type)} ab${s.stuck ? '' : ' (ohne Zug)'}`);
      endTurn(s, t.id);
      break;
    }

    case 'stuck': {
      // Allein-Regel: nicht ziehen können → Karte abwerfen, neue ziehen
      const t = needTurn();
      if (!s.stuck || s.stuck.pid !== t.id) throw fail('Das geht gerade nicht.');
      const type = s.cards[a.cid];
      takeCard(t, a.cid);
      if (s.stuck.n === 1) {
        if (!s.deck.length) { s.deck = shuffle(s.discard.splice(0, s.discard.length - 1)); }
        const c = s.deck.pop();
        if (c) s.hands[t.id].push(c);
        const can = s.hands[t.id].some((cid) => playable(ctxOf(s), t.id, s.cards[cid]));
        log(s, `${t.name} wirft ${cname(type)} ab und zieht eine neue Karte${can ? '' : ' – geht immer noch nicht'}`);
        if (can) s.stuck = null; else s.stuck.n = 2;
      } else {
        log(s, `${t.name} wirft ${cname(type)} ab`);
        endTurn(s, t.id);
      }
      break;
    }

    case 'newGame': {
      s.game++;
      s.finished = false;
      s.roundNo = 0;
      setupPieces(s);
      for (const p of s.players) s.hands[p.id] = [];
      s.deck = shuffle(Object.keys(s.cards));
      s.discard = [];
      s.dealer = (s.game - 1) % s.players.length;
      log(s, `${N} startet Spiel ${s.game}`);
      newRound(s);
      break;
    }

    case 'rename': {
      const name = String(a.name || '').trim().slice(0, 20);
      if (!name) throw fail('Der Name darf nicht leer sein.');
      if (name === me.name) break;
      log(s, `${me.name} heißt jetzt ${name}`);
      me.name = name;
      break;
    }

    case 'resetWins': {
      needHost();
      for (const p of s.players) p.wins = 0;
      log(s, `${N} setzt alle Siege auf 0`);
      break;
    }

    case 'kick': {
      needHost();
      const t = P(s, a.pid);
      if (!t) throw fail('Diesen Spieler gibt es nicht.');
      if (t.id === pid) throw fail('Du kannst dich nicht selbst entfernen.');
      if (s.started) throw fail('Während des Spiels kann niemand entfernt werden – startet sonst ein neues Spiel im neuen Raum.');
      s.players = s.players.filter((p) => p.id !== t.id);
      s.players.forEach((p, k) => { p.seat = k; p.color = COLORS[k].hex; });
      s.lastEvents.push({ kind: 'kicked', pid: t.id });
      log(s, `${N} entfernt ${t.name} aus dem Raum`);
      break;
    }

    default:
      throw fail('Unbekannte Aktion.');
  }
}

function teamsText(s) {
  const ctx = ctxOf(s);
  const done = new Set();
  const parts = [];
  for (const p of order(s)) {
    if (done.has(p.id)) continue;
    const q = partnerOf(ctx, p.id);
    done.add(p.id); if (q) done.add(q);
    parts.push(q ? `${p.name} & ${P(s, q).name}` : p.name);
  }
  return parts.join(' gegen ');
}

export function viewFor(s, deck, pid) {
  const top = s.undo && s.undo.length ? s.undo[s.undo.length - 1] : null;
  return {
    me: pid,
    kind: 'dog',
    deckId: s.deckId,
    variant: 'classic',
    started: s.started,
    finished: s.finished,
    game: s.game,
    mode: s.mode,
    phase: s.phase,
    turn: s.turn,
    roundNo: s.roundNo,
    dealCount: s.roundNo ? DEAL[(s.roundNo - 1) % DEAL.length] : 0,
    dealer: s.players[s.dealer]?.id || null,
    seven: s.seven ? { left: s.seven.left, label: s.seven.label } : null,
    stuck: s.stuck,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, host: p.host, color: p.color, connected: p.connected, wins: p.wins, seat: p.seat,
      count: (s.hands[p.id] || []).length, out: !!s.out[p.id], gave: !!s.exch[p.id],
    })),
    pieces: s.pieces,
    hand: (s.hands[pid] || []).map((cid) => ({ id: cid, t: s.cards[cid] })),
    myGive: s.exch[pid] || null,
    sevenCard: s.seven && s.turn === pid ? s.seven.cid : null,
    discardTop: s.discard.length ? s.cards[s.discard[s.discard.length - 1]] : null,
    discardCount: s.discard.length,
    deckCount: s.deck.length,
    log: s.log.slice(-60),
    undo: top && top.pid === pid ? top.label : null,
  };
}
