// Farbblock-Würfelspiel ("Klecks!") – Spielzustand, läuft nur beim Host.
// Gleiche Schnittstelle wie game.js/dice.js/cross.js. Varianten unterscheiden sich nur im Blatt.

import { rid } from './game.js';

const MAX_LOG = 80;
const UNDO_MAX = 30;
const SEAT_COLORS = ['#f08c00', '#4dabf7', '#69db7c', '#da77f2', '#ff8787', '#ffd43b'];
const randInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const fail = (msg) => new Error(msg);

export const W = 15;
export const H = 7;
export const START_COL = 7; // Spalte H
export const LETTERS = 'ABCDEFGHIJKLMNO'.split('');
export const TOP = [5, 3, 3, 3, 2, 2, 2, 1, 2, 2, 2, 3, 3, 3, 5];
export const BOT = [3, 2, 2, 2, 1, 1, 1, 0, 1, 1, 1, 2, 2, 2, 3];
export const JOKERS = 8;
export const SOLO_ROLLS = 30;
export const COLORS = { g: 'Grün', y: 'Gelb', b: 'Blau', p: 'Pink', o: 'Orange' };
export const COLOR_KEYS = Object.keys(COLORS);
const COLOR_ADJ = { g: 'grünen', y: 'gelben', b: 'blauen', p: 'pinken', o: 'orangen' };
const FACES = [...COLOR_KEYS, 'j']; // j = Joker (freie Farbe)

export const VARIANTS = {
  classic: {
    id: 'classic', name: 'Classic', short: '15 Spalten · 5 Farben · Start in Spalte H',
    rows: ['bbbggybbbpgpooo', 'pbpppyppopgppob', 'pbggyybyopbbpyy', 'pggbgyboobbyyyo', 'pbybgybpgggbpoo', 'boypgggygooopgo', 'ooyygyyyyooopgg'],
    stars: [11, 14, 23, 31, 33, 34, 51, 55, 57, 60, 62, 67, 69, 73, 80],
  },
};

export const RULES = [
  'Wer dran ist, würfelt einmal mit allen Würfeln: 3 Farbwürfel und 3 Zahlenwürfel.',
  'Jeder wählt 1 Farbwürfel + 1 Zahlenwürfel und kreuzt genau so viele zusammenhängende Felder dieser Farbe an (alle im selben Farbblock).',
  'Der Würfelnde wählt zuerst. Die anderen dürfen danach nur die übrigen 4 Würfel nehmen (mehrere dürfen dieselben nehmen). In den ersten 3 Würfen dürfen alle aus allen Würfeln wählen. Passt der Würfelnde, dürfen die anderen alle Würfel nutzen.',
  'Das erste Kreuz muss in Spalte H liegen. Danach muss jede Gruppe in Spalte H liegen oder waagerecht/senkrecht an ein eigenes Kreuz grenzen (diagonal zählt nicht).',
  'Fragezeichen sind Joker: freie Farbe bzw. freie Zahl 1–5. Jeder benutzte Joker kostet ein „!“. Ohne „!“ keine Joker mehr.',
  'Passen ist jederzeit erlaubt und kostet nichts.',
  'Volle Spalte: wer zuerst, bekommt die obere Zahl, alle späteren die untere. Alle Felder einer Farbe: zuerst 5, später 3 Bonuspunkte. Wer es im selben Wurf schafft, gilt als „zuerst“.',
  'Das Spiel endet nach dem Wurf, in dem jemand seine zweite Farbe komplett hat. Übrige „!“ = +1, jeder nicht angekreuzte Stern = −2. Bei Gleichstand gewinnt, wer mehr „!“ übrig hat.',
  'Allein: nur 2 Farb- und 2 Zahlenwürfel, Ende nach 30 Würfen.',
];

// ---------------------------------------------------------------------------
// Blatt-Hilfen
// ---------------------------------------------------------------------------
export const colorAt = (V, i) => V.rows[Math.floor(i / W)][i % W];
export function neighbors(i) {
  const r = Math.floor(i / W), c = i % W, out = [];
  if (r > 0) out.push(i - W);
  if (r < H - 1) out.push(i + W);
  if (c > 0) out.push(i - 1);
  if (c < W - 1) out.push(i + 1);
  return out;
}
const colorTotal = (V, col) => V.rows.join('').split('').filter((x) => x === col).length;

