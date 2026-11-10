// Spielzustand – läuft nur beim Host.
// Das System kennt KEINE Spielregeln. Es kennt nur Karten, Stapel, Hände und den Tisch.
// Jede Karte existiert genau einmal und liegt immer an genau einem Ort.

const MAX_LOG = 80;
const SEAT_COLORS = ['#f08c00', '#4dabf7', '#69db7c', '#da77f2', '#ff8787', '#ffd43b'];

export function rid(n = 8) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(n))) s += a[b % a.length];
  return s;
}

function randInt(n) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampInt = (v, lo, hi, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? clamp(n, lo, hi) : def;
};
const fail = (msg) => new Error(msg);

function log(s, text) {
  s.log.push({ n: ++s.seq, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

export function createState(deck, deckId) {
  const s = {
    deckId, started: false, round: 0, seq: 0,
    players: [], cards: {}, piles: {}, hands: {}, table: [], log: [], undo: [],
  };
  for (const p of deck.piles) s.piles[p.id] = { cards: [] };
  deck.cards.forEach((c, t) => {
    for (let i = 0; i < (c.count || 1); i++) {
      let id;
      do id = rid(); while (s.cards[id]);
      s.cards[id] = { t, up: false };
    }
  });
  gatherAll(s, deck);
  return s;
}

// Alle Karten in den Startstapel legen und mischen.
function gatherAll(s, deck) {
  for (const id of Object.keys(s.piles)) s.piles[id].cards = [];
  for (const pid of Object.keys(s.hands)) s.hands[pid] = [];
  s.table = [];
  const all = Object.keys(s.cards);
  for (const id of all) s.cards[id].up = false;
  s.piles[deck.startPile].cards = shuffle(all);
}

export function addPlayer(s, deck, name, token, isHost = false) {
  name = String(name || '').trim().slice(0, 20) || 'Spieler';
  if (token) {
    const ex = s.players.find((p) => p.token === token);
    if (ex) {
      // Wiederkehrender Spieler behält seinen Platz und Namen.
      ex.connected = true;
      log(s, `${ex.name} ist wieder da`);
      return ex;
    }
  }
  if (s.players.length >= deck.maxPlayers) return null;
  const used = new Set(s.players.map((p) => p.color));
  const p = {
    id: rid(6), name, token: token || null, host: isHost, connected: true,
    wins: 0, revealed: false,
    color: SEAT_COLORS.find((c) => !used.has(c)) || SEAT_COLORS[0],
  };
  s.players.push(p);
  s.hands[p.id] = [];
  log(s, `${p.name} ${isHost ? 'hat den Raum erstellt' : 'ist beigetreten'}`);
  return p;
}

export function setConnected(s, pid, on) {
  const p = s.players.find((x) => x.id === pid);
  if (!p || p.connected === on) return;
  p.connected = on;
  log(s, `${p.name} ${on ? 'ist wieder da' : 'hat die Verbindung verloren'}`);
}

function locate(s, cid) {
  for (const [pid, h] of Object.entries(s.hands)) {
    const i = h.indexOf(cid);
    if (i >= 0) return { kind: 'hand', pid, i };
  }
  const ti = s.table.findIndex((e) => e.cid === cid);
  if (ti >= 0) return { kind: 'table', i: ti };
  for (const [id, p] of Object.entries(s.piles)) {
    const i = p.cards.indexOf(cid);
    if (i >= 0) return { kind: 'pile', id, i };
  }
  return null;
}

function detach(s, loc) {
  if (loc.kind === 'hand') s.hands[loc.pid].splice(loc.i, 1);
  else if (loc.kind === 'table') s.table.splice(loc.i, 1);
  else s.piles[loc.id].cards.splice(loc.i, 1);
}

// ---------- Rückgängig ----------
const UNDO_MAX = 30;
// Diese Aktionen kann man zurücknehmen (Rufe, Sortieren usw. nicht).
const UNDOABLE = new Set(['newRound', 'shuffle', 'deal', 'draw', 'move', 'flip', 'recycle', 'reveal', 'win', 'resetWins']);

function snapshot(s) {
  return JSON.parse(JSON.stringify({
    cards: s.cards, piles: s.piles, hands: s.hands, table: s.table, round: s.round, started: s.started,
    players: s.players.map((p) => ({ id: p.id, wins: p.wins, revealed: p.revealed })),
  }));
}

function restore(s, deck, snap) {
  s.cards = snap.cards;
  s.piles = snap.piles;
  s.table = snap.table;
  s.round = snap.round;
  s.started = snap.started;
  const hands = {};
  for (const p of s.players) {
    hands[p.id] = snap.hands[p.id] || [];
    const old = snap.players.find((x) => x.id === p.id);
    if (old) { p.wins = old.wins; p.revealed = old.revealed; }
  }
  // Karten von Spielern, die inzwischen nicht mehr da sind, zurück in den Startstapel.
  for (const [pid, h] of Object.entries(snap.hands)) {
    if (!hands[pid]) s.piles[deck.startPile].cards.unshift(...h);
  }
  s.hands = hands;
}

// Führt eine Aktion aus. Wirft einen Error mit lesbarer Meldung, wenn sie nicht geht.
export function applyAction(s, deck, pid, a) {
  if (!Array.isArray(s.undo)) s.undo = [];
  const me0 = s.players.find((p) => p.id === pid);

  if (a && a.type === 'undo') {
    if (!me0) throw fail('Unbekannter Spieler.');
    const last = s.undo.pop();
    if (!last) throw fail('Es gibt nichts zum Zurücknehmen.');
    restore(s, deck, last.snap);
    log(s, `↶ ${me0.name} nimmt zurück: ${last.label}`);
    return { events: [{ kind: 'undo', name: me0.name, label: last.label }] };
  }

  const undoable = me0 && a && UNDOABLE.has(a.type);
  const snap = undoable ? snapshot(s) : null;
  const seqBefore = s.seq;
  const res = applyInner(s, deck, pid, a);
  if (undoable) {
    let label = null;
    if (s.seq !== seqBefore) label = s.log[s.log.length - 1].text;
    else if (a.type === 'move' && a.to && a.to.kind === 'table') label = `${me0.name} verschiebt eine Karte auf dem Tisch`;
    if (label) {
      s.undo.push({ snap, label });
      if (s.undo.length > UNDO_MAX) s.undo.splice(0, s.undo.length - UNDO_MAX);
    }
  } else if (a && (a.type === 'kick' || a.type === 'start')) {
    s.undo = [];
  }
  return res;
}

function applyInner(s, deck, pid, a) {
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw fail('Unbekannter Spieler.');
  const N = me.name;
  const events = [];
  const pileDef = (id) => {
    const d = deck.piles.find((p) => p.id === id);
    if (!d) throw fail('Diesen Stapel gibt es nicht.');
    return d;
  };
  const player = (id) => {
    const p = s.players.find((x) => x.id === id);
    if (!p) throw fail('Diesen Spieler gibt es nicht.');
    return p;
  };
  const cname = (cid) => deck.cards[s.cards[cid].t].name;
  const needHost = () => { if (!me.host) throw fail('Das darf nur der Host.'); };

  switch (a && a.type) {
    case 'start': {
      needHost();
      if (!s.started) { s.started = true; s.round = 1; log(s, 'Das Spiel beginnt!'); }
      break;
    }

    case 'newRound': {
      gatherAll(s, deck);
      for (const p of s.players) p.revealed = false;
      s.started = true;
      s.round++;
      log(s, `${N} sammelt alle Karten ein und mischt – Runde ${s.round}`);
      break;
    }

    case 'shuffle': {
      const d = pileDef(a.pile);
      shuffle(s.piles[a.pile].cards);
      log(s, `${N} mischt „${d.name}“`);
      break;
    }

    case 'deal': {
      const pileId = a.pile || deck.startPile;
      const d = pileDef(pileId);
      const c = s.piles[pileId].cards;
      const n = clampInt(a.count, 1, 60, deck.deal || 7);
      let dealt = 0;
      for (let r = 0; r < n; r++) {
        for (const p of s.players) {
          if (!c.length) break;
          const cid = c.pop();
          s.cards[cid].up = false;
          s.hands[p.id].push(cid);
          dealt++;
        }
      }
      log(s, `${N} teilt jedem ${n} ${n === 1 ? 'Karte' : 'Karten'} aus „${d.name}“ aus`);
      if (dealt < n * s.players.length) log(s, `„${d.name}“ ist leer – nicht alle haben genug bekommen`);
      break;
    }

    case 'draw': {
      const d = pileDef(a.pile);
      const c = s.piles[a.pile].cards;
      if (!c.length) throw fail(`„${d.name}“ ist leer.`);
      const n = clampInt(a.count, 1, 30, 1);
      const names = [];
      let k = 0;
      while (k < n && c.length) {
        const cid = c.pop();
        if (d.faceUp) names.push(cname(cid));
        s.cards[cid].up = false;
        s.hands[pid].push(cid);
        k++;
      }
      const what = d.faceUp ? names.join(', ') : (k === 1 ? 'eine Karte' : `${k} Karten`);
      log(s, `${N} ${d.faceUp ? 'nimmt' : 'zieht'} ${what} von „${d.name}“`);
      break;
    }

    case 'move': {
      let cid, loc;
      if (a.fromPile) {
        pileDef(a.fromPile);
        const c = s.piles[a.fromPile].cards;
        if (!c.length) throw fail('Der Stapel ist leer.');
        cid = c[c.length - 1];
        loc = { kind: 'pile', id: a.fromPile, i: c.length - 1 };
      } else {
        cid = a.cid;
        loc = locate(s, cid);
        if (!loc) throw fail('Diese Karte liegt nicht mehr dort.');
        if (loc.kind === 'hand' && loc.pid !== pid) throw fail('Das ist nicht deine Karte.');
        if (loc.kind === 'pile' && loc.i !== s.piles[loc.id].cards.length - 1) throw fail('Man kann nur die oberste Karte nehmen.');
      }
      const card = s.cards[cid];
      const wasPublic = (loc.kind === 'pile' && pileDef(loc.id).faceUp) || (loc.kind === 'table' && card.up);
      const fromTxt = loc.kind === 'pile' ? ` von „${pileDef(loc.id).name}“` : loc.kind === 'table' ? ' vom Tisch' : '';
      const to = a.to || {};

      if (to.kind === 'table') {
        if (deck.table === false) throw fail('Dieses Spiel hat keinen freien Tisch.');
        const x = clamp(Number(to.x) || 0.5, 0, 1);
        const y = clamp(Number(to.y) || 0.5, 0, 1);
        if (loc.kind === 'table') {
          // Nur verschieben – kein Eintrag im Verlauf.
          const e = s.table.splice(loc.i, 1)[0];
          e.x = x; e.y = y;
          s.table.push(e);
          break;
        }
        detach(s, loc);
        card.up = typeof to.up === 'boolean' ? to.up : (loc.kind === 'pile' ? pileDef(loc.id).faceUp : true);
        s.table.push({ cid, x, y });
        const what = wasPublic || card.up ? cname(cid) : 'eine Karte';
        log(s, `${N} legt ${what}${fromTxt} ${card.up ? '' : 'verdeckt '}auf den Tisch`);
      } else if (to.kind === 'pile') {
        const d = pileDef(to.id);
        if (loc.kind === 'pile' && loc.id === to.id) break;
        detach(s, loc);
        card.up = d.faceUp;
        s.piles[to.id].cards.push(cid);
        const what = wasPublic || d.faceUp ? cname(cid) : 'eine Karte';
        log(s, `${N} legt ${what}${fromTxt} auf „${d.name}“`);
      } else if (to.kind === 'hand' || to.kind === 'player') {
        const target = to.kind === 'hand' ? pid : to.pid;
        const tp = player(target);
        if (loc.kind === 'hand' && loc.pid === target) break;
        detach(s, loc);
        card.up = false;
        s.hands[target].push(cid);
        const what = wasPublic ? cname(cid) : 'eine Karte';
        if (to.kind === 'hand') {
          const verb = loc.kind === 'pile' && !wasPublic ? 'zieht' : 'nimmt';
          log(s, `${N} ${verb} ${what}${fromTxt}${verb === 'nimmt' ? ' auf die Hand' : ''}`);
        } else {
          log(s, `${N} gibt ${what}${fromTxt} an ${tp.name}`);
        }
      } else {
        throw fail('Ungültiges Ziel.');
      }
      break;
    }

    case 'flip': {
      const loc = locate(s, a.cid);
      if (!loc || loc.kind !== 'table') throw fail('Nur Karten auf dem Tisch kann man umdrehen.');
      const card = s.cards[a.cid];
      card.up = !card.up;
      log(s, card.up ? `${N} deckt ${cname(a.cid)} auf` : `${N} dreht ${cname(a.cid)} um (verdeckt)`);
      break;
    }

    case 'recycle': {
      // Alle Karten außer der obersten von einem Stapel unter einen anderen mischen (z. B. Ablage → Nachziehstapel).
      const fd = pileDef(a.from), td = pileDef(a.to);
      if (a.from === a.to) throw fail('Gleicher Stapel.');
      const fc = s.piles[a.from].cards;
      if (fc.length < 2) throw fail('Da gibt es nichts zum Mischen.');
      const keep = fc.pop();
      const moved = shuffle(fc.splice(0));
      fc.push(keep);
      for (const cid of moved) s.cards[cid].up = td.faceUp;
      s.piles[a.to].cards.unshift(...moved);
      log(s, `${N} mischt ${moved.length} Karten von „${fd.name}“ unter „${td.name}“`);
      break;
    }

    case 'reorder': {
      const h = s.hands[pid];
      const i = h.indexOf(a.cid);
      if (i < 0) throw fail('Karte nicht auf deiner Hand.');
      h.splice(i, 1);
      h.splice(clampInt(a.index, 0, h.length, h.length), 0, a.cid);
      break;
    }

    case 'sortHand': {
      s.hands[pid].sort((x, y) => s.cards[x].t - s.cards[y].t);
      break;
    }

    case 'reveal': {
      me.revealed = !me.revealed;
      log(s, me.revealed ? `${N} zeigt allen die Hand` : `${N} nimmt die Hand wieder zu sich`);
      break;
    }

    case 'shout': {
      const text = String(a.text || '').trim().slice(0, 40);
      if (!text) throw fail('Leerer Ruf.');
      events.push({ kind: 'shout', pid, name: N, color: me.color, text });
      log(s, `${N} ruft: „${text}“`);
      break;
    }

    case 'win': {
      const w = a.pid ? player(a.pid) : me;
      w.wins++;
      events.push({ kind: 'win', name: w.name, color: w.color });
      log(s, `🏆 ${w.name} hat gewonnen!${w.id !== pid ? ` (eingetragen von ${N})` : ''}`);
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
      const t = player(a.pid);
      if (t.id === pid) throw fail('Du kannst dich nicht selbst entfernen.');
      const back = shuffle(s.hands[t.id]);
      s.piles[deck.startPile].cards.unshift(...back);
      delete s.hands[t.id];
      s.players = s.players.filter((p) => p.id !== t.id);
      events.push({ kind: 'kicked', pid: t.id });
      log(s, `${N} entfernt ${t.name} aus dem Raum${back.length ? ` (${back.length} Karten zurück in den Stapel)` : ''}`);
      break;
    }

    default:
      throw fail('Unbekannte Aktion.');
  }
  return { events };
}

// Was ein bestimmter Spieler sehen darf. Fremde Handkarten und verdeckte Karten bleiben geheim.
export function viewFor(s, deck, pid) {
  const pub = (cid) => ({ id: cid, t: s.cards[cid].t });
  return {
    me: pid,
    deckId: s.deckId,
    started: s.started,
    round: s.round,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, host: p.host, color: p.color, connected: p.connected,
      wins: p.wins, revealed: p.revealed, count: (s.hands[p.id] || []).length,
      cards: p.revealed && p.id !== pid ? s.hands[p.id].map((cid) => ({ t: s.cards[cid].t })) : null,
    })),
    hand: (s.hands[pid] || []).map(pub),
    piles: deck.piles.map((d) => {
      const c = s.piles[d.id].cards;
      const top = c[c.length - 1];
      return { id: d.id, count: c.length, top: top && d.faceUp ? pub(top) : null };
    }),
    table: s.table.map((e) => {
      const up = s.cards[e.cid].up;
      return { id: e.cid, x: e.x, y: e.y, up, t: up ? s.cards[e.cid].t : null };
    }),
    log: s.log.slice(-50),
    undo: s.undo && s.undo.length ? s.undo[s.undo.length - 1].label : null,
  };
}
