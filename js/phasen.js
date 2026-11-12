// Phasen-Brettspiel ("Phasenlauf") – Spielzustand, läuft nur beim Host.
// Gleiche Schnittstelle wie die anderen Spiele: createState, addPlayer, setConnected, applyAction, viewFor.

import { rid } from './game.js';

const MAX_LOG = 100;
const UNDO_MAX = 40;
const fail = (msg) => new Error(msg);
const randInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Spielsteine: Rot, Blau, Gelb, Grün, Weiß, Schwarz
export const PIECE_COLORS = ['#e03131', '#1c7ed6', '#fcc419', '#2f9e44', '#f1f3f5', '#343a40'];
export const CARD_COLORS = { r: 'Rot', b: 'Blau', y: 'Gelb', g: 'Grün' };
export const GOAL = 11; // Phase 11 = Lorbeerkranz

// ---------- Brett: 32 Felder im Uhrzeigersinn, Feld 0 = Start ----------
export const FIELD_TYPES = {
  g1: { name: '+1 Karte', group: 'g', color: '#8c96a0', help: 'Nimm 1 Karte vom Aufnahme- oder Ablagestapel.' },
  g2: { name: '+2 Karten', group: 'g', color: '#8c96a0', help: 'Nimm 2 Karten – jede einzeln vom Aufnahme- oder Ablagestapel.' },
  g3: { name: '+3 Karten', group: 'g', color: '#8c96a0', help: 'Nimm 3 Karten – jede einzeln vom Aufnahme- oder Ablagestapel.' },
  b: { name: 'Joker', group: 'b', color: '#33b5e5', help: 'Die oberste Karte vom Aufnahmestapel kommt umgedreht als Joker auf deine Hand. Du siehst nur die Rückseite – die anderen sehen die Vorderseite.' },
  p: { name: '+1 & Extra-Zug', group: 'p', color: '#ee6aa7', help: 'Nimm 1 Karte, spiele deinen Zug zu Ende und mach danach einen kompletten weiteren Zug.' },
  gr: { name: 'Ablage durchsuchen', group: 'gr', color: '#8cc63f', help: 'Such dir eine beliebige Karte aus dem ganzen Ablagestapel aus.' },
  m: { name: 'Tauschen', group: 'm', color: '#c2187a', help: 'Wirf 1–4 Karten ab und nimm eine Karte mehr vom Aufnahmestapel.' },
  l: { name: 'Alle +1', group: 'l', color: '#b39ddb', help: 'Du nimmst 1 Karte vom Aufnahmestapel, danach auch jeder Mitspieler.' },
  o: { name: 'Fragen', group: 'o', color: '#f08c00', help: 'Frag deine Mitspieler (links- oder rechtsherum) nach einer Zahl. Wer sie zuerst hat, muss sie dir geben und bekommt Ersatz vom Aufnahmestapel.' },
  r: { name: 'Freie Wahl', group: 'r', color: '#3b82d6', help: 'Zieh auf das nächste freie Feld einer Aktion deiner Wahl und führe sie aus.' },
};
export const BOARD = ['r', 'g1', 'b', 'p', 'g2', 'l', 'gr', 'g1', 'o', 'm', 'g3', 'b', 'p', 'g1', 'gr', 'l', 'g2', 'm', 'b', 'g1', 'p', 'o', 'g2', 'gr', 'l', 'g3', 'm', 'b', 'g1', 'p', 'g2', 'g1'];
export const RAINBOW_CHOICES = ['g', 'b', 'p', 'gr', 'm', 'l', 'o'];
export const GROUP_NAMES = { g: 'Karten nehmen (+1/+2/+3)', b: 'Joker', p: '+1 & Extra-Zug', gr: 'Ablage durchsuchen', m: 'Tauschen', l: 'Alle +1', o: 'Fragen' };

