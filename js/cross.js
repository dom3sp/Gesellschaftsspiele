// Ankreuz-Würfelspiel ("Kreuz & Quer") – Spielzustand, läuft nur beim Host.
// Gleiche Schnittstelle wie game.js/dice.js. Die Varianten unterscheiden sich nur im Zettel.

import { rid } from './game.js';

const MAX_LOG = 80;
const UNDO_MAX = 30;
const SEAT_COLORS = ['#f08c00', '#4dabf7', '#69db7c', '#da77f2', '#ff8787', '#ffd43b'];
const randInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const fail = (msg) => new Error(msg);

export const COLORS = {
  red: { name: 'Rot' },
  yellow: { name: 'Gelb' },
  green: { name: 'Grün' },
  blue: { name: 'Blau' },
};
// Würfel: zwei weiße und je einer pro Farbreihe (Index 2..5 gehört zu Reihe 0..3).
const DICE = ['white', 'white', 'red', 'yellow', 'green', 'blue'];

const UP = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DOWN = [...UP].reverse();

export const VARIANTS = {
  classic: {
    id: 'classic', name: 'Classic', short: '4 Farbreihen · Rot/Gelb 2–12, Grün/Blau 12–2',
    rows: [
      { color: 'red', nums: UP },
      { color: 'yellow', nums: UP },
      { color: 'green', nums: DOWN },
      { color: 'blue', nums: DOWN },
    ],
  },
};

export const RULES = [
  'Wer dran ist, würfelt mit allen Würfeln.',
  'ALLE Spieler dürfen die Summe der beiden weißen Würfel in einer beliebigen Reihe ankreuzen.',
  'Wer dran ist, darf zusätzlich einen weißen + einen farbigen Würfel zusammenzählen und in der Reihe dieser Farbe ankreuzen.',
  'In jeder Reihe wird nur von links nach rechts angekreuzt. Übersprungene Felder sind verloren.',
  'Wer dran ist und gar nichts ankreuzt, bekommt einen Fehlwurf (−5 Punkte).',
  'Das letzte Feld einer Reihe darf man erst ab 5 Kreuzen in der Reihe ankreuzen. Dann ist die Reihe für alle geschlossen (das Schloss zählt als weiteres Kreuz) und der Würfel dieser Farbe kommt raus.',
  'Das Spiel endet, sobald zwei Reihen geschlossen sind oder jemand 4 Fehlwürfe hat.',
  'Punkte pro Reihe: 1 Kreuz = 1, 2 = 3, 3 = 6, 4 = 10 … 12 = 78. Jeder Fehlwurf −5.',
];

export const tri = (n) => (n * (n + 1)) / 2;

export function rowCrosses(sheet, r) {
  return sheet.rows[r].length + (sheet.locked.includes(r) ? 1 : 0);
}

export function score(sheet) {
  if (!sheet) return { rows: [0, 0, 0, 0], counts: [0, 0, 0, 0], pen: 0, total: 0 };
  const counts = sheet.rows.map((_, r) => rowCrosses(sheet, r));
  const rows = counts.map(tri);
  const pen = sheet.pen * 5;
  return { rows, counts, pen, total: rows.reduce((a, b) => a + b, 0) - pen };
}

