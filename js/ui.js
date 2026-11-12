// Gemeinsame UI-Helfer für alle Spiele (Dialoge, Meldungen, Speicher, Warteraum).

export const q = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Speicher (darf fehlschlagen, z. B. im privaten Modus) ----------
function area(kind) { try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; } }
export const store = {
  get(k, kind) { try { const v = area(kind)?.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v, kind) { try { area(kind)?.setItem(k, JSON.stringify(v)); } catch {} },
  del(k, kind) { try { area(kind)?.removeItem(k); } catch {} },
};

// ---------- Dialoge ----------
export function modal(html, bind) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'overlay modal';
  m.innerHTML = `<div class="dialog">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  document.body.appendChild(m);
  if (bind) bind(m);
  return m;
}
export function closeModal() { document.querySelectorAll('.modal').forEach((m) => m.remove()); }

export function listModal(title, items) {
  modal(`<h2>${esc(title)}</h2><div class="list">${items.map((it, i) => `<button class="btn list-btn ${it[2] || ''}" data-i="${i}">${esc(it[0])}</button>`).join('')}</div>
    <div class="row end"><button class="btn ghost" data-close>Schließen</button></div>`,
  (m) => m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeModal();
    items[Number(b.dataset.i)][1]();
  }));
}

export function confirmModal(title, text, ok) {
  modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
    <div class="row end"><button class="btn ghost" data-close>Abbrechen</button><button class="btn primary" data-ok>OK</button></div>`,
  (m) => { q('[data-ok]', m).onclick = () => { closeModal(); ok(); }; });
}

export function toast(text, kind = '') {
  const box = q('#toasts');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ---------- Warteraum (vor Spielbeginn) ----------
export function lobbyHtml({ title, view, minPlayers, maxPlayers, code, isHost }) {
  const v = view;
  return `<div class="overlay"><div class="dialog lobby">
    <h2>${esc(title)}</h2>
    <p class="muted">Warte auf Mitspieler (${minPlayers}–${maxPlayers} Spieler)</p>
    <p class="label">Raum-Code</p>
    <div class="bigcode">${esc(code)}</div>
    <button class="btn" data-act="copy">Einladungslink kopieren</button>
    <ul class="plist">${v.players.map((p) => `<li style="--pc:${p.color}"><span class="dot"></span>${esc(p.name)}${p.host ? ' <span class="tag">Host</span>' : ''}${p.id === v.me ? ' <span class="muted">(du)</span>' : ''}</li>`).join('')}</ul>
    ${isHost
      ? `<button class="btn primary big" data-act="start">Spiel starten</button>
         ${v.players.length < minPlayers ? '<p class="muted small-text">Du kannst auch schon alleine starten – Mitspieler können später noch beitreten.</p>' : ''}`
      : '<p class="muted">Der Host startet das Spiel gleich.</p>'}
    <button class="btn ghost" data-act="leave">Raum verlassen</button>
  </div></div>`;
}

// ---------- Verlauf ein-/ausklappen ----------
// Breiter Bildschirm: Verlauf steht als Spalte daneben und lässt sich einklappen (wird gemerkt).
// Schmaler Bildschirm: Verlauf öffnet sich als Seitenleiste darüber.
const WIDE = '(min-width: 1100px)';
export function applyLog(ui) {
  const g = q('#game');
  if (!g) return;
  g.classList.toggle('log-open', !!ui.logOpen);
  g.classList.toggle('log-hidden', !!store.get('kt-log-hidden'));
}
export function toggleLog(ui) {
  if (window.matchMedia(WIDE).matches) {
    if (store.get('kt-log-hidden')) store.del('kt-log-hidden');
    else store.set('kt-log-hidden', true);
  } else {
    ui.logOpen = !ui.logOpen;
  }
  applyLog(ui);
}