// ---------- Die 10 Phasen ----------
export const PHASES = [
  null,
  { text: '5 Karten einer Farbe + 1 Dreierfolge', groups: [{ k: 'color', n: 5 }, { k: 'run', n: 3 }] },
  { text: '4 Zwillinge', groups: [{ k: 'set', n: 2 }, { k: 'set', n: 2 }, { k: 'set', n: 2 }, { k: 'set', n: 2 }] },
  { text: '1 Drilling + 1 Viererfolge', groups: [{ k: 'set', n: 3 }, { k: 'run', n: 4 }] },
  { text: '2 Viererfolgen', groups: [{ k: 'run', n: 4 }, { k: 'run', n: 4 }] },
  { text: '6 Karten einer Farbe + 1 Drilling', groups: [{ k: 'color', n: 6 }, { k: 'set', n: 3 }] },
  { text: '1 Achterfolge', groups: [{ k: 'run', n: 8 }] },
  { text: '1 Zwilling + 1 Drilling + 1 Vierling', groups: [{ k: 'set', n: 2 }, { k: 'set', n: 3 }, { k: 'set', n: 4 }] },
  { text: '2 Vierlinge', groups: [{ k: 'set', n: 4 }, { k: 'set', n: 4 }] },
  { text: '1 Neunerfolge', groups: [{ k: 'run', n: 9 }] },
  { text: '1 Fünfling + 1 Drilling', groups: [{ k: 'set', n: 5 }, { k: 'set', n: 3 }] },
];
const SET_NAMES = { 2: 'Zwilling', 3: 'Drilling', 4: 'Vierling', 5: 'Fünfling' };
export function groupLabel(g) {
  if (g.k === 'set') return SET_NAMES[g.n] || `${g.n} gleiche`;
  if (g.k === 'run') return `${g.n}er-Folge`;
  return `${g.n} einer Farbe`;
}

export const RULES = [
  'Jeder spielt reihum einen Zug aus drei Schritten: 1) würfeln, Stein ziehen, Aktion ausführen – 2) (kann) Phase auslegen und anlegen – 3) eine Karte abwerfen.',
  'Würfeln: einen der beiden Würfel wählen und so weit ziehen. Bei einem Pasch: einfacher oder doppelter Wert. Besetzte Felder werden übersprungen und nicht mitgezählt.',
  'Phasen müssen komplett ausgelegt werden. Danach darf man (auch im selben Zug) passende Karten an alle ausliegenden Phasen anlegen – aber keine neuen Kombinationen bilden.',
  'Folge = Zahlen direkt hintereinander (12 und 1 hängen nicht zusammen). Set = gleiche Zahlen. Farbe = Karten derselben Farbe.',
  'Joker gelten als jede Zahl/Farbe. In jeder Kombination muss mindestens eine echte Karte liegen. Ausgelegte Joker dürfen nicht ausgetauscht werden.',
  'Wer seine letzte Karte los ist, beendet den Durchgang: Er zieht seinen Phasenanzeiger 2 Felder vor, alle anderen mit ausgelegter Phase 1 Feld.',
  'Wer seine Phase nicht geschafft hat, bleibt stehen und darf bis zu 5 Karten behalten. Minuspunkte gibt es keine.',
  'Wer zuerst mit seinem Phasenanzeiger den Lorbeerkranz erreicht, gewinnt sofort.',
];

// ---------------------------------------------------------------------------
// Kombinationen prüfen
// ---------------------------------------------------------------------------
// cards: [{ id, n, c, j }]  (j = Joker)
export function buildGroup(g, cards) {
  const reals = cards.filter((x) => !x.j);
  const jokers = cards.filter((x) => x.j);
  const label = groupLabel(g);
  if (cards.length < g.n) return { error: `${label}: mindestens ${g.n} Karten nötig (gerade ${cards.length}).` };
  if (!reals.length) return { error: `${label}: mindestens eine echte Karte, nicht nur Joker.` };
  if (g.k === 'set') {
    const v = reals[0].n;
    if (reals.some((x) => x.n !== v)) return { error: `${label}: alle Karten brauchen dieselbe Zahl.` };
    return { meld: { kind: 'set', val: v, cards: cards.map((x) => ({ id: x.id, v, j: !!x.j })) } };
  }
  if (g.k === 'color') {
    const col = reals[0].c;
    if (reals.some((x) => x.c !== col)) return { error: `${label}: alle Karten brauchen dieselbe Farbe.` };
    return { meld: { kind: 'color', col, cards: cards.map((x) => ({ id: x.id, col, j: !!x.j })) } };
  }
  // Folge
  const nums = reals.map((x) => x.n).sort((a, b) => a - b);
  if (new Set(nums).size !== nums.length) return { error: `${label}: in einer Folge darf jede Zahl nur einmal vorkommen.` };
  if (cards.length > 12) return { error: `${label}: eine Folge hat höchstens 12 Karten.` };
  let lo = nums[0], hi = nums[nums.length - 1];
  const gaps = hi - lo + 1 - nums.length;
  if (jokers.length < gaps) return { error: `${label}: die Zahlen hängen nicht zusammen (es fehlen ${gaps - jokers.length}).` };
  let extra = jokers.length - gaps;
  while (extra > 0 && hi < 12) { hi++; extra--; }
  while (extra > 0 && lo > 1) { lo--; extra--; }
  const free = [];
  const realSet = new Set(nums);
  for (let v = lo; v <= hi; v++) if (!realSet.has(v)) free.push(v);
  const out = [];
  let ji = 0;
  for (let v = lo; v <= hi; v++) {
    if (realSet.has(v)) { const r = reals.find((x) => x.n === v); out.push({ id: r.id, v, j: false }); }
    else out.push({ id: jokers[ji++].id, v, j: true });
  }
  return { meld: { kind: 'run', lo, hi, cards: out } };
}