// Prüft einen Zug. Gibt { error } oder { cost } zurück.
export function checkMove(V, sheet, dice, ci, ni, cells) {
  const cd = dice[ci], nd = dice[ni];
  if (!cd || cd.t !== 'c' || cd.v === null) return { error: 'Wähle einen Farbwürfel.' };
  if (!nd || nd.t !== 'n' || nd.v === null) return { error: 'Wähle einen Zahlenwürfel.' };
  const cost = (cd.v === 'j' ? 1 : 0) + (nd.v === 0 ? 1 : 0);
  if (sheet.jok + cost > JOKERS) return { error: 'Du hast keine Joker („!“) mehr übrig.' };
  const list = [...new Set(cells.map(Number))];
  if (!list.length) return { error: nd.v === 0 ? 'Markiere 1 bis 5 Felder.' : `Markiere ${nd.v} ${nd.v === 1 ? 'Feld' : 'Felder'}.` };
  if (nd.v !== 0 && list.length !== nd.v) return { error: `Genau ${nd.v} ${nd.v === 1 ? 'Feld' : 'Felder'} markieren (gerade ${list.length}).` };
  if (list.length > 5) return { error: 'Höchstens 5 Felder pro Wurf.' };
  const crossed = new Set(sheet.x);
  if (list.some((i) => !(i >= 0 && i < W * H) || crossed.has(i))) return { error: 'Ein Feld ist schon angekreuzt.' };
  const col = colorAt(V, list[0]);
  if (list.some((i) => colorAt(V, i) !== col)) return { error: 'Alle Felder müssen dieselbe Farbe haben.' };
  if (cd.v !== 'j' && col !== cd.v) return { error: `Der Farbwürfel zeigt ${COLORS[cd.v]} – die Felder müssen ${COLORS[cd.v]} sein.` };
  // zusammenhängend?
  const set = new Set(list), seen = new Set([list[0]]), stack = [list[0]];
  while (stack.length) {
    const i = stack.pop();
    for (const n of neighbors(i)) if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
  }
  if (seen.size !== list.length) return { error: 'Die Felder müssen zusammenhängen (waagerecht/senkrecht).' };
  const touches = list.some((i) => i % W === START_COL || neighbors(i).some((n) => crossed.has(n)));
  if (!touches) return { error: sheet.x.length ? 'Die Felder müssen an ein Kreuz grenzen oder in Spalte H liegen.' : 'Dein erstes Kreuz muss in Spalte H liegen.' };
  return { cost, color: col, count: list.length, cells: list };
}

// Welche Würfel darf ein Spieler gerade nehmen?
export function diceRule(s, pid) {
  const solo = s.players.length === 1;
  const usable = s.dice.map((d) => d.v !== null);
  if (!s.rolled) return { wait: 'Noch nicht gewürfelt.', usable: usable.map(() => false) };
  if (pid === s.turn || s.round <= 3 || solo) return { wait: null, usable };
  const ap = s.picks[s.turn];
  if (!ap) return { wait: 'active', usable: usable.map(() => false) };
  if (ap.pass) return { wait: null, usable };
  return { wait: null, usable: usable.map((u, i) => u && i !== ap.c && i !== ap.n) };
}

