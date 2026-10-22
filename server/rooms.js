// Création, joueurs, réglages et nettoyage des rooms (en mémoire, une seule instance).
// viewFor() construit ce que chaque joueur a le droit de voir : jamais les réponses avant
// la phase de validation, jamais le rôle Loup d'un autre joueur, jamais les boucliers des autres.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 16;
const MAX_NAME = 16;
const MAX_QUESTION = 80;
const MAX_QUESTIONS_PER_PLAYER = 10;
const GRACE_MS = 45 * 1000;          // place gardée dans le lobby après une déconnexion
const EMPTY_MS = 15 * 60 * 1000;     // room vide supprimée après 15 min

// Laine des moutons : pastels bien distincts les uns des autres
const COLORS = [
  '#f7f3ea', '#f9c6d3', '#bfe6d0', '#cfc4f2', '#bcdcf7', '#ffd6b8', '#fbeaa5', '#e8c6ef',
  '#c9dbb4', '#f6b8b0', '#aee3e3', '#f2d9a6', '#d7d0c3', '#b9c4f0', '#ffc9e6', '#d4ecaa',
];

const OPTIONS = {
  hearts: [1, 2, 3, 4, 5],
  answerTime: [15, 20, 25, 30, 45, 60],
};

const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanName = s => cleanText(s, MAX_NAME);

function createStore({ now = () => Date.now(), rng = Math.random, categoryIds = [] } = {}) {
  const rooms = new Map();
  const pick = list => list[Math.floor(rng() * list.length)];

  function newCode() {
    let code;
    do { code = Array.from({ length: 4 }, () => pick(CODE_CHARS)).join(''); } while (rooms.has(code));
    return code;
  }

  function create() {
    const room = {
      code: newCode(), hostId: null, players: [],
      settings: { hearts: 3, answerTime: 25, wolf: false, categories: categoryIds.slice() },
      customQuestions: [], nextQuestionId: 1,
      phase: 'lobby', roundNo: 0, round: null, deck: [],
      wolfId: null, wolfRevealed: false, huntUsed: false, hunt: null, end: null,
      deadline: null, phaseMs: null, timer: null, emptySince: null,
    };
    rooms.set(room.code, room);
    return room;
  }

  const get = code => rooms.get(String(code || '').toUpperCase());
  const player = (room, id) => room.players.find(p => p.id === id);
  const connected = room => room.players.filter(p => p.connected);

  // Ajoute un joueur, ou lui rend sa place s'il revient (même id). Renvoie { player } ou { error }.
  function addPlayer(room, { id, name }) {
    let p = player(room, id);
    if (!p) {
      if (room.players.length >= MAX_PLAYERS) return { error: `La room est pleine (${MAX_PLAYERS} joueurs max).` };
      const used = new Set(room.players.map(x => x.color));
      const free = COLORS.filter(c => !used.has(c));
      p = {
        id, name, color: pick(free.length ? free : COLORS),
        // Arrivé en cours de partie : spectateur jusqu'à la prochaine
        inGame: false, hearts: 0, shields: 0, diedRound: null,
      };
      room.players.push(p);
    }
    if (name) p.name = name;
    p.connected = true;
    p.disconnectedAt = null;
    room.emptySince = null;
    if (!room.hostId) room.hostId = p.id;
    fixHost(room);
    return { player: p };
  }

  function removePlayer(room, id) {
    room.players = room.players.filter(p => p.id !== id);
    if (room.hostId === id) room.hostId = null;
    fixHost(room);
  }

  function disconnect(room, id) {
    const p = player(room, id);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = now();
    p.socketId = null;
    if (!connected(room).length) room.emptySince = now();
    fixHost(room);
  }

  // Si l'hôte n'est plus là, le joueur connecté suivant prend le relais
  function fixHost(room) {
    const host = player(room, room.hostId);
    if (host && host.connected) return;
    const list = room.players;
    const i = list.findIndex(p => p.id === room.hostId);
    for (let k = 1; k <= list.length; k++) {
      const p = list[(Math.max(i, 0) + k) % list.length];
      if (p.connected) { room.hostId = p.id; return; }
    }
    if (!host && list.length) room.hostId = list[0].id;
  }

  function applySettings(room, s = {}, validCategories = categoryIds) {
    const st = room.settings;
    for (const [k, allowed] of Object.entries(OPTIONS)) {
      if (k in s && allowed.includes(s[k])) st[k] = s[k];
    }
    if (typeof s.wolf === 'boolean') st.wolf = s.wolf;
    if (Array.isArray(s.categories)) st.categories = validCategories.filter(id => s.categories.includes(id));
  }

  // Questions proposées dans le lobby. Renvoie un message d'erreur ou null.
  function addQuestion(room, p, text) {
    const t = cleanText(text, MAX_QUESTION).replace(/[\u2014\u2013]/g, '-');
    if (t.length < 3) return 'Question trop courte.';
    if (room.customQuestions.filter(q => q.byId === p.id).length >= MAX_QUESTIONS_PER_PLAYER) {
      return `Maximum ${MAX_QUESTIONS_PER_PLAYER} questions par joueur.`;
    }
    if (room.customQuestions.some(q => q.text.toLowerCase() === t.toLowerCase())) return 'Cette question est déjà proposée.';
    room.customQuestions.push({ id: room.nextQuestionId++, text: t, byId: p.id, byName: p.name });
    return null;
  }

  function removeQuestion(room, p, qid) {
    const isHost = room.hostId === p.id;
    room.customQuestions = room.customQuestions.filter(q => !(q.id === qid && (q.byId === p.id || isHost)));
  }

  // Appelé régulièrement : retire les absents du lobby après le délai de grâce et les rooms vides.
  // En partie, un joueur déconnecté garde sa place (il perd des cœurs s'il ne répond pas).
  function sweep(onRemove = () => {}, onDelete = () => {}) {
    const t = now();
    for (const [code, room] of rooms) {
      if (room.emptySince && t - room.emptySince > EMPTY_MS) {
        onDelete(room);
        rooms.delete(code);
        continue;
      }
      if (!connected(room).length) continue;
      for (const p of room.players.slice()) {
        const gone = !p.connected && p.disconnectedAt && t - p.disconnectedAt > GRACE_MS;
        if (gone && (room.phase === 'lobby' || !p.inGame || p.hearts <= 0)) {
          removePlayer(room, p.id);
          onRemove(room, p.id);
        }
      }
    }
  }

  return { rooms, create, get, player, connected, addPlayer, removePlayer, disconnect, fixHost, applySettings, addQuestion, removeQuestion, sweep };
}

