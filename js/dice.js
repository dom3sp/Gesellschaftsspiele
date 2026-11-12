// Würfelspiel (Classic & 7) – Spielzustand, läuft nur beim Host.
// Gleiche Schnittstelle wie game.js: createState, addPlayer, setConnected, applyAction, viewFor.

import { rid } from './game.js';

const MAX_LOG = 80;
const UNDO_MAX = 30;
const SEAT_COLORS = ['#f08c00', '#4dabf7', '#69db7c', '#da77f2', '#ff8787', '#ffd43b'];

const randInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const fail = (msg) => new Error(msg);

// ---------------------------------------------------------------------------
// Wertung
// ---------------------------------------------------------------------------
const sum = (d) => d.reduce((a, b) => a + b, 0);
function counts(d) {
  const c = {};
  for (const v of d) c[v] = (c[v] || 0) + 1;
  return c;
}
const maxKind = (d) => Math.max(0, ...Object.values(counts(d)));
// Wie viele Gruppen von k gleichen Würfeln gibt es? (z. B. Paare: k = 2)
const groups = (d, k) => Object.values(counts(d)).reduce((n, c) => n + Math.floor(c / k), 0);
// a gleiche Würfel plus b gleiche Würfel einer ANDEREN Zahl (z. B. Full House: 3 + 2)
function combo(d, a, b) {
  const c = Object.entries(counts(d));
  return c.some(([x, n]) => n >= a && c.some(([y, m]) => y !== x && m >= b));
}
// Längste Straße (aufeinanderfolgende Zahlen)
function run(d) {
  const s = new Set(d);
  let best = 0, cur = 0;
  for (let v = 0; v <= 10; v++) { cur = s.has(v) ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

const NUM_NAMES = ['Einser', 'Zweier', 'Dreier', 'Vierer', 'Fünfer', 'Sechser'];
const CATS = {};
NUM_NAMES.forEach((name, i) => {
  const n = i + 1;
  CATS[`n${n}`] = { name, hint: `nur ${name} zählen`, upper: true, score: (d) => d.filter((v) => v === n).length * n };
});
Object.assign(CATS, {
  dreier: { name: 'Dreierpasch', hint: 'alle Augen zählen', score: (d) => (maxKind(d) >= 3 ? sum(d) : 0) },
  vierer: { name: 'Viererpasch', hint: 'alle Augen zählen', score: (d) => (maxKind(d) >= 4 ? sum(d) : 0) },
  zweiPaare: { name: 'Zwei Paare', hint: 'alle Augen zählen', score: (d) => (groups(d, 2) >= 2 ? sum(d) : 0) },
  dreiPaare: { name: 'Drei Paare', hint: '35 Punkte', score: (d) => (groups(d, 2) >= 3 ? 35 : 0) },
  zweiDreier: { name: 'Zwei Dreier', hint: '45 Punkte', score: (d) => (groups(d, 3) >= 2 ? 45 : 0) },
  fullHouse: { name: 'Full House', hint: '3 + 2 gleiche · 25 Punkte', score: (d) => (combo(d, 3, 2) ? 25 : 0) },
  grFullHouse: { name: 'Großes Full House', hint: '4 + 2 gleiche · 45 Punkte', score: (d) => (combo(d, 4, 2) ? 45 : 0) },
  klStrasse: { name: 'Kleine Straße', hint: '4 in Folge · 30 Punkte', score: (d) => (run(d) >= 4 ? 30 : 0) },
  grStrasse: { name: 'Große Straße', hint: '5 in Folge · 40 Punkte', score: (d) => (run(d) >= 5 ? 40 : 0) },
  highway: { name: 'Highway', hint: '6 in Folge · 50 Punkte', score: (d) => (run(d) >= 6 ? 50 : 0) },
  fuenf: { name: 'Fünf Gleiche', hint: '50 Punkte', score: (d) => (maxKind(d) >= 5 ? 50 : 0) },
  sechs: { name: 'Sechs Gleiche', hint: '75 Punkte', score: (d) => (maxKind(d) >= 6 ? 75 : 0) },
  max10: { name: '10 oder weniger', hint: 'Augensumme · 40 Punkte', score: (d) => (sum(d) <= 10 ? 40 : 0) },
  min33: { name: '33 oder mehr', hint: 'Augensumme · 40 Punkte', score: (d) => (sum(d) >= 33 ? 40 : 0) },
  chance: { name: 'Chance', hint: 'alle Augen zählen', score: sum },
  superChance: { name: 'Super-Chance', hint: 'alle Augen × 2', score: (d) => sum(d) * 2 },
});

const UPPER = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];

export const VARIANTS = {
  classic: {
    id: 'classic', name: 'Classic', short: '5 Würfel · 13 Felder',
    dice: [6, 6, 6, 6, 6], tokens: 0, bonusAt: 63, bonus: 35,
    lower: ['dreier', 'vierer', 'fullHouse', 'klStrasse', 'grStrasse', 'fuenf', 'chance'],
    rules: [
      'Reihum ist jeder einmal dran. Pro Zug darfst du bis zu 3-mal würfeln.',
      'Tippe Würfel an, um sie zu behalten – beim nächsten Wurf rollen nur die anderen.',
      'Danach trägst du das Ergebnis in ein freies Feld deiner Spalte ein (antippen). Passt nichts, streichst du ein Feld mit 0.',
      'Oben zählen nur die passenden Augen. Ab 63 Punkten oben gibt es 35 Bonuspunkte.',
      'Dreier-/Viererpasch und Chance: alle Augen zählen. Full House 25, Kleine Straße (4 in Folge) 30, Große Straße (5 in Folge) 40, Fünf Gleiche 50.',
      'Wenn alle Felder voll sind, gewinnt die höchste Endsumme.',
    ],
  },
  sieben: {
    id: 'sieben', name: '7', short: '6 Würfel (einer 0–9) · 3 Tokens · 22 Felder',
    dice: [6, 6, 6, 6, 6, 10], tokens: 3, bonusAt: 73, bonus: 45,
    lower: ['dreier', 'vierer', 'zweiPaare', 'dreiPaare', 'zweiDreier', 'fullHouse', 'grFullHouse', 'klStrasse', 'grStrasse', 'highway', 'fuenf', 'sechs', 'max10', 'min33', 'chance', 'superChance'],
    rules: [
      'Wie Classic, aber mit 6 Würfeln: 5 normale und ein roter Würfel mit den Zahlen 0 bis 9.',
      'Pro Zug darfst du bis zu 3-mal würfeln. Zusätzlich hat jeder 3 Tokens pro Spiel – jeder Token ist ein weiterer Wurf.',
      'Oben zählen nur die passenden Augen. Ab 73 Punkten oben gibt es 45 Bonuspunkte.',
      'Unten: Paare, Dreier, Full House (3+2), Großes Full House (4+2), Straßen mit 4, 5 oder 6 Zahlen in Folge (Highway), Fünf und Sechs Gleiche, Augensumme 10 oder weniger bzw. 33 oder mehr, Chance und Super-Chance (doppelt).',
      'Passt nichts, streichst du ein Feld mit 0. Wenn alle Felder voll sind, gewinnt die höchste Endsumme.',
    ],
  },
};

export function categories(variant) {
  const V = VARIANTS[variant] || VARIANTS.classic;
  return [...UPPER, ...V.lower].map((id) => ({ id, name: CATS[id].name, hint: CATS[id].hint, upper: !!CATS[id].upper }));
}

export function scoreOf(variant, cat, dice) {
  const vals = dice.map((x) => (typeof x === 'number' ? x : x.v));
  if (vals.some((v) => v === null || v === undefined)) return 0;
  return CATS[cat].score(vals);
}

export function totals(variant, sheet = {}) {
  const V = VARIANTS[variant] || VARIANTS.classic;
  const val = (id) => (typeof sheet[id] === 'number' ? sheet[id] : 0);
  const upper = UPPER.reduce((n, id) => n + val(id), 0);
  const bonus = upper >= V.bonusAt ? V.bonus : 0;
  const lower = V.lower.reduce((n, id) => n + val(id), 0);
  return { upper, bonus, upperTotal: upper + bonus, lower, total: upper + bonus + lower };
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
function log(s, text) {
  s.log.push({ n: ++s.seq, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

function resetDice(s) {
  s.dice = VARIANTS[s.variant].dice.map((sides) => ({ sides, v: null, held: false }));
  s.rollsLeft = 3;
  s.rolled = 0;
}

export function createState(deck, deckId, variant) {
  const s = {
    kind: 'dice', deckId, variant: VARIANTS[variant] ? variant : 'classic',
    started: false, finished: false, game: 1, seq: 0,
    players: [], sheets: {}, tokens: {}, turn: null, log: [], undo: [],
  };
  resetDice(s);
  return s;
}

export function addPlayer(s, deck, name, token, isHost = false) {
  name = String(name || '').trim().slice(0, 20) || 'Spieler';
  if (token) {
    const ex = s.players.find((p) => p.token === token);
    if (ex) {
      ex.connected = true;
      log(s, `${ex.name} ist wieder da`);
      return ex;
    }
  }
  if (s.players.length >= deck.maxPlayers) return null;
  const used = new Set(s.players.map((p) => p.color));
  const p = {
    id: rid(6), name, token: token || null, host: isHost, connected: true, wins: 0,
    color: SEAT_COLORS.find((c) => !used.has(c)) || SEAT_COLORS[0],
  };
  s.players.push(p);
  s.sheets[p.id] = {};
  s.tokens[p.id] = VARIANTS[s.variant].tokens;
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

const hasOpen = (s, pid) => categories(s.variant).some((c) => typeof s.sheets[pid]?.[c.id] !== 'number');

// Nächster Spieler mit freien Feldern – sonst ist das Spiel vorbei.
function nextTurn(s, events) {
  const n = s.players.length;
  const i = s.players.findIndex((p) => p.id === s.turn);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(i + k + n) % n];
    if (hasOpen(s, p.id)) { s.turn = p.id; resetDice(s); return; }
  }
  // Alle fertig
  s.turn = null;
  s.finished = true;
  resetDice(s);
  const res = s.players.map((p) => ({ p, total: totals(s.variant, s.sheets[p.id]).total }));
  if (!res.length) return;
  const best = Math.max(...res.map((r) => r.total));
  const winners = res.filter((r) => r.total === best).map((r) => r.p);
  for (const w of winners) w.wins++;
  const names = winners.map((w) => w.name).join(' & ');
  events.push({ kind: 'win', name: names, color: winners[0].color });
  log(s, `🏆 Spiel ${s.game} ist vorbei – ${names} ${winners.length > 1 ? 'gewinnen' : 'gewinnt'} mit ${best} Punkten`);
}

function snapshot(s) {
  return JSON.parse(JSON.stringify({
    variant: s.variant, started: s.started, finished: s.finished, game: s.game,
    sheets: s.sheets, tokens: s.tokens, turn: s.turn, dice: s.dice, rollsLeft: s.rollsLeft, rolled: s.rolled,
    wins: Object.fromEntries(s.players.map((p) => [p.id, p.wins])),
  }));
}

function restore(s, snap) {
  for (const k of ['variant', 'started', 'finished', 'game', 'turn', 'dice', 'rollsLeft', 'rolled']) s[k] = snap[k];
  const sheets = {}, tokens = {};
  for (const p of s.players) {
    sheets[p.id] = snap.sheets[p.id] || {};
    tokens[p.id] = p.id in snap.tokens ? snap.tokens[p.id] : VARIANTS[s.variant].tokens;
    if (p.id in snap.wins) p.wins = snap.wins[p.id];
  }
  s.sheets = sheets;
  s.tokens = tokens;
  if (s.turn && !s.players.some((p) => p.id === s.turn)) { s.turn = s.players[0]?.id || null; resetDice(s); }
}

const UNDOABLE = new Set(['score', 'newGame', 'resetWins']);

export function applyAction(s, deck, pid, a) {
  if (!Array.isArray(s.undo)) s.undo = [];
  const me0 = s.players.find((p) => p.id === pid);

  if (a && a.type === 'undo') {
    if (!me0) throw fail('Unbekannter Spieler.');
    const last = s.undo.pop();
    if (!last) throw fail('Es gibt nichts zum Zurücknehmen.');
    restore(s, last.snap);
    log(s, `↶ ${me0.name} nimmt zurück: ${last.label}`);
    return { events: [{ kind: 'undo', name: me0.name, label: last.label }] };
  }

  const undoable = me0 && a && UNDOABLE.has(a.type);
  const snap = undoable ? snapshot(s) : null;
  const seqBefore = s.seq;
  const res = applyInner(s, deck, pid, a);
  if (undoable && s.seq !== seqBefore) {
    const entry = s.log.find((e) => e.n === seqBefore + 1) || s.log[s.log.length - 1];
    s.undo.push({ snap, label: entry.text });
    if (s.undo.length > UNDO_MAX) s.undo.splice(0, s.undo.length - UNDO_MAX);
  } else if (a && (a.type === 'kick' || a.type === 'start')) {
    s.undo = [];
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
  // Wer gerade dran ist. Der Host darf für Spieler einspringen, die offline sind.
  const needTurn = () => {
    if (!s.started) throw fail('Das Spiel hat noch nicht begonnen.');
    if (s.finished) throw fail('Das Spiel ist vorbei – starte ein neues.');
    const t = s.players.find((p) => p.id === s.turn);
    if (!t) throw fail('Gerade ist niemand dran.');
    if (t.id !== pid && !(me.host && !t.connected)) throw fail(`Du bist nicht dran – gerade ist ${t.name} dran.`);
    return t;
  };
  const who = (t) => (t.id === pid ? N : `${N} (für ${t.name})`);

  switch (a && a.type) {
    case 'start': {
      needHost();
      if (!s.started) {
        s.started = true;
        s.turn = s.players[0].id;
        resetDice(s);
        log(s, `Spiel ${s.game} (${V.name}) beginnt – ${s.players[0].name} fängt an`);
      }
      break;
    }

    case 'roll': {
      const t = needTurn();
      if (s.rolled > 0 && s.dice.every((d) => d.held)) throw fail('Du behältst alle Würfel – tippe mindestens einen an, um ihn freizugeben.');
      let viaToken = false;
      if (s.rollsLeft > 0) s.rollsLeft--;
      else if (a.token && V.tokens) {
        if ((s.tokens[t.id] || 0) <= 0) throw fail('Keine Tokens mehr übrig.');
        s.tokens[t.id]--;
        viaToken = true;
      } else {
        throw fail(V.tokens && s.tokens[t.id] > 0 ? 'Keine Würfe mehr – löse einen Token ein oder trage etwas ein.' : 'Keine Würfe mehr – trage dein Ergebnis ein.');
      }
      const first = s.rolled === 0;
      const idx = [];
      s.dice.forEach((d, i) => {
        if (first) d.held = false;
        if (d.held) return;
        d.v = d.sides === 10 ? randInt(10) : 1 + randInt(6);
        idx.push(i);
      });
      s.rolled++;
      events.push({ kind: 'roll', idx });
      const str = s.dice.map((d) => (d.sides === 10 ? `[${d.v}]` : d.v)).join(' · ');
      log(s, `${who(t)} ${viaToken ? `löst einen Token ein (noch ${s.tokens[t.id]}) und würfelt` : `würfelt (${s.rolled}. Wurf)`}: ${str}`);
      break;
    }

    case 'hold': {
      needTurn();
      if (!s.rolled) throw fail('Erst würfeln!');
      const d = s.dice[Number(a.i)];
      if (!d) throw fail('Diesen Würfel gibt es nicht.');
      d.held = !d.held;
      break;
    }

    case 'score': {
      const t = needTurn();
      if (!s.rolled) throw fail('Erst würfeln!');
      if (!categories(s.variant).some((c) => c.id === a.cat)) throw fail('Dieses Feld gibt es nicht.');
      const sheet = s.sheets[t.id];
      if (typeof sheet[a.cat] === 'number') throw fail('Dieses Feld ist schon ausgefüllt.');
      const val = scoreOf(s.variant, a.cat, s.dice);
      sheet[a.cat] = val;
      log(s, `${who(t)} ${val ? `trägt ${val} bei „${CATS[a.cat].name}“ ein` : `streicht „${CATS[a.cat].name}“ (0)`}`);
      nextTurn(s, events);
      break;
    }

    case 'newGame': {
      if (a.variant && VARIANTS[a.variant]) s.variant = a.variant;
      const NV = VARIANTS[s.variant];
      s.game++;
      s.started = true;
      s.finished = false;
      for (const p of s.players) { s.sheets[p.id] = {}; s.tokens[p.id] = NV.tokens; }
      const starter = s.players[(s.game - 1) % s.players.length];
      s.turn = starter.id;
      resetDice(s);
      log(s, `${N} startet Spiel ${s.game} (${NV.name}) – ${starter.name} fängt an`);
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
      const wasTurn = s.turn === t.id;
      const i = s.players.indexOf(t);
      s.players.splice(i, 1);
      delete s.sheets[t.id];
      delete s.tokens[t.id];
      events.push({ kind: 'kicked', pid: t.id });
      log(s, `${N} entfernt ${t.name} aus dem Raum`);
      if (wasTurn && s.started && !s.finished) {
        // Den Spieler vor dem Entfernten als "aktuell" nehmen, damit es reihum weitergeht.
        s.turn = s.players[(i - 1 + s.players.length) % s.players.length].id;
        nextTurn(s, events);
      }
      break;
    }

    default:
      throw fail('Unbekannte Aktion.');
  }
  return { events };
}

export function viewFor(s, deck, pid) {
  return {
    me: pid,
    kind: 'dice',
    deckId: s.deckId,
    variant: s.variant,
    started: s.started,
    finished: s.finished,
    game: s.game,
    turn: s.turn,
    dice: s.dice,
    rollsLeft: s.rollsLeft,
    rolled: s.rolled,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, host: p.host, color: p.color, connected: p.connected, wins: p.wins,
      tokens: s.tokens[p.id] || 0,
    })),
    sheets: s.sheets,
    log: s.log.slice(-50),
    undo: s.undo && s.undo.length ? s.undo[s.undo.length - 1].label : null,
  };
}