// Passt Karte x an die Kombination?  → { v, end } oder { error }
export function fitCard(meld, x) {
  if (meld.kind === 'set') {
    if (x.j || x.n === meld.val) return { v: meld.val };
    return { error: `Hier passen nur ${meld.val}er (oder Joker).` };
  }
  if (meld.kind === 'color') {
    if (x.j || x.c === meld.col) return { col: meld.col };
    return { error: `Hier passen nur ${CARD_COLORS[meld.col]}e Karten (oder Joker).` };
  }
  if (x.j) {
    if (meld.hi < 12) return { v: meld.hi + 1, end: 'hi' };
    if (meld.lo > 1) return { v: meld.lo - 1, end: 'lo' };
    return { v: null, end: 'hi' }; // Folge ist voll – Joker dürfen trotzdem angelegt werden
  }
  if (x.n === meld.hi + 1) return { v: x.n, end: 'hi' };
  if (x.n === meld.lo - 1) return { v: x.n, end: 'lo' };
  if (meld.lo === 1 && meld.hi === 12) return { error: 'Die Folge ist voll – hier passt nur noch ein Joker.' };
  const ok = [meld.lo > 1 ? meld.lo - 1 : null, meld.hi < 12 ? meld.hi + 1 : null].filter(Boolean);
  return { error: `An diese Folge passt nur eine ${ok.join(' oder eine ')} (oder ein Joker).` };
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
function log(s, text) {
  s.log.push({ n: ++s.seq, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}
const nameOf = (s, pid) => s.players.find((p) => p.id === pid)?.name || '?';
const cardTxt = (s, cid) => `${CARD_COLORS[s.cards[cid].c]} ${s.cards[cid].n}`;

export function createState(deck, deckId, variant) {
  const s = {
    kind: 'phasen', deckId, variant: 'classic', started: false, finished: false, game: 1, seq: 0, durchgang: 0,
    players: [], cards: {}, draw: [], discard: [], hands: {}, jok: {}, melds: [],
    pos: {}, phase: {}, laid: {}, turn: null, step: 'wait', dice: null, pending: null, extra: false,
    keepPending: [], nextStarter: null, log: [], undo: [],
  };
  void variant;
  for (const c of Object.keys(CARD_COLORS)) {
    for (let n = 1; n <= 12; n++) for (let k = 0; k < 2; k++) {
      let id; do id = rid(6); while (s.cards[id]);
      s.cards[id] = { n, c };
    }
  }
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
    color: PIECE_COLORS.find((c) => !used.has(c)) || PIECE_COLORS[0],
  };
  s.players.push(p);
  s.hands[p.id] = [];
  s.pos[p.id] = 0;
  s.phase[p.id] = 1;
  s.laid[p.id] = false;
  log(s, `${p.name} ${isHost ? 'hat den Raum erstellt' : 'ist beigetreten'}`);
  if (s.started && !s.finished) {
    for (let i = 0; i < 10; i++) { const c = drawTop(s); if (c) s.hands[p.id].push(c); }
    if (!s.turn) { s.turn = p.id; s.step = 'roll'; }
  }
  return p;
}

export function setConnected(s, pid, on) {
  const p = s.players.find((x) => x.id === pid);
  if (!p || p.connected === on) return;
  p.connected = on;
  log(s, `${p.name} ${on ? 'ist wieder da' : 'hat die Verbindung verloren'}`);
}

// Oberste Karte vom Aufnahmestapel (bei Bedarf Ablage neu mischen, oberste Ablagekarte bleibt liegen).
function drawTop(s) {
  if (!s.draw.length && s.discard.length > 1) {
    const top = s.discard.pop();
    s.draw = shuffle(s.discard.splice(0));
    s.discard = [top];
    log(s, 'Der Aufnahmestapel ist leer – die Ablage wird neu gemischt');
  }
  return s.draw.pop() || null;
}

function startRound(s, starter) {
  const kept = {};
  for (const p of s.players) kept[p.id] = s.laid[p.id] ? [] : (s.hands[p.id] || []).slice(0, 5);
  const keptIds = new Set(Object.values(kept).flat());
  const pool = shuffle(Object.keys(s.cards).filter((id) => !keptIds.has(id)));
  for (const id of Object.keys(s.jok)) if (!keptIds.has(id)) delete s.jok[id];
  for (const p of s.players) { s.hands[p.id] = kept[p.id]; s.laid[p.id] = false; }
  let more = true;
  while (more) {
    more = false;
    for (const p of s.players) if (s.hands[p.id].length < 10 && pool.length) { s.hands[p.id].push(pool.pop()); more = true; }
  }
  s.discard = pool.splice(pool.length - 5, 5);
  s.draw = pool;
  s.melds = [];
  s.durchgang++;
  s.turn = starter;
  s.step = 'roll';
  s.dice = null;
  s.pending = null;
  s.extra = false;
  s.keepPending = [];
  log(s, `Durchgang ${s.durchgang} beginnt – ${nameOf(s, starter)} fängt an`);
}

function nextTurn(s) {
  const i = s.players.findIndex((p) => p.id === s.turn);
  s.turn = s.players[(i + 1) % s.players.length].id;
  s.step = 'roll';
  s.dice = null;
  s.pending = null;
  s.extra = false;
}

const occupied = (s, field, except) => field !== 0 && s.players.some((p) => p.id !== except && s.pos[p.id] === field);

// Stein um "steps" Felder bewegen (besetzte Felder zählen nicht).
function movePiece(s, pid, steps, events) {
  let pos = s.pos[pid];
  const path = [];
  let guard = 0;
  while (steps > 0 && guard++ < 200) {
    pos = (pos + 1) % BOARD.length;
    path.push(pos);
    if (!occupied(s, pos, pid)) steps--;
  }
  s.pos[pid] = pos;
  events.push({ kind: 'move', pid, path });
  return pos;
}

// Aktion des Feldes starten
function landOn(s, pid, events) {
  const type = BOARD[s.pos[pid]];
  const N = nameOf(s, pid);
  const ft = FIELD_TYPES[type];
  s.step = 'action';
  switch (type) {
    case 'g1': case 'g2': case 'g3':
      s.pending = { type: 'take', left: Number(type[1]), total: Number(type[1]) };
      log(s, `${N} landet auf „${ft.name}“`);
      break;
    case 'p':
      s.pending = { type: 'take', left: 1, total: 1 };
      s.extra = true;
      log(s, `${N} landet auf „${ft.name}“ – nach diesem Zug kommt ein Extra-Zug`);
      break;
    case 'b': {
      const c = drawTop(s);
      if (c) { s.hands[pid].push(c); s.jok[c] = true; }
      log(s, `${N} bekommt einen Joker (umgedreht – die Vorderseite sehen nur die anderen)`);
      s.step = 'play';
      s.pending = null;
      break;
    }
    case 'gr':
      if (!s.discard.length) { log(s, `${N} landet auf „${ft.name}“, aber die Ablage ist leer`); s.step = 'play'; s.pending = null; }
      else { s.pending = { type: 'green' }; log(s, `${N} darf den Ablagestapel durchsuchen`); }
      break;
    case 'm':
      s.pending = { type: 'magenta' };
      log(s, `${N} landet auf „${ft.name}“`);
      break;
    case 'l': {
      const c = drawTop(s);
      if (c) s.hands[pid].push(c);
      const i = s.players.findIndex((p) => p.id === pid);
      for (let k = 1; k < s.players.length; k++) {
        const o = s.players[(i + k) % s.players.length];
        const d = drawTop(s);
        if (d) s.hands[o.id].push(d);
      }
      log(s, `${N} landet auf „${ft.name}“ – alle nehmen eine Karte`);
      s.step = 'play';
      s.pending = null;
      break;
    }
    case 'o':
      s.pending = { type: 'orange' };
      log(s, `${N} landet auf „${ft.name}“`);
      break;
    case 'r':
      s.pending = { type: 'rainbow' };
      log(s, `${N} landet auf „${ft.name}“`);
      break;
  }
  void events;
}

function endRound(s, ender, events) {
  log(s, `🎉 ${nameOf(s, ender)} ist alle Karten los – Durchgang ${s.durchgang} ist vorbei`);
  const i0 = s.players.findIndex((p) => p.id === ender);
  const order = s.players.map((_, k) => s.players[(i0 + k) % s.players.length]);
  const steps = [];
  for (const p of order) {
    if (!s.laid[p.id]) continue;
    const by = p.id === ender ? 2 : 1;
    s.phase[p.id] = Math.min(GOAL, s.phase[p.id] + by);
    steps.push(`${p.name} +${by}`);
    if (s.phase[p.id] >= GOAL) {
      s.finished = true;
      p.wins++;
      s.turn = null;
      s.step = 'over';
      s.pending = null;
      events.push({ kind: 'win', name: p.name, color: p.color });
      log(s, `🏆 ${p.name} erreicht den Lorbeerkranz und gewinnt!`);
      return;
    }
  }
  if (steps.length) log(s, `Phasen weiter: ${steps.join(', ')}`);
  const stay = order.filter((p) => !s.laid[p.id]).map((p) => p.name);
  if (stay.length) log(s, `Bleiben stehen (dürfen bis zu 5 Karten behalten): ${stay.join(', ')}`);
  for (const p of s.players) if (s.laid[p.id]) s.hands[p.id] = [];
  s.nextStarter = order[1 % order.length].id;
  s.keepPending = s.players.filter((p) => !s.laid[p.id] && s.hands[p.id].length > 5).map((p) => p.id);
  s.turn = null;
  s.pending = null;
  s.dice = null;
  if (s.keepPending.length) { s.step = 'keep'; events.push({ kind: 'roundEnd' }); }
  else startRound(s, s.nextStarter);
}

// Nach Auslegen/Anlegen/Abwerfen: Hand leer → Durchgang vorbei.
function checkOut(s, pid, events) {
  if (s.hands[pid].length === 0) { endRound(s, pid, events); return true; }
  return false;
}

// ---------- Zurück ----------
const SNAP_KEYS = ['draw', 'discard', 'hands', 'jok', 'melds', 'pos', 'phase', 'laid', 'turn', 'step', 'dice', 'pending', 'extra', 'keepPending', 'nextStarter', 'durchgang', 'finished', 'started', 'game'];
function snapshot(s) {
  const o = {};
  for (const k of SNAP_KEYS) o[k] = s[k];
  o.wins = Object.fromEntries(s.players.map((p) => [p.id, p.wins]));
  return JSON.parse(JSON.stringify(o));
}
function restore(s, snap) {
  for (const k of SNAP_KEYS) s[k] = snap[k];
  for (const p of s.players) {
    if (p.id in snap.wins) p.wins = snap.wins[p.id];
    if (!s.hands[p.id]) { s.hands[p.id] = []; s.pos[p.id] = 0; s.phase[p.id] = 1; s.laid[p.id] = false; }
  }
}
const UNDOABLE = new Set(['move', 'take', 'green', 'magenta', 'orange', 'rainbow', 'lay', 'append', 'discard', 'keep']);

export function applyAction(s, deck, pid, a) {
  if (!Array.isArray(s.undo)) s.undo = [];
  const me0 = s.players.find((p) => p.id === pid);
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
  const res = applyInner(s, deck, pid, a);
  if (undoable && s.seq !== seqBefore) {
    const entry = s.log.find((e) => e.n === seqBefore + 1) || s.log[s.log.length - 1];
    s.undo.push({ pid, snap, label: entry.text });
    if (s.undo.length > UNDO_MAX) s.undo.splice(0, s.undo.length - UNDO_MAX);
  } else if (a && ['roll', 'kick', 'start', 'newGame'].includes(a.type)) {
    s.undo = []; // Würfeln kann man nicht zurücknehmen – also auch nichts davor
  }
  return res;
}

function applyInner(s, deck, pid, a) {
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw fail('Unbekannter Spieler.');
  const N = me.name;
  const events = [];
  const needHost = () => { if (!me.host) throw fail('Das darf nur der Host.'); };
  const needTurn = (...steps) => {
    if (!s.started) throw fail('Das Spiel hat noch nicht begonnen.');
    if (s.finished) throw fail('Das Spiel ist vorbei – starte ein neues.');
    const t = s.players.find((p) => p.id === s.turn);
    if (!t) throw fail('Gerade ist niemand dran.');
    if (t.id !== pid && !(me.host && !t.connected)) throw fail(`${t.name} ist dran.`);
    if (steps.length && !steps.includes(s.step)) throw fail('Das geht gerade nicht.');
    return t;
  };
  const needPending = (type) => {
    const t = needTurn('action');
    if (!s.pending || s.pending.type !== type) throw fail('Das geht gerade nicht.');
    return t;
  };
  const handCard = (who, cid) => {
    if (!s.hands[who].includes(cid)) throw fail('Diese Karte hast du nicht auf der Hand.');
    return { id: cid, n: s.cards[cid].n, c: s.cards[cid].c, j: !!s.jok[cid] };
  };
  const removeFromHand = (who, cid) => { const h = s.hands[who]; h.splice(h.indexOf(cid), 1); };

  switch (a && a.type) {
    case 'start': {
      needHost();
      if (!s.started) {
        s.started = true;
        startRound(s, s.players[0].id);
      }
      break;
    }

    case 'roll': {
      const t = needTurn('roll');
      s.dice = [1 + randInt(6), 1 + randInt(6)];
      s.step = 'move';
      events.push({ kind: 'roll', idx: [0, 1] });
      log(s, `${t.id === pid ? N : `${N} (für ${t.name})`} würfelt ${s.dice[0]} und ${s.dice[1]}${s.dice[0] === s.dice[1] ? ' – Pasch!' : ''}`);
      break;
    }

    case 'move': {
      const t = needTurn('move');
      const [d1, d2] = s.dice;
      let steps;
      if (a.use === 2) { if (d1 !== d2) throw fail('Den doppelten Wert gibt es nur beim Pasch.'); steps = d1 * 2; }
      else steps = a.use === 1 ? d2 : d1;
      const from = s.pos[t.id];
      movePiece(s, t.id, steps, events);
      log(s, `${t.name} zieht ${steps} ${steps === 1 ? 'Feld' : 'Felder'} vor`);
      void from;
      landOn(s, t.id, events);
      break;
    }

    case 'take': {
      const t = needPending('take');
      let cid;
      if (a.from === 'discard') {
        if (!s.discard.length) throw fail('Der Ablagestapel ist leer.');
        cid = s.discard.pop();
        log(s, `${t.name} nimmt ${cardTxt(s, cid)} vom Ablagestapel`);
      } else {
        cid = drawTop(s);
        if (!cid) throw fail('Es gibt keine Karten mehr zum Nehmen.');
        log(s, `${t.name} nimmt eine Karte vom Aufnahmestapel`);
      }
      s.hands[t.id].push(cid);
      s.pending.left--;
      if (s.pending.left <= 0) { s.pending = null; s.step = 'play'; }
      break;
    }

    case 'green': {
      const t = needPending('green');
      const i = s.discard.indexOf(a.cid);
      if (i < 0) throw fail('Diese Karte liegt nicht im Ablagestapel.');
      s.discard.splice(i, 1);
      s.hands[t.id].push(a.cid);
      log(s, `${t.name} sucht sich eine Karte aus dem Ablagestapel aus`);
      s.pending = null;
      s.step = 'play';
      break;
    }

    case 'magenta': {
      const t = needPending('magenta');
      const ids = [...new Set(Array.isArray(a.cids) ? a.cids : [])];
      if (ids.length < 1 || ids.length > 4) throw fail('Wähle 1 bis 4 Karten zum Abwerfen.');
      for (const cid of ids) handCard(t.id, cid);
      for (const cid of ids) { removeFromHand(t.id, cid); delete s.jok[cid]; s.discard.push(cid); }
      let got = 0;
      for (let k = 0; k <= ids.length; k++) { const c = drawTop(s); if (c) { s.hands[t.id].push(c); got++; } }
      log(s, `${t.name} wirft ${ids.length} ${ids.length === 1 ? 'Karte' : 'Karten'} ab und nimmt ${got} neue`);
      s.pending = null;
      s.step = 'play';
      break;
    }

    case 'orange': {
      const t = needPending('orange');
      const num = Number(a.num);
      if (!(num >= 1 && num <= 12)) throw fail('Wähle eine Zahl von 1 bis 12.');
      const dir = a.dir === -1 ? -1 : 1;
      const n = s.players.length;
      const i0 = s.players.findIndex((p) => p.id === t.id);
      let given = null;
      for (let k = 1; k < n && !given; k++) {
        const o = s.players[(i0 + dir * k + n * 10) % n];
        const h = s.hands[o.id];
        let cid = h.find((c) => !s.jok[c] && s.cards[c].n === num);
        let viaJoker = false;
        if (!cid) { cid = h.find((c) => s.jok[c] && s.cards[c].n === num); viaJoker = !!cid; }
        if (cid) {
          removeFromHand(o.id, cid);
          delete s.jok[cid];
          s.hands[t.id].push(cid);
          const rep = drawTop(s);
          if (rep) s.hands[o.id].push(rep);
          given = { o, viaJoker };
        }
      }
      if (given) log(s, `${t.name} fragt nach einer ${num} – ${given.o.name} muss ${given.viaJoker ? 'einen Joker mit der ' + num : 'eine ' + num} abgeben und bekommt Ersatz`);
      else {
        const c = drawTop(s);
        if (c) s.hands[t.id].push(c);
        log(s, `${t.name} fragt nach einer ${num} – niemand hat sie, ${t.name} nimmt eine Karte vom Aufnahmestapel`);
      }
      s.pending = null;
      s.step = 'play';
      break;
    }

    case 'rainbow': {
      const t = needPending('rainbow');
      if (!RAINBOW_CHOICES.includes(a.kind)) throw fail('Diese Aktion gibt es nicht.');
      const L = BOARD.length;
      let target = -1;
      for (let k = 1; k < L; k++) {
        const f = (s.pos[t.id] + k) % L;
        if (FIELD_TYPES[BOARD[f]].group === a.kind && !occupied(s, f, t.id)) { target = f; break; }
      }
      if (target < 0) throw fail('Alle Felder dieser Aktion sind besetzt – wähle eine andere.');
      s.pos[t.id] = target;
      events.push({ kind: 'move', pid: t.id, path: [target] });
      log(s, `${t.name} wählt „${GROUP_NAMES[a.kind]}“ und springt dorthin`);
      s.pending = null;
      landOn(s, t.id, events);
      break;
    }

    case 'lay': {
      const t = needTurn('play');
      if (s.laid[t.id]) throw fail('Deine Phase liegt schon aus.');
      const ph = PHASES[s.phase[t.id]];
      const groups = Array.isArray(a.groups) ? a.groups : [];
      if (groups.length !== ph.groups.length) throw fail('Bitte alle Teile der Phase füllen.');
      const seen = new Set();
      const built = ph.groups.map((g, gi) => {
        const ids = Array.isArray(groups[gi]) ? groups[gi] : [];
        for (const cid of ids) { if (seen.has(cid)) throw fail('Eine Karte ist doppelt verwendet.'); seen.add(cid); }
        const r = buildGroup(g, ids.map((cid) => handCard(t.id, cid)));
        if (r.error) throw fail(r.error);
        return r.meld;
      });
      for (const m of built) {
        for (const x of m.cards) removeFromHand(t.id, x.id);
        s.melds.push({ ...m, id: rid(5), owner: t.id });
      }
      s.laid[t.id] = true;
      log(s, `✅ ${t.name} legt Phase ${s.phase[t.id]} aus (${ph.text})`);
      checkOut(s, t.id, events);
      break;
    }

    case 'append': {
      const t = needTurn('play');
      if (!s.laid[t.id]) throw fail('Anlegen darfst du erst, wenn deine eigene Phase ausliegt.');
      const m = s.melds.find((x) => x.id === a.meld);
      if (!m) throw fail('Diese Auslage gibt es nicht.');
      const x = handCard(t.id, a.cid);
      const fit = fitCard(m, x);
      if (fit.error) throw fail(fit.error);
      removeFromHand(t.id, x.id);
      if (m.kind === 'run') {
        const entry = { id: x.id, v: fit.v, j: x.j };
        if (fit.end === 'lo') { m.cards.unshift(entry); m.lo = fit.v; } else { m.cards.push(entry); if (fit.v) m.hi = fit.v; }
      } else m.cards.push({ id: x.id, v: fit.v, col: fit.col, j: x.j });
      log(s, `${t.name} legt ${x.j ? 'einen Joker' : cardTxt(s, x.id)} bei ${m.owner === t.id ? 'sich' : nameOf(s, m.owner)} an`);
      checkOut(s, t.id, events);
      break;
    }

    case 'discard': {
      const t = needTurn('play');
      const x = handCard(t.id, a.cid);
      removeFromHand(t.id, x.id);
      delete s.jok[x.id];
      s.discard.push(x.id);
      log(s, `${t.name} wirft ${cardTxt(s, x.id)} ab${x.j ? ' (war ein Joker)' : ''}`);
      if (checkOut(s, t.id, events)) break;
      if (s.extra) {
        s.extra = false;
        s.step = 'roll';
        s.dice = null;
        s.pending = null;
        log(s, `${t.name} macht einen Extra-Zug`);
      } else nextTurn(s);
      break;
    }

    case 'keep': {
      if (s.step !== 'keep') throw fail('Das geht gerade nicht.');
      const who = a.for || pid;
      const target = s.players.find((p) => p.id === who);
      if (!target || !s.keepPending.includes(who)) throw fail('Du musst gerade keine Karten auswählen.');
      if (who !== pid && !(me.host && !target.connected)) throw fail('Das darf nur der Spieler selbst.');
      let ids = [...new Set(Array.isArray(a.cids) ? a.cids : [])];
      if (a.auto) ids = s.hands[who].slice(0, 5);
      if (ids.length !== 5 || ids.some((c) => !s.hands[who].includes(c))) throw fail('Wähle genau 5 Karten von deiner Hand.');
      const rest = s.hands[who].filter((c) => !ids.includes(c));
      s.hands[who] = ids;
      for (const c of rest) delete s.jok[c];
      s.keepPending = s.keepPending.filter((x) => x !== who);
      log(s, `${target.name} behält 5 Karten`);
      if (!s.keepPending.length) startRound(s, s.nextStarter);
      break;
    }

    case 'newGame': {
      s.game++;
      s.finished = false;
      s.started = true;
      s.durchgang = 0;
      for (const p of s.players) { s.pos[p.id] = 0; s.phase[p.id] = 1; s.laid[p.id] = true; }
      s.jok = {};
      const starter = s.players[(s.game - 1) % s.players.length];
      log(s, `${N} startet Spiel ${s.game}`);
      startRound(s, starter.id);
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
      s.draw.unshift(...shuffle(s.hands[t.id] || []));
      for (const c of s.hands[t.id] || []) delete s.jok[c];
      delete s.hands[t.id];
      s.players.splice(i, 1);
      s.keepPending = s.keepPending.filter((x) => x !== t.id);
      events.push({ kind: 'kicked', pid: t.id });
      log(s, `${N} entfernt ${t.name} aus dem Raum`);
      if (wasTurn && s.started && !s.finished) {
        s.turn = s.players[i % s.players.length].id;
        s.step = 'roll'; s.dice = null; s.pending = null; s.extra = false;
      }
      if (s.step === 'keep' && !s.keepPending.length) startRound(s, s.players.some((p) => p.id === s.nextStarter) ? s.nextStarter : s.players[0].id);
      break;
    }

    default:
      throw fail('Unbekannte Aktion.');
  }
  return { events };
}

export function viewFor(s, deck, pid) {
  const card = (cid) => ({ id: cid, n: s.cards[cid].n, c: s.cards[cid].c });
  const top = s.undo && s.undo.length ? s.undo[s.undo.length - 1] : null;
  return {
    me: pid,
    kind: 'phasen',
    deckId: s.deckId,
    variant: s.variant,
    started: s.started,
    finished: s.finished,
    game: s.game,
    durchgang: s.durchgang,
    turn: s.turn,
    step: s.step,
    dice: s.dice,
    pending: s.pending,
    extra: s.extra,
    keepPending: s.keepPending,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, host: p.host, color: p.color, connected: p.connected, wins: p.wins,
      count: (s.hands[p.id] || []).length, pos: s.pos[p.id], phase: s.phase[p.id], laid: !!s.laid[p.id],
      // Joker sieht man von außen mit Vorderseite – der Besitzer selbst nicht
      jokers: p.id === pid ? null : (s.hands[p.id] || []).filter((c) => s.jok[c]).map(card),
    })),
    hand: (s.hands[pid] || []).map((cid) => (s.jok[cid] ? { id: cid, j: true } : { ...card(cid), j: false })),
    melds: s.melds.map((m) => ({ id: m.id, owner: m.owner, kind: m.kind, val: m.val, col: m.col, lo: m.lo, hi: m.hi, cards: m.cards.map((x) => (x.j ? { j: true, v: x.v, col: x.col } : { ...card(x.id), j: false, v: x.v })) })),
    discardTop: s.discard.length ? card(s.discard[s.discard.length - 1]) : null,
    discardCount: s.discard.length,
    drawCount: s.draw.length,
    discardAll: s.pending && s.pending.type === 'green' && s.turn === pid ? s.discard.map(card).reverse() : null,
    log: s.log.slice(-60),
    undo: top && top.pid === pid ? top.label : null,
  };
}