/* ---------- Vue envoyée à un joueur ---------- */

const isAlive = p => p.inGame && p.hearts > 0;

function viewFor(room, you, serverNow = Date.now()) {
  const me = room.players.find(p => p.id === you);
  const r = room.round;
  const phase = room.phase;
  const alive = room.players.filter(isAlive);

  const view = {
    code: room.code, you, hostId: room.hostId, phase,
    roundNo: room.roundNo, settings: room.settings,
    serverNow, deadline: room.deadline, phaseMs: room.phaseMs,
    players: room.players.map(p => ({
      id: p.id, name: p.name, color: p.color, connected: p.connected,
      inGame: p.inGame, hearts: p.hearts, alive: isAlive(p), diedRound: p.diedRound,
      // Le Loup n'est montré à tous qu'une fois démasqué, ou en fin de partie
      wolf: (room.wolfRevealed || phase === 'end') && p.id === room.wolfId,
    })),
    // Questions du lobby : on voit le texte des siennes, seulement le nombre pour les autres
    questions: {
      total: room.customQuestions.length,
      mine: room.customQuestions.filter(q => q.byId === you).map(q => ({ id: q.id, text: q.text })),
      byPlayer: Object.fromEntries(room.players.map(p => [p.id, room.customQuestions.filter(q => q.byId === p.id).length])),
    },
    huntAvailable: room.settings.wolf && !room.huntUsed && !room.wolfRevealed,
    me: me && {
      alive: isAlive(me),
      hearts: me.hearts,
      shields: me.shields,
      isWolf: room.wolfId === you && room.phase !== 'lobby',
    },
    round: null, hunt: null, end: null,
  };

  if (r) {
    const mine = r.answers.get(you);
    const round = {
      question: r.question,
      aliveCount: r.aliveIds.length,
      answered: [...r.answers.keys()],
      myAnswer: mine ? { text: mine.text, guess: mine.guess } : null,
    };
    // Validation : les groupes sans les auteurs ni la taille, pour garder le suspense
    if (r.groups && phase === 'validate') {
      round.groups = r.groups.map(g => ({ id: g.id, label: g.label, variants: g.variants.slice(0, 5), mine: g.members.includes(you) }));
      const pr = r.proposal;
      round.proposal = pr && {
        a: pr.a, b: pr.b, byName: pr.byName,
        yes: pr.yes.size, no: pr.no.size, needed: pr.needed,
        myVote: pr.yes.has(you) ? 'yes' : pr.no.has(you) ? 'no' : null,
      };
      round.merges = r.merges;
      round.ready = r.ready.size;
      round.iAmReady = r.ready.has(you);
    }
    // Révélation et résultats : tout est public, sauf les curseurs et les boucliers
    if (r.groups && (phase === 'reveal' || phase === 'results' || ((phase === 'hunt' || phase === 'huntResult' || phase === 'end') && r.outcome))) {
      round.groups = r.groups.map(g => ({ id: g.id, label: g.label, variants: g.variants.slice(0, 5), members: g.members.slice() }));
      round.winners = r.outcome.winners;
      round.allDifferent = r.outcome.allDifferent;
      round.noAnswer = r.outcome.noAnswer;
      if (phase === 'reveal' && r.outcome.wolfSolo && room.wolfId === you && !r.bite) {
        round.wolfPick = { candidates: r.aliveIds.filter(id => id !== you) };
      }
      if (phase === 'reveal' && room.wolfId === you && r.bite) round.wolfBit = r.bite;
      if (r.applied) {
        round.events = r.events.map(e => ({ playerId: e.playerId, kind: e.publicKind }));
        const mine = r.private.get(you);
        if (mine) round.private = mine;
      }
    }
    view.round = round;
  }

  if (room.hunt) {
    const h = room.hunt;
    view.hunt = {
      byName: h.byName,
      candidates: h.voterIds.slice(),
      voted: h.votes.size,
      voters: h.voterIds.length,
      myVote: h.votes.get(you) || null,
      canVote: h.voterIds.includes(you),
      result: phase === 'huntResult' ? h.result : null,
    };
  }

  if (phase === 'end' && room.end) view.end = room.end;
  return view;
}

module.exports = { createStore, viewFor, cleanText, cleanName, isAlive, MAX_PLAYERS, COLORS };
