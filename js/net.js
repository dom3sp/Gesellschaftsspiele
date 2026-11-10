// Netzwerk über WebRTC (PeerJS). Kein eigener Server nötig:
// Der kostenlose PeerJS-Vermittlungsserver bringt die Browser nur zusammen,
// danach reden sie direkt miteinander.

/* global Peer */

const PREFIX = 'kartentisch-lea-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PEER_OPTS = { debug: 1 };
const TIMEOUT = 15000;

export function makeCode() {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(4))) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

export function normalizeCode(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

function safeSend(conn, msg) {
  try { if (conn && conn.open) conn.send(msg); } catch (e) { console.warn('send failed', e); }
}

// ---------------- Host ----------------
export class HostNet {
  // h: { ready(code), hello(conn, msg), action(pid, action), lost(pid), fatal(message) }
  constructor(code, h, { fixedCode = false } = {}) {
    this.h = h;
    this.fixed = fixedCode;
    this.conns = new Map();
    this.tries = 0;
    this.dead = false;
    this.opened = false;
    this.open(code);
    this.timer = setInterval(() => this.check(), 4000);
  }

  open(code) {
    if (this.dead) return;
    this.code = code;
    const peer = (this.peer = new Peer(PREFIX + code, PEER_OPTS));
    peer.on('open', () => {
      this.tries = 0;
      if (!this.opened) { this.opened = true; this.h.ready(code); }
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      // Verbindung zum Vermittlungsserver weg – neu verbinden, damit weitere Spieler beitreten können.
      setTimeout(() => { if (!this.dead && peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('error', (err) => {
      if (this.dead) return;
      if (err.type === 'unavailable-id' && !this.opened) {
        peer.destroy();
        this.tries++;
        if (this.fixed) {
          if (this.tries > 8) return this.h.fatal('Der Raum-Code ist noch belegt. Versuch es in einer Minute nochmal.');
          setTimeout(() => this.open(code), 2500);
        } else {
          this.open(makeCode());
        }
        return;
      }
      console.warn('Peer-Fehler', err.type, err);
      if (!this.opened && ['network', 'server-error', 'socket-error', 'browser-incompatible', 'ssl-unavailable'].includes(err.type)) {
        this.h.fatal('Konnte keinen Raum erstellen – keine Verbindung zum Vermittlungsserver.');
      }
    });
  }

  accept(conn) {
    conn.lastSeen = Date.now();
    conn.on('data', (msg) => {
      conn.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') this.h.hello(conn, msg);
      else if (msg.type === 'action' && conn.pid) this.h.action(conn.pid, msg.action);
    });
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  bind(pid, conn) {
    const old = this.conns.get(pid);
    if (old && old !== conn) { old.pid = null; try { old.close(); } catch {} }
    conn.pid = pid;
    this.conns.set(pid, conn);
  }

  unbind(pid) {
    const c = this.conns.get(pid);
    this.conns.delete(pid);
    if (c) { c.pid = null; setTimeout(() => { try { c.close(); } catch {} }, 400); }
  }

  drop(conn) {
    const pid = conn.pid;
    if (pid && this.conns.get(pid) === conn) {
      this.conns.delete(pid);
      conn.pid = null;
      this.h.lost(pid);
    }
  }

  check() {
    const now = Date.now();
    for (const conn of [...this.conns.values()]) {
      if (now - conn.lastSeen > TIMEOUT) { try { conn.close(); } catch {} this.drop(conn); }
      else safeSend(conn, { type: 'ping' });
    }
  }

  sendTo(pid, msg) { safeSend(this.conns.get(pid), msg); }
  broadcast(msg) { for (const c of this.conns.values()) safeSend(c, msg); }

  destroy() {
    this.dead = true;
    clearInterval(this.timer);
    try { this.peer.destroy(); } catch {}
  }
}

// ---------------- Mitspieler ----------------
export class ClientNet {
  // h: { welcome(msg), state(view), event(ev), reject(reason), error(message), failed(message), status('ok'|'lost') }
  constructor(code, token, name, h) {
    Object.assign(this, { code, token, name, h });
    this.dead = false;
    this.welcomed = false;
    this.lastSeen = Date.now();
    const peer = (this.peer = new Peer(PEER_OPTS));
    peer.on('open', () => this.connect());
    peer.on('disconnected', () => {
      setTimeout(() => { if (!this.dead && peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('error', (err) => {
      if (this.dead) return;
      console.warn('Peer-Fehler', err.type, err);
      if (err.type === 'peer-unavailable') {
        if (!this.welcomed) this.fail(`Raum „${code}“ wurde nicht gefunden. Stimmt der Code?`);
        else this.retry();
      } else if (!this.welcomed && ['network', 'server-error', 'socket-error', 'browser-incompatible'].includes(err.type)) {
        this.fail('Keine Verbindung zum Vermittlungsserver.');
      }
    });
    this.failT = setTimeout(() => { if (!this.welcomed) this.fail('Verbindung zum Raum hat nicht geklappt. Versuch es nochmal.'); }, 20000);
    this.timer = setInterval(() => this.tick(), 4000);
  }

  connect() {
    if (this.dead) return;
    const conn = (this.conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' }));
    conn.on('open', () => {
      this.lastSeen = Date.now();
      safeSend(conn, { type: 'hello', name: this.name, token: this.token });
    });
    conn.on('data', (msg) => {
      if (conn !== this.conn) return;
      this.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'welcome':
          this.welcomed = true;
          clearTimeout(this.failT);
          this.h.status('ok');
          this.h.welcome(msg);
          break;
        case 'state': this.h.state(msg.view); break;
        case 'event': this.h.event(msg.ev); break;
        case 'error': this.h.error(msg.message); break;
        case 'reject': this.destroy(); this.h.reject(msg.reason); break;
      }
    });
    conn.on('close', () => this.lost(conn));
    conn.on('error', () => this.lost(conn));
  }

  tick() {
    if (this.dead) return;
    if (this.conn && this.conn.open) safeSend(this.conn, { type: 'ping' });
    if (this.welcomed && this.conn && Date.now() - this.lastSeen > TIMEOUT) this.lost(this.conn);
  }

  lost(conn) {
    if (this.dead || conn !== this.conn) return;
    this.conn = null;
    try { conn.close(); } catch {}
    if (this.welcomed) { this.h.status('lost'); this.retry(); }
  }

  retry() {
    if (this.dead || this.retryT) return;
    this.retryT = setTimeout(() => {
      this.retryT = null;
      if (this.dead) return;
      if (this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
      this.connect();
    }, 3000);
  }

  fail(message) {
    if (this.dead) return;
    this.destroy();
    this.h.failed(message);
  }

  send(msg) {
    if (this.conn && this.conn.open) safeSend(this.conn, msg);
    else this.h.error('Gerade keine Verbindung – kurz warten.');
  }

  destroy() {
    this.dead = true;
    clearInterval(this.timer);
    clearTimeout(this.failT);
    clearTimeout(this.retryT);
    try { this.peer.destroy(); } catch {}
  }
}