// Punkte eines Blatts (braucht alle Blätter für „wer zuerst?“).
export function score(V, sheet, allSheets) {
  const firstCol = (c) => Math.min(...allSheets.map((sh) => (sh.colDone && c in sh.colDone ? sh.colDone[c] : Infinity)));
  const firstColor = (k) => Math.min(...allSheets.map((sh) => (sh.colorDone && k in sh.colorDone ? sh.colorDone[k] : Infinity)));
  const colPts = TOP.map((_, c) => (c in sheet.colDone ? (sheet.colDone[c] <= firstCol(c) ? TOP[c] : BOT[c]) : null));
  const colorPts = Object.fromEntries(COLOR_KEYS.map((k) => [k, k in sheet.colorDone ? (sheet.colorDone[k] <= firstColor(k) ? 5 : 3) : null]));
  const crossed = new Set(sheet.x);
  const starsOpen = V.stars.filter((i) => !crossed.has(i)).length;
  const cols = colPts.reduce((a, b) => a + (b || 0), 0);
  const bonus = Object.values(colorPts).reduce((a, b) => a + (b || 0), 0);
  const jokers = JOKERS - sheet.jok;
  const stars = starsOpen * 2;
  return {
    colPts, colorPts, bonus, cols, jokers, stars, starsOpen, total: bonus + cols + jokers - stars,
    lostTop: TOP.map((_, c) => firstCol(c) !== Infinity && !(c in sheet.colDone && sheet.colDone[c] <= firstCol(c))),
    lostFive: Object.fromEntries(COLOR_KEYS.map((k) => [k, firstColor(k) !== Infinity && !(k in sheet.colorDone && sheet.colorDone[k] <= firstColor(k))])),
  };
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
function log(s, text) {
  s.log.push({ n: ++s.seq, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}
const emptySheet = () => ({ x: [], jok: 0, colDone: {}, colorDone: {} });
function resetDice(s) {
  s.dice = [0, 1, 2].map(() => ({ t: 'c', v: null })).concat([0, 1, 2].map(() => ({ t: 'n', v: null })));
  s.rolled = false;
  s.picks = {};
}
const dieName = (d) => (d.t === 'c' ? (d.v === 'j' ? 'Joker-Farbe' : COLORS[d.v]) : d.v === 0 ? 'Joker-Zahl' : String(d.v));

export function createState(deck, deckId, variant) {
  const s = {
    kind: 'klecks', deckId, variant: VARIANTS[variant] ? variant : 'classic',
    started: false, finished: false, game: 1, seq: 0, round: 0,
    players: [], sheets: {}, turn: null, log: [], undo: {},
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
  s.sheets[p.id] = emptySheet();
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

function finish(s, events, why) {
  s.finished = true;
  const V = VARIANTS[s.variant];
  const all = s.players.map((p) => s.sheets[p.id]);
  const res = s.players.map((p) => ({ p, sc: score(V, s.sheets[p.id], all) }));
  const best = Math.max(...res.map((r) => r.sc.total));
  let top = res.filter((r) => r.sc.total === best);
  const bestJ = Math.max(...top.map((r) => r.sc.jokers));
  top = top.filter((r) => r.sc.jokers === bestJ); // Gleichstand: mehr „!“ übrig gewinnt
  for (const r of top) r.p.wins++;
  const names = top.map((r) => r.p.name).join(' & ');
  events.push({ kind: 'win', name: names, color: top[0].p.color });
  log(s, `🏆 Spiel ${s.game} ist vorbei (${why}) – ${names} ${top.length > 1 ? 'gewinnen' : 'gewinnt'} mit ${best} Punkten`);
}

// ---------- Zurück (jeder nimmt seine eigenen Schritte zurück) ----------
function snapshot(s, pid) {
  return JSON.parse(JSON.stringify({
    all: { variant: s.variant, started: s.started, finished: s.finished, game: s.game, round: s.round, turn: s.turn, dice: s.dice, rolled: s.rolled, picks: s.picks, sheets: s.sheets },
    sheet: s.sheets[pid] || null, pick: s.picks[pid] || null, round: s.round,
    wins: Object.fromEntries(s.players.map((p) => [p.id, p.wins])),
  }));
}
function restore(s, pid, entry) {
  const snap = entry.snap;
  if (entry.full) {
    Object.assign(s, { ...snap.all, sheets: {} });
    for (const p of s.players) s.sheets[p.id] = snap.all.sheets[p.id] || emptySheet();
  } else {
    s.sheets[pid] = snap.sheet || emptySheet();
    if (s.round === snap.round) {
      if (snap.pick) s.picks[pid] = snap.pick;
      else delete s.picks[pid];
    }
  }
  for (const p of s.players) if (p.id in snap.wins) p.wins = snap.wins[p.id];
  if (s.turn && !s.players.some((p) => p.id === s.turn)) { s.turn = s.players[0]?.id || null; resetDice(s); }
}

const UNDOABLE = new Set(['commit', 'pass', 'newGame', 'resetWins']);
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
  const snap = undoable ? snapshot(s, pid) : null;
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
  const solo = s.players.length === 1;
  const needHost = () => { if (!me.host) throw fail('Das darf nur der Host.'); };
  const needRunning = () => {
    if (!s.started) throw fail('Das Spiel hat noch nicht begonnen.');
    if (s.finished) throw fail('Das Spiel ist vorbei – starte ein neues.');
  };
  const needTurn = () => {
    needRunning();
    const t = s.players.find((p) => p.id === s.turn);
    if (!t) throw fail('Gerade ist niemand dran.');
    if (t.id !== pid && !(me.host && !t.connected)) throw fail(`${t.name} ist mit Würfeln dran.`);
    return t;
  };
  const needChoice = () => {
    needRunning();
    if (!s.rolled) throw fail('Es wurde noch nicht gewürfelt.');
    if (s.picks[pid]) throw fail('Du hast diesen Wurf schon genutzt.');
    const rule = diceRule(s, pid);
    if (rule.wait === 'active') throw fail(`Warte, bis ${s.players.find((p) => p.id === s.turn)?.name || 'der Würfelnde'} gewählt hat.`);
    return rule;
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
      s.round++;
      s.picks = {};
      const idx = [];
      s.dice.forEach((d, i) => {
        if (solo && (i === 2 || i === 5)) { d.v = null; return; } // allein nur 2 + 2 Würfel
        d.v = d.t === 'c' ? FACES[randInt(6)] : randInt(6); // Zahl 0 = Joker
        idx.push(i);
      });
      s.rolled = true;
      events.push({ kind: 'roll', idx });
      const str = s.dice.filter((d) => d.v !== null).map(dieName).join(' · ');
      log(s, `${t.id === pid ? N : `${N} (für ${t.name})`} würfelt (${s.round}. Wurf${solo ? ` von ${SOLO_ROLLS}` : ''}): ${str}`);
      break;
    }

    case 'commit': {
      const rule = needChoice();
      const ci = Number(a.c), ni = Number(a.n);
      if (!rule.usable[ci] || !rule.usable[ni]) throw fail('Diesen Würfel hat sich der Würfelnde schon genommen.');
      const sh = s.sheets[pid];
      const chk = checkMove(V, sh, s.dice, ci, ni, Array.isArray(a.cells) ? a.cells : []);
      if (chk.error) throw fail(chk.error);
      sh.x.push(...chk.cells);
      sh.jok += chk.cost;
      s.picks[pid] = { c: ci, n: ni };
      // Volle Spalten / Farben merken (mit Wurfnummer für „wer zuerst?“)
      const crossed = new Set(sh.x);
      const extras = [];
      for (const c of new Set(chk.cells.map((i) => i % W))) {
        if (!(c in sh.colDone) && Array.from({ length: H }, (_, r) => r * W + c).every((i) => crossed.has(i))) {
          sh.colDone[c] = s.round;
          extras.push(`Spalte ${LETTERS[c]} voll`);
        }
      }
      const total = colorTotal(V, chk.color);
      if (!(chk.color in sh.colorDone) && sh.x.filter((i) => colorAt(V, i) === chk.color).length === total) {
        sh.colorDone[chk.color] = s.round;
        extras.push(`alle ${COLOR_ADJ[chk.color]} Felder fertig`);
      }
      const jtxt = chk.cost ? ` (${chk.cost} Joker)` : '';
      log(s, `${N} kreuzt ${chk.count}× ${COLORS[chk.color]} an${jtxt}${extras.length ? ` – ${extras.join(', ')}!` : ''}`);
      break;
    }

    case 'pass': {
      needChoice();
      s.picks[pid] = { pass: true };
      log(s, `${N} passt`);
      break;
    }

    case 'endTurn': {
      const t = needTurn();
      if (!s.rolled) throw fail('Erst würfeln!');
      if (!s.picks[t.id]) { s.picks[t.id] = { pass: true }; log(s, `${t.name} passt`); }
      const twoColors = s.players.find((p) => Object.keys(s.sheets[p.id].colorDone).length >= 2);
      if (twoColors) { finish(s, events, `${twoColors.name} hat zwei Farben komplett`); resetDice(s); s.turn = null; break; }
      if (solo && s.round >= SOLO_ROLLS) { finish(s, events, `${SOLO_ROLLS} Würfe gespielt`); resetDice(s); s.turn = null; break; }
      const i = s.players.findIndex((p) => p.id === t.id);
      const next = s.players[(i + 1) % s.players.length];
      s.turn = next.id;
      resetDice(s);
      log(s, `${next.name} würfelt als Nächstes`);
      break;
    }

    case 'newGame': {
      if (a.variant && VARIANTS[a.variant]) s.variant = a.variant;
      s.game++;
      s.started = true;
      s.finished = false;
      s.round = 0;
      for (const p of s.players) s.sheets[p.id] = emptySheet();
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
      delete s.picks[t.id];
      events.push({ kind: 'kicked', pid: t.id });
      log(s, `${N} entfernt ${t.name} aus dem Raum`);
      if (wasTurn && s.started && !s.finished) { s.turn = s.players[i % s.players.length].id; resetDice(s); }
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
    kind: 'klecks',
    deckId: s.deckId,
    variant: s.variant,
    started: s.started,
    finished: s.finished,
    game: s.game,
    round: s.round,
    turn: s.turn,
    dice: s.dice,
    rolled: s.rolled,
    picks: s.picks,
    players: s.players.map((p) => ({ id: p.id, name: p.name, host: p.host, color: p.color, connected: p.connected, wins: p.wins })),
    sheets: s.sheets,
    log: s.log.slice(-50),
    undo: mine.length ? mine[mine.length - 1].label : null,
  };
}
