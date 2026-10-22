// Moutons : client. Il affiche l'état envoyé par le serveur et lui transmet les actions du joueur.
// Aucune règle n'est décidée ici : le serveur fait foi.
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const { sheep: sheepSvg, wolf: wolfSvg, heart, shield } = window.Sheep;

  /* ---------- Stockage local (tout est optionnel) ---------- */
  const local = {
    get(k, d) { try { const v = localStorage.getItem('moutons.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('moutons.' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('moutons.' + k); } catch {} },
  };
  const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  // Identifiant permanent du joueur : c'est lui qui permet de retrouver sa place après un rechargement
  let myId = local.get('id');
  if (!myId) { myId = randomId(); local.set('id', myId); }

  /* ---------- Sons (Web Audio, doux) ---------- */
  let ac = null, muted = !!local.get('muted', false);
  function tone(f1, f2, dur, type = 'sine', vol = 0.08, delay = 0) {
    if (muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + delay;
      o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
    } catch {}
  }
  const sfx = {
    tick: () => tone(900, 800, 0.04, 'sine', 0.03),
    pop: (d = 0) => tone(500, 900, 0.12, 'sine', 0.06, d),
    send: () => tone(520, 780, 0.14, 'triangle', 0.08),
    baa: (d = 0) => { tone(420, 380, 0.35, 'sawtooth', 0.025, d); tone(424, 384, 0.35, 'triangle', 0.05, d); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.2, 'triangle', 0.09, i * 0.12)),
    lose: () => tone(330, 160, 0.5, 'triangle', 0.08),
    wolf: () => { tone(300, 600, 0.5, 'sawtooth', 0.03); tone(600, 280, 0.8, 'sawtooth', 0.03, 0.5); },
  };
  const muteBtn = $('#mute');
  const paintMute = () => {
    muteBtn.classList.toggle('off', muted);
    muteBtn.setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son');
  };
  muteBtn.onclick = () => { muted = !muted; local.set('muted', muted); paintMute(); if (!muted) sfx.pop(); };
  paintMute();

  /* ---------- Petits utilitaires d'affichage ---------- */
  const app = $('#app');
  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  const sheepOf = (p, opts = {}) => `<div class="sheep">${sheepSvg(p ? p.color : '#f7f3ea', { title: p && esc(p.name), ...opts })}</div>`;
  // n cœurs pleins, puis `empty` cœurs vides, puis `breaking` cœurs qui se brisent (perdus cette manche)
  const hearts = (n, empty = 0, breaking = 0) =>
    heart('full').repeat(Math.max(0, n)) + heart('empty').repeat(empty) + heart('full breaking').repeat(breaking);

  /* ---------- Connexion ---------- */
  const socket = io({ transports: ['websocket', 'polling'] });
  let S = null;           // dernier état reçu
  let info = null;        // infos fixes de la room (catégories, durées)
  let clockOffset = 0;    // décalage entre l'horloge du serveur et la nôtre
  const serverNow = () => Date.now() + clockOffset;
  const me = () => S && S.players.find(p => p.id === S.you);
  const playerById = id => S && S.players.find(p => p.id === id);
  const nameOf = id => (playerById(id) || { name: '?' }).name;
  const isHost = () => S && S.hostId === S.you;

  function rejoin() {
    const code = local.get('room');
    const name = local.get('name', '');
    if (code) socket.emit('join', { id: myId, name, code });
  }
  socket.on('connect', rejoin);

  socket.on('joined', data => {
    info = data;
    local.set('room', data.code);
    if (location.pathname !== '/' + data.code) history.replaceState(null, '', '/' + data.code);
  });
  socket.on('left', () => {
    local.del('room');
    S = null;
    history.replaceState(null, '', '/');
    show('home');
  });
  socket.on('fail', msg => {
    toast(msg);
    // Room disparue : on revient à l'accueil
    if (/n'existe pas/.test(msg)) { local.del('room'); if (!S) show('home'); }
  });
  socket.on('state', view => {
    clockOffset = view.serverNow - Date.now();
    const prev = S;
    S = view;
    render(prev);
  });

  /* ---------- Accueil ---------- */
  const nameInput = $('#nameInput');
  const codeInput = $('#codeInput');
  nameInput.value = local.get('name', '');
  const pathCode = location.pathname.slice(1).toUpperCase();
  if (/^[A-Z]{4}$/.test(pathCode)) codeInput.value = pathCode;
  $('#homeFlock').innerHTML = ['#bcdcf7', '#f7f3ea', '#f9c6d3'].map((c, i) => `<div class="sheep">${sheepSvg(c, { mood: i === 1 ? 'happy' : 'neutral' })}</div>`).join('');

  function readName() {
    const name = nameInput.value.trim();
    if (!name) { toast('Choisis un pseudo.'); nameInput.focus(); return null; }
    local.set('name', name);
    return name;
  }
  $('#homeForm').onsubmit = e => {
    e.preventDefault();
    // Entrée dans le champ code = rejoindre
    if (codeInput.value.trim().length === 4) return join();
    const name = readName();
    if (name) socket.emit('create', { id: myId, name });
  };
  function join() {
    const name = readName();
    const code = codeInput.value.trim().toUpperCase();
    if (!name) return;
    if (code.length !== 4) { toast('Le code fait 4 lettres.'); codeInput.focus(); return; }
    socket.emit('join', { id: myId, name, code });
  }
  $('#joinBtn').onclick = join;
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('#createBtn').onclick = e => { e.preventDefault(); const name = readName(); if (name) socket.emit('create', { id: myId, name }); };

  /* ---------- Rendu général ---------- */
  function show(view) { app.dataset.view = view; }

  function render(prev) {
    if (!S) return show('home');
    if (S.phase === 'lobby') { show('lobby'); renderLobby(); return; }
    show('game');
    renderGame(prev);
  }

  /* ---------- Lobby ---------- */
  $('#leaveBtn').onclick = () => socket.emit('leave');
  $('#shareBtn').onclick = async () => {
    const url = `${location.origin}/${S.code}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Moutons', text: 'Viens jouer à Moutons !', url });
      else { await navigator.clipboard.writeText(url); toast('Lien copié !'); }
    } catch {}
  };

  function chipsHtml(options, current, fmt) {
    return options.map(v => `<button type="button" class="chip ${v === current ? 'on' : ''}" data-v="${v}" ${isHost() ? '' : 'disabled'}>${fmt(v)}</button>`).join('');
  }

  function renderLobby() {
    const host = isHost();
    $('#lobbyCode').textContent = S.code;
    const players = S.players;
    $('#playerCount').textContent = `${players.length}/16`;
    $('#lobbyPlayers').innerHTML = players.map(p => `
      <div class="lp ${p.connected ? '' : 'off'} ${p.id === S.you ? 'me' : ''}">
        ${sheepOf(p, { mood: p.id === S.you ? 'happy' : 'neutral', crown: p.id === S.hostId })}
        <div class="lp-name">${esc(p.name)}</div>
        <div class="lp-badges">${p.id === S.hostId ? 'hôte' : ''}${S.questions.byPlayer[p.id] ? ` ✍️${S.questions.byPlayer[p.id]}` : ''}</div>
      </div>`).join('');
    const present = players.filter(p => p.connected).length;
    // 2 joueurs suffisent, 3 avec le Loup
    const min = S.settings.wolf ? 3 : 2;
    $('#lobbyHint').textContent = present < min
      ? `Encore ${plural(min - present, 'mouton', 'moutons')} pour lancer (${min} minimum${S.settings.wolf ? ' avec le Loup' : ''}).`
      : 'Le troupeau est prêt !';

    // Réglages : l'hôte modifie, les autres voient
    const st = S.settings;
    $('#settingsCard').classList.toggle('readonly', !host);
    $('#settingsNote').textContent = host ? '' : '(l\'hôte décide)';
    $('#heartsChips').innerHTML = chipsHtml([1, 2, 3, 4, 5], st.hearts, v => `${v} ❤️`);
    $('#timeChips').innerHTML = chipsHtml([15, 20, 25, 30, 45, 60], st.answerTime, v => `${v} s`);
    $('#catChips').innerHTML = (info ? info.categories : []).map(c =>
      `<button type="button" class="chip ${st.categories.includes(c.id) ? 'on' : ''}" data-cat="${c.id}" ${host ? '' : 'disabled'}>${c.emoji} ${esc(c.name)}</button>`).join('');
    const wolf = $('#wolfToggle');
    wolf.checked = st.wolf;
    wolf.disabled = !host;

    // Questions proposées
    $('#questionCount').textContent = S.questions.total ? `(${S.questions.total} au total)` : '';
    $('#myQuestions').innerHTML = S.questions.mine.map(q =>
      `<li><span>${esc(q.text)}</span><button type="button" data-qid="${q.id}" aria-label="Supprimer">×</button></li>`).join('');

    const start = $('#startBtn');
    start.hidden = !host;
    start.disabled = present < min;
    const hostName = (playerById(S.hostId) || {}).name;
    $('#startHint').textContent = host ? '' : `En attente de ${hostName || 'l\'hôte'} pour lancer la partie...`;
  }

  $('#heartsChips').onclick = e => { const b = e.target.closest('.chip'); if (b && isHost()) socket.emit('settings', { hearts: Number(b.dataset.v) }); };
  $('#timeChips').onclick = e => { const b = e.target.closest('.chip'); if (b && isHost()) socket.emit('settings', { answerTime: Number(b.dataset.v) }); };
  $('#catChips').onclick = e => {
    const b = e.target.closest('.chip');
    if (!b || !isHost()) return;
    const set = new Set(S.settings.categories);
    set.has(b.dataset.cat) ? set.delete(b.dataset.cat) : set.add(b.dataset.cat);
    socket.emit('settings', { categories: [...set] });
  };
  $('#wolfToggle').onchange = e => { if (isHost()) socket.emit('settings', { wolf: e.target.checked }); };
  $('#questionForm').onsubmit = e => {
    e.preventDefault();
    const input = $('#questionInput');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('addQuestion', { text });
    input.value = '';
  };
  $('#myQuestions').onclick = e => { const b = e.target.closest('[data-qid]'); if (b) socket.emit('removeQuestion', { id: Number(b.dataset.qid) }); };
  $('#startBtn').onclick = () => socket.emit('start');

  /* ---------- Partie ---------- */
  const gameView = $('.view-game');
  let lastKey = '';       // phase + manche déjà affichées (pour ne pas tout reconstruire)

  function renderGame(prev) {
    const key = `${S.roundNo}:${S.phase}`;
    const fresh = key !== lastKey;
    lastKey = key;
    gameView.dataset.phase = S.phase;
    renderTop();
    renderFlock();
    switch (S.phase) {
      case 'answer': renderAnswer(fresh); break;
      case 'validate': renderValidate(fresh); break;
      case 'reveal': renderReveal(fresh); break;
      case 'results': renderResults(fresh); break;
      case 'hunt': renderHunt(fresh); break;
      case 'huntResult': renderHuntResult(fresh); break;
      case 'end': renderEnd(fresh); break;
    }
    renderWolfOverlay();
    if (fresh) window.scrollTo({ top: 0 });
  }

  function renderTop() {
    $('#roundChip').textContent = S.phase === 'end' ? 'Fin de partie' : `Manche ${S.roundNo}`;
    const m = S.me;
    let html;
    if (!m || !m.alive) html = '<span>👻 Fantôme</span>';
    else {
      html = hearts(m.hearts, 0);
      for (let i = 0; i < m.shields; i++) html += shield();
    }
    if (m && m.isWolf) html += '<span class="role">🐺 Loup</span>';
    $('#myStatus').innerHTML = html;
  }

  function renderFlock() {
    const list = S.players.filter(p => p.inGame || p.connected);
    const answered = S.round && S.phase === 'answer' ? new Set(S.round.answered) : null;
    $('#flockBar').innerHTML = list.map(p => {
      const mood = !p.inGame ? 'sleep' : !p.alive ? 'ko' : answered && answered.has(p.id) ? 'happy' : 'neutral';
      const state = answered && p.alive ? (answered.has(p.id) ? 'done' : 'waiting') : '';
      return `<div class="fb ${state} ${p.alive ? '' : 'dead'} ${p.connected ? '' : 'off'} ${p.id === S.you ? 'me' : ''} ${p.wolf ? 'wolf' : ''}">
        ${sheepOf(p, { mood, halo: p.inGame && !p.alive })}
        <div class="fb-name">${p.wolf ? '🐺 ' : ''}${esc(p.name)}</div>
        <div class="fb-hearts">${p.inGame ? hearts(p.hearts, 0) : ''}</div>
      </div>`;
    }).join('');
  }

  /* ----- Chrono (barre en haut) ----- */
  let lastTickSec = null;
  function tickTimer() {
    const t = $('#timer'), fill = $('#timerFill');
    if (!S || !S.deadline || !S.phaseMs || S.phase === 'reveal') { t.classList.add('hidden'); }
    else {
      t.classList.remove('hidden');
      const left = Math.max(0, S.deadline - serverNow());
      fill.style.transform = `scaleX(${left / S.phaseMs})`;
      const urgent = left < 5000 && (S.phase === 'answer' || S.phase === 'hunt');
      t.classList.toggle('urgent', urgent);
      const sec = Math.ceil(left / 1000);
      if (urgent && sec !== lastTickSec && sec > 0) sfx.tick();
      lastTickSec = sec;
      if (S.phase === 'results' || S.phase === 'huntResult') {
        for (const el of document.querySelectorAll('#nextHint, #nextHint2')) el.textContent = `Suite dans ${sec} s`;
      }
    }
    requestAnimationFrame(tickTimer);
  }
  requestAnimationFrame(tickTimer);

  /* ----- Phase de réponse ----- */
  const answerInput = $('#answerInput');
  const guessInput = $('#guessInput');
  function updateGuessOut() {
    $('#guessOut').textContent = guessInput.value;
  }
  answerInput.addEventListener('input', () => {
    $('#charCount').textContent = `${answerInput.value.length}/${info ? info.maxAnswer : 30}`;
  });
  guessInput.addEventListener('input', updateGuessOut);

  function questionHtml(q) {
    return `<span class="cat">${esc(q.emoji)} ${esc(q.category)}</span><p class="q">${esc(q.text)}</p>`;
  }

  function renderAnswer(fresh) {
    const r = S.round;
    const alive = S.me && S.me.alive;
    $('.phase-answer').classList.toggle('spectator', !alive);
    if (fresh) {
      $('#questionCard').innerHTML = questionHtml(r.question);
      // On rejoue l'animation d'entrée de la carte
      const card = $('#questionCard');
      card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
      const max = Math.max(0, r.aliveCount - 1);
      guessInput.max = max;
      if (!r.myAnswer) {
        answerInput.value = '';
        guessInput.value = Math.min(1, max);
      }
      $('#charCount').textContent = `${answerInput.value.length}/${info ? info.maxAnswer : 30}`;
      sfx.baa();
      if (alive && matchMedia('(pointer: fine)').matches) setTimeout(() => answerInput.focus(), 300);
    }
    if (r.myAnswer && fresh) {
      answerInput.value = r.myAnswer.text;
      guessInput.value = r.myAnswer.guess;
    }
    updateGuessOut();
    $('#guessSub').textContent = `0 = personne, ${r.aliveCount - 1} = tous les autres. Pile juste : un bouclier 🛡️`;
    const sent = !!r.myAnswer;
    $('#answerForm').classList.toggle('sent', sent);
    $('#answerBtn').textContent = sent ? 'Modifier ma réponse' : 'Envoyer';
    $('#sentNote').textContent = sent ? `Envoyé : « ${r.myAnswer.text} ». Tu peux encore changer.` : '';
  }

  $('#answerForm').onsubmit = e => {
    e.preventDefault();
    const text = answerInput.value.trim();
    if (!text) { toast('Écris une réponse.'); return; }
    socket.emit('answer', { text, guess: Number(guessInput.value) });
    sfx.send();
    answerInput.blur();
  };

  /* ----- Validation (fusions) ----- */
  let selected = [];
  function renderValidate(fresh) {
    const r = S.round;
    if (fresh) selected = [];
    const ids = new Set(r.groups.map(g => g.id));
    selected = selected.filter(id => ids.has(id));
    const alive = S.me && S.me.alive;
    $('#validateQuestion').textContent = r.question.text;
    const host = isHost();
    const pending = r.proposals || [];
    const inRequest = new Set(pending.flatMap(pr => [pr.a, pr.b]));
    const labelOf = id => (r.groups.find(g => g.id === id) || {}).label;
    $('#groupList').innerHTML = r.groups.map(g => {
      const others = g.variants.filter(v => v !== g.label);
      return `<button type="button" class="group ${selected.includes(g.id) ? 'sel' : ''} ${inRequest.has(g.id) ? 'in-vote' : ''}" data-g="${g.id}">
        <span class="g-main"><span class="g-label">${esc(g.label)}</span>${others.length ? `<span class="g-variants">aussi : ${others.map(esc).join(', ')}</span>` : ''}</span>
        ${g.mine ? '<span class="g-mine">ta réponse</span>' : ''}
      </button>`;
    }).join('');
    $('#validateHint').textContent = host
      ? 'Tu es l\'hôte : touche deux réponses pour les fusionner, et tranche les demandes des joueurs.'
      : alive
        ? 'Faute de frappe, même idée ? Touche deux réponses et demande à l\'hôte de les fusionner.'
        : 'L\'hôte vérifie les réponses...';

    // Boutons d'action quand deux groupes sont choisis
    let actions = '';
    if (selected.length === 2) {
      if (host) actions = '<button type="button" class="btn secondary" id="hostMergeBtn">Fusionner</button>';
      else if (alive) actions = '<button type="button" class="btn primary" id="proposeBtn">Demander à l\'hôte</button>';
    }
    $('#mergeActions').innerHTML = actions;

    // Demandes en attente : l'hôte accepte ou refuse, les autres voient où ça en est
    const box = $('#proposal');
    box.classList.toggle('on', pending.length > 0);
    const hostName = (playerById(S.hostId) || {}).name || 'l\'hôte';
    box.innerHTML = pending.map(pr => `<div class="request">
        <p><b>${pr.mine ? 'Toi' : esc(pr.byName)}</b> : « ${esc(labelOf(pr.a))} » = « ${esc(labelOf(pr.b))} » ?</p>
        ${host ? `<div class="vote-row">
          <button type="button" class="btn yes" data-review="${pr.id}" data-accept="1">Oui, pareil</button>
          <button type="button" class="btn no" data-review="${pr.id}">Non</button>
        </div>` : `<div class="tally">En attente de ${esc(hostName)}...</div>`}
      </div>`).join('');

    $('#mergeLog').innerHTML = r.merges.map(m =>
      `<li>✓ « ${esc(m.labels[1])} » rejoint « ${esc(m.labels[0])} » <small>(par ${esc(m.byName)})</small></li>`).join('');
    const ready = $('#readyBtn');
    ready.hidden = !alive;
    ready.disabled = r.iAmReady;
    ready.textContent = r.iAmReady ? `Prêt ! (${r.ready}/${S.players.filter(p => p.alive && p.connected).length})` : 'C\'est bon pour moi';
  }

  $('#groupList').onclick = e => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    const id = b.dataset.g;
    if (selected.includes(id)) selected = selected.filter(x => x !== id);
    else { selected.push(id); if (selected.length > 2) selected.shift(); }
    sfx.pop();
    renderValidate(false);
  };
  $('#mergeActions').onclick = e => {
    if (selected.length !== 2) return;
    const [a, b] = selected;
    if (e.target.id === 'proposeBtn') socket.emit('propose', { a, b });
    if (e.target.id === 'hostMergeBtn') socket.emit('hostMerge', { a, b });
    selected = [];
  };
  $('#proposal').onclick = e => {
    const b = e.target.closest('[data-review]');
    if (b) socket.emit('reviewMerge', { id: Number(b.dataset.review), accept: b.dataset.accept === '1' });
  };
  $('#readyBtn').onclick = () => socket.emit('ready');

  /* ----- Révélation : les moutons se rangent en tas ----- */
  const INTRO_MS = 1500;
  let revealTimers = [];
  function clearReveal() { revealTimers.forEach(clearTimeout); revealTimers = []; }

  // Positions d'un tas en pyramide : rangées de plus en plus étroites
  function heapLayout(n) {
    const w = n <= 3 ? n : n <= 6 ? 3 : 4;
    const rows = [];
    let left = n, width = w;
    while (left > 0) { const take = Math.min(width, left); rows.push(take); left -= take; width = Math.max(1, width - 1); }
    const pos = [];
    rows.forEach((take, r) => { for (let j = 0; j < take; j++) pos.push({ x: j - (take - 1) / 2, y: r }); });
    return { pos, w, rows: rows.length };
  }

  function renderReveal(fresh) {
    if (!fresh) return;
    clearReveal();
    const r = S.round;
    const groups = r.groups.slice();
    const winners = new Set(r.winners);
    // Ordre d'apparition : du plus petit au plus gros (le plus gros à la fin, pour le suspense)
    const appear = groups.slice().sort((a, b) => a.members.length - b.members.length);
    const rank = new Map(appear.map((g, i) => [g.id, i]));
    // Disposition : le plus gros au centre, les autres de part et d'autre
    const layout = [];
    groups.forEach((g, i) => (i % 2 ? layout.unshift(g) : layout.push(g)));

    const per = info ? info.timing.revealPerGroup : 1100;
    const phaseStart = S.deadline - S.phaseMs;
    const elapsed = Math.max(0, serverNow() - phaseStart);
    const finalAt = INTRO_MS + groups.length * per;
    const width = Math.min(window.innerWidth, 520);
    const biggest = groups.reduce((m, g) => Math.max(m, g.members.length), 1);
    // Taille des moutons : on remplit la largeur (tous les tas sur une ligne si possible), entre 38 et 110 px
    // (chaque tas réserve au moins 1,6 mouton de large pour son étiquette)
    const units = groups.reduce((sum, g) => sum + Math.max(1.6, heapLayout(g.members.length).w * 0.72 + 0.4), 0);
    const s = Math.round(Math.max(38, Math.min(100, (width - 24 - 12 * groups.length) / units)));

    $('#stageQuestion').textContent = r.question.text;
    const banner = $('#stageBanner');
    banner.className = 'stage-banner intro';
    banner.textContent = 'Le troupeau se rassemble...';

    $('#piles').innerHTML = layout.map(g => {
      const d = (INTRO_MS + rank.get(g.id) * per - elapsed) / 1000;
      const { pos, w, rows } = heapLayout(g.members.length);
      const heapW = (w - 1) * s * 0.72 + s, heapH = (rows - 1) * s * 0.55 + s;
      const sheeps = g.members.map((id, k) => {
        const p = playerById(id), { x, y } = pos[k];
        return `<div class="ps" style="--d:${(d + 0.25 + k * 0.09).toFixed(2)}s;left:calc(50% - ${s / 2}px + ${(x * s * 0.72).toFixed(1)}px);bottom:${(y * s * 0.55).toFixed(1)}px;z-index:${10 - y}">
          ${sheepOf(p, { mood: 'neutral' })}</div>`;
      }).join('');
      const names = g.members.map(nameOf).map(esc).join(', ');
      return `<div class="pile" data-g="${g.id}" style="--s:${s}px;min-width:${Math.round(s * 1.5)}px">
        <div class="pile-label" style="--d:${d.toFixed(2)}s">${esc(g.label)} <span class="n">${g.members.length}</span></div>
        <div class="pile-heap" style="width:${heapW}px;height:${heapH}px">${sheeps}</div>
        <div class="pile-names" style="--d:${(d + 0.3).toFixed(2)}s;max-width:${Math.max(heapW, 90)}px">${names}</div>
      </div>`;
    }).join('');

    const sleepers = $('#sleepers');
    sleepers.style.setProperty('--d', `${(finalAt - elapsed) / 1000}s`);
    sleepers.innerHTML = r.noAnswer.length
      ? `${r.noAnswer.map(id => sheepOf(playerById(id), { mood: 'sleep' })).join('')}<span>Pas répondu : ${r.noAnswer.map(nameOf).map(esc).join(', ')}</span>`
      : '';

    // Sons calés sur l'apparition des tas
    appear.forEach((g, i) => {
      const at = INTRO_MS + i * per - elapsed;
      if (at > 0) revealTimers.push(setTimeout(() => { sfx.pop(); if (g.members.length > 1) sfx.baa(0.15); }, at));
    });

    // Final : le(s) plus gros tas grandissent, les autres pâlissent
    const final = () => {
      // Le gros tas grandit, sans sortir de l'écran
      const grow = s >= 80 || biggest >= 6 ? 1.12 : biggest >= 4 ? 1.2 : 1.3;
      document.querySelectorAll('#piles .pile').forEach(el => {
        const win = winners.has(el.dataset.g);
        el.style.setProperty('--grow', grow);
        el.classList.add(win ? 'win' : 'lose');
      });
      banner.className = 'stage-banner show ' + (winners.size ? 'win' : 'lose');
      if (r.allDifferent) banner.textContent = 'Aucun troupeau ! Tout le monde perd un cœur';
      else if (winners.size > 1) banner.textContent = `Ex aequo ! ${winners.size} troupeaux sauvés`;
      else if (winners.size === 1) {
        const g = groups.find(x => winners.has(x.id));
        banner.textContent = `Le troupeau : « ${g.label} »`;
      } else banner.textContent = 'Personne n\'a répondu...';
      const mine = groups.find(g => g.members.includes(S.you));
      if (mine && winners.has(mine.id)) sfx.win(); else if (S.me && S.me.alive) sfx.lose();
    };
    if (finalAt - elapsed <= 0) final();
    else revealTimers.push(setTimeout(final, finalAt - elapsed));
  }

  /* ----- Le Loup choisit sa victime ----- */
  function renderWolfOverlay() {
    const ov = $('#wolfOverlay');
    const pick = S.phase === 'reveal' && S.round && S.round.wolfPick;
    ov.hidden = !pick;
    if (!pick) return;
    $('#wolfOverlayIcon').innerHTML = wolfSvg({ glow: true });
    $('#biteTargets').innerHTML = pick.candidates.map(id => {
      const p = playerById(id);
      return `<button type="button" class="suspect" data-target="${id}">${sheepOf(p, { mood: 'wow' })}<span>${esc(p ? p.name : '?')}</span></button>`;
    }).join('');
  }
  $('#biteTargets').onclick = e => {
    const b = e.target.closest('[data-target]');
    if (!b) return;
    socket.emit('bite', { target: b.dataset.target });
    toast(`Tu vas croquer ${nameOf(b.dataset.target)}...`);
    sfx.wolf();
  };

  /* ----- Résultats de la manche ----- */
  const EVENT_TEXT = {
    minority: 'Hors du troupeau',
    allDifferent: 'Personne d\'accord',
    noAnswer: 'Pas de réponse',
    bite: 'Croqué par le Loup !',
    spared: 'Épargné... mystère 🛡️',
  };

  function renderResults(fresh) {
    if (!fresh) { renderResultButtons(); return; }
    clearReveal();
    const r = S.round;
    const winners = new Set(r.winners);
    $('#resultsQuestion').textContent = r.question.text;

    // Carte privée : ce que je suis seul à savoir
    const pv = r.private || {};
    const mine = r.groups.find(g => g.members.includes(S.you));
    const myEvents = r.events.filter(e => e.playerId === S.you);
    const lost = myEvents.filter(e => e.kind !== 'spared').length;
    const lines = [];
    if (S.round.aliveCount && S.players.find(p => p.id === S.you && p.inGame) && (mine || r.noAnswer.includes(S.you))) {
      if (!mine) lines.push('<div class="big">Tu n\'as pas répondu 😴</div>');
      else if (winners.has(mine.id)) lines.push(`<div class="big">Dans le troupeau ! 🐑</div>`);
      else lines.push(`<div class="big">${r.allDifferent ? 'Personne d\'accord...' : 'Hors du troupeau...'}</div>`);
      if (myEvents.some(e => e.kind === 'bite')) lines.push('<div class="line">🐺 Mais le Loup t\'a croqué !</div>');
      if (mine && pv.guess != null) {
        lines.push(`<div class="line">Ton pari : <b>${plural(pv.guess, 'mouton', 'moutons')}</b> avec toi. En vrai : <b>${pv.same}</b>.</div>`);
        if (pv.shieldGained) lines.push(`<div class="line">${shield()} Pile juste : bouclier gagné !</div>`);
      }
      if (pv.shieldUsed) lines.push(`<div class="line">${shield()} Ton bouclier t'a sauvé un cœur.</div>`);
      if (pv.wolfImmune) lines.push('<div class="line">🐺 Loup : tu ne perds pas de cœur hors du troupeau.</div>');
      if (pv.bit) lines.push(`<div class="line">🐺 Tu as croqué <b>${esc(nameOf(pv.bit))}</b>.</div>`);
    }
    const pc = $('#privateCard');
    pc.className = 'private-card ' + (lost ? 'bad' : lines.length ? 'good' : '');
    pc.innerHTML = lines.join('');

    // Bilan public : d'abord ceux qui perdent, puis les épargnés, puis le troupeau
    const inRound = [...r.groups.flatMap(g => g.members), ...r.noAnswer];
    const rows = inRound.map(id => {
      const p = playerById(id);
      const evs = r.events.filter(e => e.playerId === id);
      const losses = evs.filter(e => e.kind !== 'spared').length;
      const g = r.groups.find(x => x.members.includes(id));
      const text = evs.length ? evs.map(e => EVENT_TEXT[e.kind]).join(' + ') : 'Dans le troupeau';
      return { id, p, evs, losses, g, text, order: losses ? 0 : evs.length ? 1 : 2 };
    }).sort((a, b) => a.order - b.order);
    $('#events').innerHTML = rows.map((x, i) => `
      <li class="${x.order === 2 ? 'safe' : ''}" style="animation-delay:${i * 0.08}s">
        ${sheepOf(x.p, { mood: x.losses ? (x.p && !x.p.alive ? 'ko' : 'sad') : 'happy', halo: x.p && !x.p.alive })}
        <span class="ev-text">${esc(x.p ? x.p.name : '?')}<small>${esc(x.text)}${x.g ? ` · « ${esc(x.g.label)} »` : ''}</small></span>
        <span class="ev-hearts">${hearts(x.p ? x.p.hearts : 0, 0, x.losses)}</span>
      </li>`).join('');
    if (lost) setTimeout(sfx.lose, 300);
    renderResultButtons();
  }

  function renderResultButtons() {
    const canHunt = S.huntAvailable && S.me && S.me.alive && S.players.filter(p => p.alive).length > 2;
    $('#huntBtn').hidden = !canHunt;
    $('#nextBtn').hidden = !isHost();
  }
  $('#huntBtn').onclick = () => {
    if (confirm('Lancer le vote pour démasquer le Loup ? (une seule fois par partie, et si vous vous trompez, les votants perdent un cœur)')) socket.emit('hunt');
  };
  $('#nextBtn').onclick = () => socket.emit('next');

  /* ----- Démasquer le Loup ----- */
  function renderHunt(fresh) {
    const h = S.hunt;
    if (fresh) { $('#huntIcon').innerHTML = wolfSvg({ glow: true }); sfx.wolf(); }
    $('#huntHint').textContent = `${h.byName} a lancé la chasse au Loup. Majorité pour le démasquer, sinon les votants perdent un cœur.`;
    $('#suspects').innerHTML = h.candidates.filter(id => id !== S.you).map(id => {
      const p = playerById(id);
      return `<button type="button" class="suspect ${h.myVote === id ? 'on' : ''}" data-target="${id}" ${h.canVote ? '' : 'disabled'}>
        ${sheepOf(p, { mood: h.myVote === id ? 'wow' : 'neutral' })}<span>${esc(p ? p.name : '?')}</span></button>`;
    }).join('');
    $('#huntCount').textContent = `${h.voted}/${h.voters} ont voté${h.canVote ? '' : ' (tu regardes)'}`;
  }
  $('#suspects').onclick = e => {
    const b = e.target.closest('[data-target]');
    if (b) { socket.emit('huntVote', { target: b.dataset.target }); sfx.pop(); }
  };

  function renderHuntResult(fresh) {
    if (!fresh) { renderResultButtons(); return; }
    const res = S.hunt.result;
    let html;
    if (res.success) {
      const w = playerById(res.wolfId);
      html = `<div class="unmasked">${sheepOf(w, { mood: 'wow' })}${wolfSvg({ glow: true })}</div>
        <h2>${esc(w ? w.name : '?')} était le Loup !</h2><p class="hint center">Le troupeau l'a démasqué, il est éliminé.</p>`;
      sfx.win();
    } else {
      const d = res.designated && playerById(res.designated);
      const losers = res.events.filter(e => e.kind === 'hunt').map(e => nameOf(e.playerId));
      html = `<div class="wolf-icon">${wolfSvg()}</div>
        <h2>${d ? `Raté ! ${esc(d.name)} n'était pas le Loup` : 'Pas de majorité !'}</h2>
        <p class="hint center">${losers.length ? `Les votants perdent un cœur : ${losers.map(esc).join(', ')}` : 'Personne ne perd de cœur.'}</p>`;
      sfx.lose();
    }
    const max = Math.max(1, ...res.tally.map(t => t.n));
    html += `<div class="card"><div class="tally">${res.tally.map(t => {
      const p = playerById(t.id);
      return `<div class="tally-row">${sheepOf(p)}<span style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p ? p.name : '?')}</span><span class="bar"><i style="width:${(t.n / max) * 100}%"></i></span><b>${t.n}</b></div>`;
    }).join('') || '<p class="hint center">Aucun vote.</p>'}</div><p class="hint center">Il fallait ${res.needed} voix.</p></div>
    <div class="results-actions"><p class="hint center" id="nextHint2"></p></div>`;
    $('#huntResult').innerHTML = html;
  }

  /* ----- Fin de partie ----- */
  function renderEnd(fresh) {
    const e = S.end;
    const host = isHost();
    $('#replayBtn').hidden = !host;
    $('#lobbyBtn').hidden = !host;
    $('#endHint').textContent = host ? '' : 'L\'hôte peut relancer une partie.';
    if (!fresh) return;
    clearReveal();
    const winners = e.winners.map(playerById).filter(Boolean);
    const iWon = e.winners.includes(S.you);
    let title;
    if (e.tie) title = winners.length ? 'Égalité ! Les derniers moutons tombent ensemble' : 'Égalité !';
    else title = `${esc(winners[0] ? winners[0].name : '?')} est le dernier mouton !`;
    const wolf = e.wolfId && playerById(e.wolfId);
    const wolfWon = !e.tie && e.wolfId && e.winners[0] === e.wolfId;
    $('#endHero').innerHTML = `
      <div class="winners ${winners.length > 1 ? 'many' : ''}">${winners.map(p => sheepOf(p, { mood: 'happy', crown: true })).join('')}</div>
      <h2>${wolfWon ? `Le Loup ${esc(wolf.name)} a dévoré le troupeau !` : title}</h2>
      <p>${plural(e.rounds, 'manche', 'manches')}${iWon ? ' · Bravo, c\'est toi !' : ''}</p>
      ${wolf ? `<div class="end-wolf">${wolfSvg()}<span>Le Loup était <b>${esc(wolf.name)}</b></span></div>` : ''}`;
    // Classement : vivants d'abord (par cœurs), puis par manche d'élimination
    const ranked = S.players.filter(p => p.inGame).sort((a, b) =>
      (b.hearts - a.hearts) || ((b.diedRound || 999) - (a.diedRound || 999)));
    $('#ranking').innerHTML = ranked.map(p => `<li>${sheepOf(p, { mood: e.winners.includes(p.id) ? 'happy' : 'ko', crown: e.winners.includes(p.id) })}
      <span class="rk-name">${p.id === e.wolfId ? '🐺 ' : ''}${esc(p.name)}</span>
      <span class="rk-info">${p.hearts > 0 ? hearts(p.hearts, 0) : p.diedRound ? `tombé manche ${p.diedRound}` : ''}</span></li>`).join('');
    // Confettis pastel
    const colors = ['#ff8fb8', '#8ddcbf', '#b9a8f0', '#ffe08a', '#ffc4a3', '#9fd3ff'];
    $('#confetti').innerHTML = Array.from({ length: 70 }, (_, i) =>
      `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-duration:${2.5 + Math.random() * 2.5}s;animation-delay:${Math.random() * 1.5}s"></i>`).join('');
    iWon ? sfx.win() : sfx.baa();
  }
  $('#replayBtn').onclick = () => socket.emit('replay');
  $('#lobbyBtn').onclick = () => socket.emit('lobby');

  // Au premier chargement : retour direct dans la room si on y était
  if (!local.get('room')) show('home');
})();