// ---------------------------------------------------------------------------
function log(s, text) {
  s.log.push({ n: ++s.seq, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}
const emptySheet = (V) => ({ rows: V.rows.map(() => []), locked: [], pen: 0 });
const resetDice = (s) => { s.dice = DICE.map((c) => ({ c, v: null })); s.rolled = false; s.turnCrosses = 0; };

export function createState(deck, deckId, variant) {
  const s = {
    kind: 'cross', deckId, variant: VARIANTS[variant] ? variant : 'classic',
    started: false, finished: false, game: 1, seq: 0,
    players: [], sheets: {}, locks: {}, removed: [false, false, false, false],
    turn: null, log: [], undo: {},
  };
  resetDice(s);
  return s;
}

export function addPlayer(s, deck, name, token, isHost = false) {
  name = String(name || '').trim().slice(0, 20) || 'Spieler';
  if (token) {
    const ex = s.players.find((p) => p.token === token);
    if (ex) { ex.connected = true; log(s, `${ex.name} ist wieder da`); return ex; }
  }
  if (s.players.length >= deck.maxPlayers) return null;
  const used = new Set(s.players.map((p) => p.color));
  const p = {
    id: rid(6), name, token: token || null, host: isHost, connected: true, wins: 0,
    color: SEAT_COLORS.find((c) => !used.has(c)) || SEAT_COLORS[0],
  };
  s.players.push(p);
  s.sheets[p.id] = emptySheet(VARIANTS[s.variant]);
  log(s, `${p.name} ${isHost ? 'hat den Raum erstellt' : 'ist beigetreten'}`);
  if (s.started && !s.finished && !s.turn) { s.turn = p.id; resetDice(s); }
  return p;
}

export function setConnected(s, pid, on) {
  const p = s.players.find((x) => x.id === pid);
  if (!p || p.connected === on) return;
  p.connected = on;
  log(s, `${p.name} ${on ? 'ist wieder da' : 'hat die Verbindung verloren'}`);
}

function checkEnd(s, events) {
  if (s.finished) return;
  const locks = Object.keys(s.locks).length;
  const tooMany = s.players.find((p) => s.sheets[p.id].pen >= 4);
  if (locks < 2 && !tooMany) return;
  s.finished = true;
  const res = s.players.map((p) => ({ p, total: score(s.sheets[p.id]).total }));
  const best = Math.max(...res.map((r) => r.total));
  const winners = res.filter((r) => r.total === best).map((r) => r.p);
  for (const w of winners) w.wins++;
  const names = winners.map((w) => w.name).join(' & ');
  const why = locks >= 2 ? 'zwei Reihen sind geschlossen' : `${tooMany.name} hat 4 Fehlwürfe`;
  events.push({ kind: 'win', name: names, color: winners[0].color });
  log(s, `🏆 Spiel ${s.game} ist vorbei (${why}) – ${names} ${winners.length > 1 ? 'gewinnen' : 'gewinnt'} mit ${best} Punkten`);
}

// ---------- Zurück (jeder nimmt seine eigenen Schritte zurück) ----------
function snapshot(s) {
  return JSON.parse(JSON.stringify({
    variant: s.variant, started: s.started, finished: s.finished, game: s.game, sheets: s.sheets,
    locks: s.locks, removed: s.removed, turn: s.turn, dice: s.dice, rolled: s.rolled, turnCrosses: s.turnCrosses,
    wins: Object.fromEntries(s.players.map((p) => [p.id, p.wins])),
  }));
}

function restore(s, pid, entry) {
  const snap = entry.snap;
  if (entry.full) {
    for (const k of ['variant', 'started', 'game', 'turn', 'dice', 'rolled', 'turnCrosses']) s[k] = snap[k];
    for (const p of s.players) s.sheets[p.id] = snap.sheets[p.id] || emptySheet(VARIANTS[s.variant]);
  } else {
    s.sheets[pid] = snap.sheets[pid] || emptySheet(VARIANTS[s.variant]);
    if (s.turn === pid) s.turnCrosses = snap.turnCrosses;
  }
  s.locks = snap.locks;
  s.removed = snap.removed;
  s.finished = snap.finished;
  for (const p of s.players) if (p.id in snap.wins) p.wins = snap.wins[p.id];
  if (s.turn && !s.players.some((p) => p.id === s.turn)) { s.turn = s.players[0]?.id || null; resetDice(s); }
}

const UNDOABLE = new Set(['cross', 'penalty', 'toggleDie', 'newGame', 'resetWins']);
const FULL = new Set(['newGame', 'resetWins']);

export function applyAction(s, deck, pid, a) {
  if (!s.undo || Array.isArray(s.undo)) s.undo = {};
  const me0 = s.players.find((p) => p.id === pid);

  if (a && a.type === 'undo') {
    if (!me0) throw fail('Unbekannter Spieler.');
    const last = (s.undo[pid] || []).pop();
    if (!last) throw fail('Du hast nichts zum Zurücknehmen.');
    restore(s, pid, last);
    log(s, `↶ ${me0.name} nimmt zurück: ${last.label}`);
    return { events: [{ kind: 'undo', name: me0.name, label: last.label }] };
  }

  const undoable = me0 && a && UNDOABLE.has(a.type);
  const snap = undoable ? snapshot(s) : null;
  const seqBefore = s.seq;
  const res = applyInner(s, deck, pid, a);
  if (undoable && s.seq !== seqBefore) {
    const entry = s.log.find((e) => e.n === seqBefore + 1) || s.log[s.log.length - 1];
    const item = { snap, label: entry.text, full: FULL.has(a.type) };
    if (a.type === 'newGame') s.undo = { [pid]: [item] };
    else {
      const st = (s.undo[pid] = s.undo[pid] || []);
      st.push(item);
      if (st.length > UNDO_MAX) st.splice(0, st.length - UNDO_MAX);
    }
  } else if (a && (a.type === 'kick' || a.type === 'start')) {
    s.undo = {};
  }
  return res;
}

function applyInner(s, deck, pid, a) {
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw fail('Unbekannter Spieler.');
  const N = me.name;
  const V = VARIANTS[s.variant];
  const events = [];
  const needHost = () => { if (!me.host) throw fail('Das darf nur der Host.'); };
  const needRunning = () => {
    if (!s.started) throw fail('Das Spiel hat noch nicht begonnen.');
    if (s.finished) throw fail('Das Spiel ist vorbei – starte ein neues.');
  };
  // Wer gerade würfelt. Der Host darf für Spieler einspringen, die offline sind.
  const needTurn = () => {
    needRunning();
    const t = s.players.find((p) => p.id === s.turn);
    if (!t) throw fail('Gerade ist niemand dran.');
    if (t.id !== pid && !(me.host && !t.connected)) throw fail(`${t.name} ist mit Würfeln dran.`);
    return t;
  };

  switch (a && a.type) {
    case 'start': {
      needHost();
      if (!s.started) {
        s.started = true;
        s.turn = s.players[0].id;
        resetDice(s);
        log(s, `Spiel ${s.game} beginnt – ${s.players[0].name} würfelt zuerst`);
      }
      break;
    }

    case 'roll': {
      const t = needTurn();
      if (s.rolled) throw fail('Schon gewürfelt – beende erst den Zug.');
      const idx = [];
      s.dice.forEach((d, i) => {
        if (i >= 2 && s.removed[i - 2]) { d.v = null; return; }
        d.v = 1 + randInt(6);
        idx.push(i);
      });
      s.rolled = true;
      s.turnCrosses = 0;
      events.push({ kind: 'roll', idx });
      const w = s.dice[0].v + s.dice[1].v;
      const col = s.dice.slice(2).map((d, i) => (d.v === null ? null : `${COLORS[V.rows[i].color].name} ${d.v}`)).filter(Boolean).join(' · ');
      log(s, `${t.id === pid ? N : `${N} (für ${t.name})`} würfelt: Weiß ${s.dice[0].v} + ${s.dice[1].v} = ${w} · ${col}`);
      break;
    }

    case 'endTurn': {
      const t = needTurn();
      if (!s.rolled) throw fail('Erst würfeln!');
      const i = s.players.findIndex((p) => p.id === t.id);
      const next = s.players[(i + 1) % s.players.length];
      s.turn = next.id;
      resetDice(s);
      log(s, `${t.name} ist fertig – ${next.name} würfelt`);
      break;
    }

    case 'cross': {
      needRunning();
      const r = Number(a.row), i = Number(a.i);
      const row = V.rows[r];
      if (!row || !(i >= 0 && i < row.nums.length)) throw fail('Dieses Feld gibt es nicht.');
      const sh = s.sheets[pid];
      if (r in s.locks) throw fail(`Die ${COLORS[row.color].name.toLowerCase()}e Reihe ist schon geschlossen.`);
      const last = sh.rows[r].length ? Math.max(...sh.rows[r]) : -1;
      if (i <= last) throw fail('Man kreuzt nur von links nach rechts – dieses Feld ist schon vorbei.');
      const isLast = i === row.nums.length - 1;
      if (isLast && sh.rows[r].length < 5) throw fail('Das letzte Feld darfst du erst ab 5 Kreuzen in der Reihe ankreuzen.');
      sh.rows[r].push(i);
      if (s.turn === pid) s.turnCrosses++;
      const cname = COLORS[row.color].name;
      if (isLast) {
        sh.locked.push(r);
        s.locks[r] = pid;
        log(s, `🔒 ${N} kreuzt ${cname} ${row.nums[i]} an und schließt die ${cname.toLowerCase()}e Reihe!`);
        checkEnd(s, events);
      } else {
        log(s, `${N} kreuzt ${cname} ${row.nums[i]} an`);
      }
      break;
    }

    case 'penalty': {
      needRunning();
      const sh = s.sheets[pid];
      if (sh.pen >= 4) throw fail('Du hast schon 4 Fehlwürfe.');
      sh.pen++;
      if (s.turn === pid) s.turnCrosses++;
      log(s, `${N} nimmt einen Fehlwurf (${sh.pen}/4, −5)`);
      checkEnd(s, events);
      break;
    }

    case 'toggleDie': {
      needRunning();
      const r = Number(a.row);
      if (!V.rows[r]) throw fail('Diesen Würfel gibt es nicht.');
      s.removed[r] = !s.removed[r];
      const cname = COLORS[V.rows[r].color].name;
      log(s, s.removed[r] ? `${N} nimmt den ${cname.toLowerCase()}en Würfel raus` : `${N} legt den ${cname.toLowerCase()}en Würfel zurück ins Spiel`);
      break;
    }

    case 'newGame': {
      if (a.variant && VARIANTS[a.variant]) s.variant = a.variant;
      const NV = VARIANTS[s.variant];
      s.game++;
      s.started = true;
      s.finished = false;
      s.locks = {};
      s.removed = NV.rows.map(() => false);
      for (const p of s.players) s.sheets[p.id] = emptySheet(NV);
      const starter = s.players[(s.game - 1) % s.players.length];
      s.turn = starter.id;
      resetDice(s);
      log(s, `${N} startet Spiel ${s.game} – ${starter.name} würfelt zuerst`);
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
      const t = s.players.find((x) => x.id === a.pid);
      if (!t) throw fail('Diesen Spieler gibt es nicht.');
      if (t.id === pid) throw fail('Du kannst dich nicht selbst entfernen.');
      const i = s.players.indexOf(t);
      const wasTurn = s.turn === t.id;
      s.players.splice(i, 1);
      delete s.sheets[t.id];
      for (const [r, owner] of Object.entries(s.locks)) if (owner === t.id) delete s.locks[r];
      events.push({ kind: 'kicked', pid: t.id });
      log(s, `${N} entfernt ${t.name} aus dem Raum`);
      if (wasTurn && s.started) { s.turn = s.players[i % s.players.length].id; resetDice(s); }
      break;
    }

    default:
      throw fail('Unbekannte Aktion.');
  }
  return { events };
}

export function viewFor(s, deck, pid) {
  const mine = s.undo && !Array.isArray(s.undo) ? s.undo[pid] || [] : [];
  return {
    me: pid,
    kind: 'cross',
    deckId: s.deckId,
    variant: s.variant,
    started: s.started,
    finished: s.finished,
    game: s.game,
    turn: s.turn,
    dice: s.dice,
    rolled: s.rolled,
    turnCrosses: s.turnCrosses,
    locks: s.locks,
    removed: s.removed,
    players: s.players.map((p) => ({ id: p.id, name: p.name, host: p.host, color: p.color, connected: p.connected, wins: p.wins })),
    sheets: s.sheets,
    log: s.log.slice(-50),
    undo: mine.length ? mine[mine.length - 1].label : null,
  };
}
