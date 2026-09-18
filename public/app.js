const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => new Intl.NumberFormat('fr-CH').format(n ?? 0);
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const symbols = { s: '♠', h: '♥', d: '♦', c: '♣' };
const suitNames = { s: 'pique', h: 'cœur', d: 'carreau', c: 'trèfle' };
const phaseNames = { lobby: 'LA TABLE SE PRÉPARE', preflop: 'PRÉFLOP', flop: 'FLOP', turn: 'TURN', river: 'RIVER', results: 'RÉSULTATS', betting: 'À VOS MISES', playing: 'BLACKJACK', error: 'TABLE INTERROMPUE' };
const storage = {
  get(key, fallback = null, tab = false) { try { return JSON.parse((tab ? sessionStorage : localStorage).getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value, tab = false) { try { (tab ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); } catch { /* Private browsing can disallow storage. */ } }
};
let session = storage.get('cr-session', null, true), state = null, streamControl = null;
const ui = { game: 'poker', busy: false, connected: false, serverOffset: 0, raise: 40, bet: 100, knownCards: new Set(), freshCards: new Set(), lastHand: '', tutorialCallback: null, sound: storage.get('cr-sound', false), info: null };
let audio;

function id() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
}
function card(c, extra = '') {
  if (c === 'empty') return '<span class="card empty" aria-label="Carte commune à venir">♠</span>';
  if (!c) return '<span class="card back" aria-label="Carte cachée">♠</span>';
  const rank = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[c.rank] ?? c.rank;
  const symbol = symbols[c.suit] ?? '♠';
  return `<span class="card ${c.suit === 'h' || c.suit === 'd' ? 'red' : ''} ${extra} ${ui.freshCards.has(c.id) ? 'fresh' : ''}" aria-label="${esc(rank)} de ${esc(suitNames[c.suit])}"><span class="corner">${esc(rank)}<small>${symbol}</small></span><span class="suit-center">${symbol}</span><span class="corner bottom">${esc(rank)}<small>${symbol}</small></span></span>`;
}
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  $('#toasts').append(el); setTimeout(() => el.remove(), 5000);
}
function sound(kind = 'card') {
  if (!ui.sound) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume(); const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(kind === 'turn' ? 620 : 380, audio.currentTime);
    gain.gain.setValueAtTime(0.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.13);
    osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + 0.14);
  } catch { /* Sound is optional and must never affect a game. */ }
}
function status(online, text) {
  ui.connected = online;
  $('#connection').classList.toggle('off', !online);
  $('#connection').innerHTML = `<i></i>${esc(text ?? (online ? 'Serveur connecté' : 'Reconnexion…'))}`;
}
function profile(name) {
  $('#profile-name').textContent = name || 'Joueur';
  $('#profile-initial').textContent = (name || 'J')[0].toUpperCase();
}
function nickname() {
  const name = $('#nickname').value.trim().slice(0, 18);
  if (name.length < 2) { $('#nickname').focus(); toast('Choisis un pseudo d’au moins 2 caractères.', true); return null; }
  storage.set('cr-name', name); profile(name); return name;
}
async function api(route, data, { token = session?.token, timeout = 7000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`/api/${route}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal, cache: 'no-store'
    });
    const json = await response.json();
    if (!response.ok) { const error = new Error(json.error || 'Une erreur est survenue.'); error.status = response.status; throw error; }
    return json;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Le serveur met trop de temps à répondre. Vérifie la connexion.');
    if (error instanceof TypeError) throw new Error('Serveur inaccessible. Vérifie qu’il est toujours lancé.');
    throw error;
  } finally { clearTimeout(timer); }
}
function saveSession(value) { session = value; storage.set('cr-session', value, true); }
function acceptState(next) {
  if (!session || next.you !== session.id) return;
  if (state?.code === next.code && next.version < state.version) return;
  const old = state;
  const handKey = `${next.code}:${next.handId}`;
  if (handKey !== ui.lastHand) { ui.lastHand = handKey; ui.knownCards.clear(); }
  const visible = [...next.board, ...next.dealerCards, ...next.players.flatMap(p => p.cards)].filter(Boolean);
  ui.freshCards = new Set(visible.filter(c => !ui.knownCards.has(c.id)).map(c => c.id));
  visible.forEach(c => ui.knownCards.add(c.id));
  state = next; ui.serverOffset = next.serverNow - Date.now();
  if (old && next.turn === next.you && (old.turn !== next.you || old.handId !== next.handId)) sound('turn');
  else if (old && ui.freshCards.size) sound();
  status(true); renderGame();
}
function disconnectStream() { streamControl?.abort(); streamControl = null; }
async function connectStream() {
  disconnectStream();
  const token = session?.token; if (!token) return;
  const control = new AbortController(); streamControl = control;
  let failures = 0;
  while (!control.signal.aborted && session?.token === token) {
    const attempt = new AbortController();
    const abort = () => attempt.abort(); control.signal.addEventListener('abort', abort, { once: true });
    let lastMessage = Date.now();
    const watchdog = setInterval(() => { if (Date.now() - lastMessage > 26000) attempt.abort(); }, 5000);
    try {
      const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` }, signal: attempt.signal, cache: 'no-store' });
      if (response.status === 401) { resetSession(); toast('La session a expiré ou le serveur a redémarré. Rejoins une nouvelle table.', true); break; }
      if (!response.ok || !response.body) throw new Error('Flux inaccessible');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      failures = 0; status(true);
      while (!control.signal.aborted) {
        const { done, value } = await reader.read(); if (done) break;
        lastMessage = Date.now(); buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const event = packet.match(/^event: (.+)$/m)?.[1];
          const data = packet.match(/^data: (.+)$/m)?.[1];
          if (event === 'state' && data) acceptState(JSON.parse(data));
          if (event === 'expired' || event === 'replaced') {
            resetSession(); toast(event === 'expired' ? 'Cette table a expiré.' : 'Cette place est ouverte dans un autre onglet. Utilise une autre session pour un autre joueur.', true); break;
          }
        }
      }
    } catch { /* A fresh snapshot will arrive after reconnecting. */ }
    finally { clearInterval(watchdog); control.signal.removeEventListener('abort', abort); attempt.abort(); }
    if (control.signal.aborted || session?.token !== token) break;
    status(false); if (state) renderActions();
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, 600 * ++failures)));
  }
}
function resetSession() {
  disconnectStream(); saveSession(null); state = null; ui.busy = false;
  $('#game').hidden = true; $('#home').hidden = false;
  history.replaceState({}, '', location.pathname); status(false, 'Pas de table active');
}
async function begin(mode, skipTutorial = false) {
  if (ui.busy || session) return;
  const name = nickname(); if (!name) return;
  if (!skipTutorial && !storage.get(`cr-help-${ui.game}`)) {
    ui.tutorialCallback = () => begin(mode, true); showHelp(ui.game); return;
  }
  ui.busy = true; $('#home').classList.add('busy');
  try {
    const result = await api('create', { name, game: ui.game, solo: mode === 'solo', bots: Number($('#bot-count').value) }, { token: null });
    saveSession({ token: result.token, id: result.id, code: result.code });
    acceptState(result.state); history.replaceState({}, '', `?table=${result.code}`); connectStream();
  } catch (e) { toast(e.message, true); }
  finally { ui.busy = false; $('#home').classList.remove('busy'); if (state) { renderActions(); renderSidebar(); } }
}
async function command(type, extra = {}) {
  if (!state || ui.busy || !ui.connected) return;
  ui.busy = true; renderActions();
  const msg = { type, actionId: id(), handId: state.handId, turnSeq: state.turnSeq, ...extra };
  try {
    try { await api('action', msg); }
    catch (e) { if (e.status) throw e; await api('action', msg); } // Same ID makes a retry idempotent.
    if (session) acceptState(await api('state'));
  } catch (e) {
    toast(e.message, true);
    try { if (session) acceptState(await api('state')); } catch { status(false); }
  } finally { ui.busy = false; if (state) { renderActions(); renderSidebar(); } }
}
function choose(game) {
  ui.game = game;
  for (const b of $$('[data-do="select-game"]')) { const on = b.dataset.game === game; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); }
  $('#solo-button').innerHTML = `${game === 'poker' ? 'Jouer contre les robots' : 'Défier le croupier'} <span>↗</span>`;
  $('#bot-count').disabled = game !== 'poker';
  $('.solo-choice label').textContent = game === 'poker' ? 'POUR S’ENTRAÎNER' : 'EN SOLO';
}
function renderGame() {
  $('#home').hidden = true; $('#game').hidden = false;
  const poker = state.game === 'poker';
  $('#game-title').innerHTML = `${poker ? 'Texas Hold’em' : 'Blackjack'} <span>${poker ? 'NO LIMIT · 10/20' : 'CROUPIER · S17'}</span>`;
  $('#hand-number').textContent = `MAIN #${state.handId}`;
  const you = state.players.find(p => p.id === state.you); if (you) profile(you.name);
  renderTable(); renderActions(); renderSidebar(); countdown();
}
function renderTable() {
  const s = state, poker = s.game === 'poker';
  const you = s.players.find(p => p.id === s.you); if (!you) return;
  const others = s.players.filter(p => p.id !== you.id).sort((a, b) => ((a.seat - you.seat + 5) % 6) - ((b.seat - you.seat + 5) % 6));
  const map = [[], [3], [2, 4], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5]][others.length];
  const slots = [you, null, null, null, null, null]; others.forEach((p, i) => { slots[map[i]] = p; });
  const positions = window.innerWidth <= 600 ? [[50, 84], [16, 68], [16, 23], [50, 12], [84, 23], [84, 68]] : [[50, 83], [15, 68], [17, 25], [50, 13], [83, 25], [85, 68]];
  const seats = slots.map((p, i) => {
    const [x, y] = positions[i], position = `left:${x}%;top:${y}%`;
    if (!p) return `<div class="seat empty-seat" style="${position}"><span class="empty-avatar">＋</span>PLACE LIBRE</div>`;
    const self = p.id === s.you, current = s.turn === p.id;
    let text = current ? (self ? 'À TOI DE JOUER' : 'À SON TOUR') : p.lastAction || (p.bot ? 'Robot prêt' : p.connected ? 'Prêt à jouer' : 'Reconnexion…');
    if (!p.inHand && !['lobby', 'results'].includes(s.phase)) text = 'Prochaine main';
    if (!p.connected && !p.bot) text = 'Déconnecté';
    if (s.phase === 'results' && p.inHand) text = p.result || 'Main terminée';
    const cards = p.cards.length ? p.cards.map(c => card(c)).join('') : '';
    const mobile = window.innerWidth <= 600;
    const cardWidth = self ? (mobile ? 43 : 51) : (mobile ? 26 : 34);
    const maxWidth = self ? (mobile ? 134 : 165) : (mobile ? 94 : 113);
    const overlap = p.cards.length > 2 ? Math.max(0, (cardWidth * p.cards.length - maxWidth) / (p.cards.length - 1)) : 0;
    return `<div class="seat ${self ? 'self' : ''} ${current ? 'is-turn' : ''} ${p.folded ? 'is-folded' : ''} ${!p.connected ? 'is-offline' : ''}" style="${position}">
      ${self && p.cards.length ? '<span class="self-label">TA MAIN</span>' : ''}<div class="seat-cards ${p.cards.length > 2 ? 'crowded' : ''}" style="--card-overlap:-${overlap}px">${cards}</div>
      ${!poker && p.bjTotal !== null ? `<span class="bj-total">${p.bjTotal}</span>` : ''}
      <div class="seat-info"><span class="avatar tone-${p.seat}">${esc(p.name[0].toUpperCase())}</span><div><div class="seat-name">${esc(p.name)}${self ? '<small>TOI</small>' : ''}</div><div class="seat-stack">◉ ${fmt(p.stack)}</div></div>${poker && s.dealerSeat === p.seat && s.handId ? '<span class="dealer-button" title="Bouton du donneur">D</span>' : ''}${poker && p.streetBet && !['lobby', 'results'].includes(s.phase) ? `<span class="seat-bet">◉ ${fmt(p.streetBet)}</span>` : ''}</div><div class="seat-status">${esc(text)}</div></div>`;
  }).join('');
  let center;
  if (s.phase === 'lobby' || s.phase === 'betting') {
    center = `<div class="table-center-lobby"><span>${poker ? '♠' : '21'}</span><h2>${s.phase === 'betting' ? 'À vos mises.' : 'Prenez place.'}</h2><p>${s.phase === 'betting' ? 'Choisis tes jetons. Le croupier s’occupe du reste.' : poker ? 'Une bonne main commence<br>avec de la bonne compagnie.' : 'La table est prête.<br>Le croupier vous attend.'}</p></div>`;
  } else {
    const cards = poker ? [...s.board, ...Array(5 - s.board.length).fill('empty')] : s.dealerCards;
    center = `<div class="community"><div class="board-label">${poker ? 'CARTES COMMUNES' : `CROUPIER${s.dealerTotal !== null ? ` · ${s.dealerTotal}` : ' · RESTE À 17'}`}</div><div class="community-cards">${cards.map(c => card(c)).join('')}</div><div class="pot-label"><span>${poker ? 'POT TOTAL' : 'MISES À LA TABLE'}</span><b>${fmt(s.pot)}</b></div></div>`;
  }
  const turnPlayer = s.players.find(p => p.id === s.turn);
  $('#arena').innerHTML = `<div class="phase-tag"><i></i>${phaseNames[s.phase] ?? ''}</div><div class="arena-corner">${s.solo ? 'ENTRAÎNEMENT SOLO' : 'TABLE PRIVÉE'} · ${s.players.length}/6</div><div class="live-table"><div class="live-felt"><div class="table-watermark"><b>♠</b>CLUB ROYAL</div></div></div>${center}<div class="table-deck">${card(null)}</div><div class="table-chip-stack"><i class="chip gold">100</i></div>${seats}<div class="turn-pill">${s.deadline ? `<b data-countdown></b><span>${turnPlayer ? `À ${esc(turnPlayer.name)} de jouer` : 'Pour miser'}</span>` : '<span>LE PLAISIR DU JEU. RIEN D’AUTRE.</span>'}</div>`;
}
function btn(label, type, cls = 'btn-outline', extra = '') {
  return `<button class="btn ${cls}" data-do="action" data-type="${type}" ${ui.busy || !ui.connected ? 'disabled' : ''} ${extra}>${label}</button>`;
}
function renderActions() {
  if (!state) return;
  const s = state, p = s.players.find(x => x.id === s.you), poker = s.game === 'poker'; if (!p) return;
  const host = s.ownerId === p.id, between = ['lobby', 'results'].includes(s.phase);
  if (!ui.connected) { $('#actions').innerHTML = '<div class="waiting-copy"><span>↻</span><div><b>Reconnexion à la table…</b><small>Ta place est conservée temporairement. Les actions sont désactivées.</small></div></div>'; return; }
  if (s.phase === 'error') { $('#actions').innerHTML = '<div class="waiting-copy"><span>!</span><div><b>Cette table a rencontré un problème.</b><small>Retourne au salon et crée une nouvelle partie.</small></div></div>'; return; }
  if (between) {
    const result = s.results.find(x => x.id === p.id);
    const broke = p.stack < (poker ? 1 : 10);
    const sufficient = s.players.filter(x => !x.leaving && (x.connected || x.bot) && x.stack >= (poker ? 1 : 10)).length >= (poker ? 2 : 1);
    const title = result ? `${result.net > 0 ? 'Bien joué.' : result.net === 0 ? 'On remet ça ?' : 'Une autre main ?'} <span class="${result.net > 0 ? 'net-win' : result.net < 0 ? 'net-loss' : ''}">${signed(result.net)}</span>` : 'Tout le monde est là ?';
    const detail = result ? `${esc(result.label)} · ${fmt(result.payout)} jetons rendus, mise comprise.` : poker ? 'Il faut au moins deux joueurs. Tu peux ajouter des robots.' : 'Chaque joueur affronte le croupier, à la même table.';
    $('#actions').innerHTML = `<div class="result-line"><div><h3>${title}</h3><p>${detail}${broke ? '<br>Recharge gratuitement pour reprendre la partie.' : ''}</p></div><div class="result-controls">${broke ? btn('Recharge gratuite', 'refill', 'btn-light') : ''}${host && sufficient ? btn(s.handId ? 'Main suivante →' : 'Distribuer les cartes →', 'start', 'btn-gold') : host ? btn('Ajouter un robot ＋', 'addBot', 'btn-gold', s.players.length >= 6 ? 'disabled' : '') : '<span class="action-hint">En attente de l’hôte pour distribuer.</span>'}</div></div>`;
    return;
  }
  if (s.phase === 'betting') {
    if (!p.inHand || p.betReady) { $('#actions').innerHTML = `<div class="waiting-copy"><span>◉</span><div><b>${p.bjBet ? `Mise de ${fmt(p.bjBet)} confirmée` : 'Tu attends la prochaine distribution'}</b><small>Les autres joueurs choisissent leurs mises. <span data-countdown></span></small></div></div>`; return; }
    const max = Math.min(200, Math.floor(p.stack / 10) * 10); ui.bet = Math.max(10, Math.min(ui.bet, max));
    $('#actions').innerHTML = `<div class="action-topline"><span class="action-caption"><i class="gold-dot"></i> Combien mises-tu ?</span><span class="timer-badge" data-countdown></span></div><div class="action-buttons"><div class="bet-chips">${[10, 50, 100, 200].map(n => `<button class="bet-chip ${ui.bet === n ? 'selected' : ''}" data-do="bet-size" data-amount="${n}" ${n > max || ui.busy ? 'disabled' : ''}>${n}</button>`).join('')}</div><input class="bet-amount" id="bet-amount" type="number" min="10" max="${max}" step="10" value="${ui.bet}" aria-label="Mise en jetons">${btn(`Miser ${fmt(ui.bet)}`, 'bet', 'btn-gold', 'id="bet-submit"')}${btn('Passer', 'skip', 'btn-outline no-grow')}</div>`;
    return;
  }
  if (!s.legal) {
    let title = 'Un instant, la table joue.';
    if (p.folded) title = 'Tu t’es couché. Observe la suite.';
    else if (p.allIn) title = 'Tu es à tapis. Les cartes décideront.';
    else if (!p.inHand) title = 'Tu joueras à la prochaine main.';
    else if (!poker && p.lastAction) title = p.lastAction === 'Dépasse 21' ? 'Tu as dépassé 21.' : 'Ta décision est enregistrée.';
    const actor = s.players.find(x => x.id === s.turn);
    $('#actions').innerHTML = `<div class="waiting-copy"><span>${poker ? '♠' : '♣'}</span><div><b>${title}</b><small>${actor ? `C’est au tour de ${esc(actor.name)}.` : 'La main se termine.'}${s.yourCombination ? ` Ta combinaison : ${esc(s.yourCombination)}.` : ''}</small></div></div>`; return;
  }
  const l = s.legal;
  let controls;
  if (poker) {
    ui.raise = Math.min(l.maxRaise, Math.max(l.minRaise, ui.raise));
    controls = `${btn('Se coucher', 'fold', 'btn-outline')}${l.check ? btn('Parole', 'check', 'btn-light') : btn(`Suivre ${fmt(l.call)}`, 'call', 'btn-light')}${l.raise && l.maxRaise >= l.minRaise ? btn('Relancer', 'raise', 'btn-gold') : ''}${l.allIn ? btn(`Tapis · ${fmt(p.stack)}`, 'allin', 'btn-outline no-grow') : ''}`;
    if (l.raise && l.maxRaise >= l.minRaise) controls += `</div><div class="raise-row"><label for="raise-amount">RELANCE TOTALE</label><input id="raise-slider" type="range" min="${l.minRaise}" max="${l.maxRaise}" step="1" value="${ui.raise}" aria-label="Montant total de la relance"><input id="raise-amount" type="number" min="${l.minRaise}" max="${l.maxRaise}" step="1" value="${ui.raise}" aria-label="Relance totale en jetons"><button class="quick-bet" data-do="pot-raise">Pot</button>`;
  } else controls = `${btn('Tirer ＋', 'hit', 'btn-gold')}${btn('Rester', 'stand', 'btn-light')}${l.double ? btn(`Doubler · +${fmt(p.bjBet)}`, 'double', 'btn-outline') : ''}`;
  $('#actions').innerHTML = `<div class="action-topline"><span class="action-caption"><i class="gold-dot"></i> À toi de jouer <span class="timer-badge" data-countdown></span></span><span class="action-hint">${poker ? esc(s.yourCombination || 'Deux cartes. À toi de choisir.') : `Ta main : ${p.bjTotal} · Objectif : 21 maximum`}</span></div><div class="action-buttons">${controls}</div>`;
}
function renderSidebar() {
  const s = state, host = s.you === s.ownerId, between = ['lobby', 'results'].includes(s.phase);
  const members = s.players.map(p => `<div class="member"><span class="avatar tone-${p.seat}">${esc(p.name[0].toUpperCase())}</span><div class="member-name">${esc(p.name)}${p.id === s.you ? ' · toi' : ''}<small>${p.bot ? 'Robot d’entraînement' : p.leaving ? 'A quitté la table' : !p.connected ? 'Déconnecté' : p.id === s.ownerId ? 'Hôte de la table' : 'À la table'}</small></div><span class="member-stack">${fmt(p.stack)}</span></div>`).join('');
  $('#sidebar').innerHTML = `<div class="sidebar-panel invite-panel"><div class="sidebar-title">${s.solo ? 'MODE ENTRAÎNEMENT' : 'INVITE TES AMIS'}<span>↗</span></div><div class="room-code">${s.solo ? 'SOLO' : s.code}</div>${s.solo ? '<p class="subtle-note">Une table pour t’entraîner.<br>Crée une table privée pour jouer avec ta classe.</p>' : '<button class="btn btn-outline invite-button" data-do="invite">Copier l’invitation ↗</button><p class="subtle-note">Même serveur. Même code. Même table.</p>'}</div><div class="sidebar-panel members-panel"><div class="sidebar-title">À LA TABLE <span>${s.players.length} / 6 JOUEURS</span></div><div class="members-list">${members}</div>${host && between ? `<div class="bot-buttons">${s.players.length < 6 ? btn('＋ Robot', 'addBot', 'btn-outline') : ''}${s.players.some(p => p.bot) ? btn('− Robot', 'removeBot', 'btn-outline') : ''}</div>` : ''}</div><div class="sidebar-panel history-panel"><div class="sidebar-title">LE FIL DE LA PARTIE <span>↺</span></div><ul class="history">${(s.logs.length ? s.logs.slice(-5) : ['La table est ouverte.', 'Installe-toi, la partie va commencer.']).map(log => `<li>${esc(log)}</li>`).join('')}</ul></div><button class="sidebar-help" data-do="help"><span>?</span><div><b>Un doute sur une règle ?</b><small>Le guide en 30 secondes ↗</small></div></button>`;
}
function countdown() {
  if (!state) return;
  const seconds = Math.max(0, Math.ceil((state.deadline - Date.now() - ui.serverOffset) / 1000));
  for (const el of $$('[data-countdown]')) el.textContent = `${seconds}s`;
}
function modal(html) {
  $('#modal-content').innerHTML = `<div class="modal-inner"><button class="modal-close" data-do="close" aria-label="Fermer">×</button>${html}</div>`;
  if (!$('#modal').open) $('#modal').showModal();
}
function closeModal() { $('#modal').close(); ui.tutorialCallback = null; }
function showHelp(game = state?.game || ui.game) {
  const poker = game === 'poker';
  const steps = poker ? [
    ['Deux cartes, rien que pour toi.', 'Tu reçois 2 cartes privées. Jusqu’à 5 cartes communes arrivent au centre : 3 au flop, 1 au turn, 1 à la river.'],
    ['Tu suis, tu relances… ou tu bluffes.', 'Parole = ne rien ajouter si personne n’a misé. Suivre = égaler la mise. Relancer = miser davantage. Se coucher = abandonner cette main.'],
    ['La meilleure main gagne.', 'Fais la meilleure combinaison de 5 cartes parmi tes 2 cartes et les 5 communes. Tu gagnes aussi si tous les autres se couchent.']
  ] : [
    ['Le but : battre le croupier.', 'Rapproche-toi de 21, sans le dépasser. À plusieurs, chacun joue contre le croupier, pas contre ses amis.'],
    ['Compte tes cartes.', 'Les figures valent 10. L’As vaut 1 ou 11. Un As et une carte valant 10 dès la distribution, c’est un blackjack.'],
    ['Une décision très simple.', 'Tirer = une carte de plus. Rester = garder ta main. Doubler = doubler ta mise et recevoir une dernière carte.']
  ];
  const names = ['Quinte flush royale', 'Quinte flush', 'Carré', 'Full', 'Couleur', 'Quinte', 'Brelan', 'Double paire', 'Paire', 'Carte haute'];
  modal(`<div class="modal-eyebrow">LE GUIDE EN 30 SECONDES</div><h2>Facile à apprendre.<br>Encore mieux à plusieurs.</h2><div class="modal-tabs"><button class="${poker ? 'selected' : ''}" data-do="help-tab" data-game="poker">♠ Poker</button><button class="${!poker ? 'selected' : ''}" data-do="help-tab" data-game="blackjack">21 Blackjack</button></div>${steps.map((step, i) => `<div class="tutorial-step"><span>${i + 1}</span><div><h3>${step[0]}</h3><p>${step[1]}</p></div></div>`).join('')}<div class="rule-note">${poker ? '<strong>À cette table :</strong> 2 000 jetons au départ, blindes 10/20, no limit. Les tapis et pots secondaires sont gérés. Pas de prélèvement sur le pot. À court de jetons ? La recharge est gratuite entre les mains.' : '<strong>À cette table :</strong> 1 000 jetons au départ. Mises de 10 à 200. Gain ordinaire 1:1, blackjack 3:2. Le croupier reste sur tous les 17. Dépasser 21 fait perdre immédiatement, même si le croupier dépasse ensuite.'}</div><details class="rules-details"><summary>${poker ? 'Voir les combinaisons et règles détaillées' : 'Voir les règles détaillées'}</summary>${poker ? `<ol class="rank-list">${names.map((n, i) => `<li><b>${String(i + 1).padStart(2, '0')}</b>${n}</li>`).join('')}</ol><p>Du plus fort au plus faible. L’As peut être bas dans A–2–3–4–5. Une couleur = cinq cartes de la même enseigne. Un full = brelan + paire. Les égalités partagent le pot ; les jetons impairs vont d’abord au gagnant à gauche du bouton. Une relance courte à tapis ne rouvre pas forcément les relances. En duel, le bouton pose la petite blinde et agit en premier avant le flop.</p><p>25 secondes par tour : parole automatique si possible, sinon coucher. Les nouveaux arrivants attendent la prochaine main. Les cartes des joueurs couchés ne sont pas révélées. Les robots n’utilisent ni les cartes adverses ni celles à venir.</p>` : '<p>Six paquets mélangés avant chaque main, aucun joker. Deux cartes au joueur, une carte cachée au croupier. Vérification immédiate du blackjack du croupier. Un blackjack naturel bat un 21 en trois cartes. Double autorisé seulement sur les deux premières cartes et avec assez de jetons. Pas de séparation, d’assurance, d’abandon ni de mises annexes dans cette version.</p><p>30 secondes pour miser ; sans mise, tu passes cette main. 25 secondes par tour ; à expiration, tu restes. Égalité : mise rendue. Le montant rendu comprend toujours la mise de départ. Pas de manipulation des cartes ni de taux de victoire imposé.</p>'}</details><button class="btn btn-gold wide" data-do="tutorial-done" data-game="${game}">C’est compris, on joue →</button><p class="subtle-note">Jetons fictifs uniquement. Aucune valeur monétaire.</p>`);
}
async function showInvite() {
  if (!state) return;
  if (state.solo) { toast('Cette table est solo. Crée une table privée depuis le salon pour inviter tes amis.'); return; }
  try { ui.info ??= await api('info'); } catch { /* The current origin remains a useful fallback. */ }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const base = ui.info?.publicBaseUrl || (local ? ui.info?.lan?.[0] : null) || location.origin;
  const link = `${base}/?table=${state.code}`;
  modal(`<div class="modal-eyebrow">IL RESTE UNE PLACE POUR TES AMIS</div><h2>La table, c’est vous.</h2><p>Ils ouvrent le même site, puis saisissent ce code. Ou partage directement le lien d’invitation.</p><div class="room-code">${state.code}</div><button class="btn btn-gold wide" data-do="copy-code">Copier le code</button><label class="modal-label" for="invite-link">LIEN D’INVITATION</label><div class="invite-url"><input id="invite-link" value="${esc(link)}" readonly><button class="btn btn-outline btn-small" data-do="copy-link">Copier</button></div><div id="copy-status" class="copy-status"></div><div class="rule-note">L’adresse réseau proposée doit être accessible depuis les autres appareils. Le même Wi-Fi ne garantit pas que le réseau de l’école autorise les connexions entre PC.<br>Un code seul ne rend pas ce serveur accessible sur Internet.</div>`);
}
async function copy(value) {
  let copied = false;
  try { await navigator.clipboard.writeText(value); copied = true; } catch {
    // Clipboard API is unavailable on plain-HTTP LAN addresses in some browsers.
    const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
    ($('#modal').open ? $('#modal-content') : document.body).append(input); input.select();
    try { copied = document.execCommand('copy'); } catch { /* Leave selectable URL visible. */ } input.remove();
  }
  const message = copied ? 'Copié ! Tu peux l’envoyer à tes amis.' : 'Sélectionne le texte du lien, puis copie-le manuellement.';
  if ($('#copy-status')) $('#copy-status').textContent = message; else toast(message);
}
function showJoin(code = '') {
  if (session) return;
  modal(`<div class="modal-eyebrow">RETROUVE TA TABLE</div><h2>Le code, et c’est parti.</h2><p>L’hôte te partage un code de six caractères. Tu rejoindras sa table de poker ou de blackjack.</p><form id="join-form"><label class="modal-label" for="join-name">TON PSEUDO</label><input id="join-name" class="modal-input" required minlength="2" maxlength="18" value="${esc($('#nickname').value)}" autocomplete="nickname" placeholder="Ton pseudo"><label class="modal-label" for="join-code">CODE DE LA TABLE</label><input id="join-code" class="modal-input code-input" required minlength="6" maxlength="6" value="${esc(code)}" placeholder="ABC123" autocomplete="off" autocapitalize="characters" spellcheck="false"><div class="form-error" id="join-error"></div><button class="btn btn-gold wide" type="submit">Rejoindre la table →</button></form>`);
  setTimeout(() => (code && !$('#join-name').value ? $('#join-name') : $('#join-code'))?.focus(), 100);
}
async function showNetwork() {
  try { ui.info = await api('info'); } catch {}
  modal(`<div class="modal-eyebrow">TOUT LE MONDE À LA MÊME TABLE</div><h2>Comment se connecter ?</h2><div class="tutorial-step"><span>1</span><div><h3>Un seul PC lance le serveur.</h3><p>Décompresse le ZIP, puis ouvre LANCER.cmd. Node.js 22 ou plus récent doit être installé. Garde cette fenêtre ouverte.</p></div></div><div class="tutorial-step"><span>2</span><div><h3>Les autres ouvrent son adresse.</h3><p>Utilise une adresse réseau du PC hôte. « localhost » désigne toujours ton propre appareil, pas celui de ton ami.</p></div></div>${(ui.info?.lan || []).map(a => `<code class="network-address">${esc(a)}</code>`).join('')}<div class="tutorial-step"><span>3</span><div><h3>Un code commun.</h3><p>L’hôte crée une table et partage son code. Les autres la rejoignent. En cas de blocage, demande l’autorisation au responsable informatique de l’école.</p></div></div><div class="rule-note">Le réseau réel de ton école n’a pas été testé avec cette application. À distance sur Internet, il faut héberger le serveur Node.js sur une adresse publique ; un hébergement de fichiers statiques ne suffit pas. Le serveur conserve les parties en mémoire : un redémarrage les efface.</div><button class="btn btn-gold wide" data-do="close">Compris</button>`);
}
function goHome() {
  if (!session) { $('#nickname').focus(); return; }
  modal('<div class="modal-eyebrow">QUITTER LA TABLE</div><h2>Tu nous quittes déjà ?</h2><p>Tu perdras ta place et tes jetons de cette session. Une mise déjà engagée reste dans la main en cours. Tu pourras créer ou rejoindre une autre table ensuite.</p><div class="action-buttons"> <button class="btn btn-outline" data-do="close">Rester à la table</button><button class="btn btn-gold" data-do="confirm-leave">Retour au salon</button></div>');
}

document.addEventListener('click', async event => {
  const el = event.target.closest('[data-do]'); if (!el || el.disabled) return;
  const act = el.dataset.do;
  if (act === 'home') goHome();
  else if (act === 'select-game') choose(el.dataset.game);
  else if (act === 'solo' || act === 'create') begin(act);
  else if (act === 'join') showJoin();
  else if (act === 'help') { ui.tutorialCallback = null; showHelp(); }
  else if (act === 'help-tab') showHelp(el.dataset.game);
  else if (act === 'close') closeModal();
  else if (act === 'tutorial-done') {
    storage.set(`cr-help-${el.dataset.game}`, true);
    const cb = ui.tutorialCallback; $('#modal').close(); ui.tutorialCallback = null; cb?.();
  } else if (act === 'confirm-leave') {
    el.disabled = true;
    try { await api('leave', {}); resetSession(); closeModal(); status(true, 'Serveur disponible'); }
    catch (e) { if (e.status === 401) { resetSession(); closeModal(); } else { toast(e.message, true); el.disabled = false; } }
  } else if (act === 'action') {
    const type = el.dataset.type;
    if (type === 'raise') command('raise', { amount: Number($('#raise-amount')?.value) });
    else if (type === 'bet') command('bet', { amount: Number($('#bet-amount')?.value) });
    else if (type === 'skip') command('bet', { amount: 0 });
    else command(type);
  } else if (act === 'bet-size') { ui.bet = Number(el.dataset.amount); renderActions(); }
  else if (act === 'pot-raise') { ui.raise = Math.min(state.legal.maxRaise, Math.max(state.legal.minRaise, state.legal.currentBet + state.pot)); renderActions(); }
  else if (act === 'invite') showInvite();
  else if (act === 'copy-code') copy(state.code);
  else if (act === 'copy-link') copy($('#invite-link').value);
  else if (act === 'network') showNetwork();
  else if (act === 'sound') {
    ui.sound = !ui.sound; storage.set('cr-sound', ui.sound); updateSound(); sound('turn');
    toast(ui.sound ? 'Sons activés.' : 'Sons désactivés.');
  } else if (act === 'fullscreen') {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { toast('Le plein écran n’est pas disponible sur ce navigateur.'); }
  } else if (act === 'profile') { if (!state) $('#nickname').focus(); else toast('Ton pseudo est fixé pour cette table. Tu peux le changer pour la prochaine depuis le salon.'); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'nickname') { storage.set('cr-name', e.target.value); profile(e.target.value); }
  if (e.target.id === 'raise-slider' || e.target.id === 'raise-amount') {
    ui.raise = Number(e.target.value);
    const other = e.target.id === 'raise-slider' ? $('#raise-amount') : $('#raise-slider'); if (other) other.value = ui.raise;
  }
  if (e.target.id === 'bet-amount') {
    ui.bet = Number(e.target.value); if ($('#bet-submit')) $('#bet-submit').textContent = `Miser ${fmt(ui.bet)}`;
    $$('.bet-chip').forEach(b => b.classList.toggle('selected', Number(b.dataset.amount) === ui.bet));
  }
  if (e.target.id === 'join-code') e.target.value = e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase();
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'join-form') return;
  e.preventDefault(); if (ui.busy) return;
  const name = $('#join-name').value.trim(), code = $('#join-code').value.trim().toUpperCase();
  ui.busy = true; const submit = $('button[type=submit]', e.target); submit.disabled = true;
  try {
    const result = await api('join', { name, code }, { token: null });
    storage.set('cr-name', name); $('#nickname').value = name;
    saveSession({ token: result.token, id: result.id, code: result.code }); closeModal();
    acceptState(result.state); history.replaceState({}, '', `?table=${result.code}`); connectStream();
  } catch (error) { if ($('#join-error')) $('#join-error').textContent = error.message; }
  finally { ui.busy = false; submit.disabled = false; if (state) { renderActions(); renderSidebar(); } }
});
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal(); } });
$('#modal').addEventListener('cancel', () => { ui.tutorialCallback = null; });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state) { ui.freshCards.clear(); renderTable(); } }, 150); });
window.addEventListener('online', () => { if (session && !ui.connected) connectStream(); });
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && session) { try { acceptState(await api('state')); } catch { status(false); } } });
function updateSound() { $('.sound-off').hidden = ui.sound; $('#sound-toggle').setAttribute('aria-label', ui.sound ? 'Désactiver les sons' : 'Activer les sons'); $('#sound-toggle').title = ui.sound ? 'Désactiver les sons' : 'Activer les sons'; }

$('#nickname').value = storage.get('cr-name', ''); profile($('#nickname').value); updateSound();
$('#preview-board').innerHTML = [{ rank: 12, suit: 'h' }, { rank: 11, suit: 'c' }, { rank: 10, suit: 'd' }, 'empty', 'empty'].map(c => card(c)).join('');
$('#hero-hand').innerHTML = [{ rank: 14, suit: 's' }, { rank: 13, suit: 'h' }].map(c => card(c)).join('');
setInterval(countdown, 250);
api('info', undefined, { token: null }).then(info => { ui.info = info; if (!session) status(true, 'Serveur disponible'); }).catch(() => { status(false, 'Serveur indisponible'); toast('Lance LANCER.cmd, puis ouvre l’adresse indiquée. Ce site ne se lance pas en ouvrant le fichier HTML.', true); });
if (session?.token && session?.id) connectStream();
else {
  const invite = new URLSearchParams(location.search).get('table');
  if (invite && /^[A-Z0-9]{6}$/i.test(invite)) showJoin(invite.toUpperCase());
}
