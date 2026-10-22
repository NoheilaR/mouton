// Logique d'une partie de Moutons : manches, validation des groupes, cœurs, boucliers, Loup.
// Le moteur ne connaît pas Socket.IO : il modifie la room et appelle onUpdate(room) après chaque étape chronométrée.
//
// Déroulé d'une manche :
//   answer (réponses secrètes) -> validate (fusions validées par l'hôte, 10 s) -> reveal (animation des tas)
//   -> results (cœurs perdus) -> manche suivante, ou hunt / huntResult (démasquer le Loup), ou end.
const { groupAnswers, mergeGroups } = require('./grouping');
const { buildDeck, shuffle } = require('./questions');
const { cleanText, isAlive } = require('./rooms');

const MIN_PLAYERS = 2;
const MIN_PLAYERS_WOLF = 3;     // à 2, le Loup serait immédiatement démasqué
const MAX_ANSWER = 30;
const VALIDATE_MS = 10000;
const PROPOSAL_MIN_MS = 6000;     // une demande de fusion laisse au moins 6 s à l'hôte pour trancher
const MAX_PROPOSALS = 12;
const REVEAL_BASE_MS = 4500;      // intro + final de la révélation
const REVEAL_PER_GROUP_MS = 1100; // chaque tas qui apparaît
const RESULTS_MS = 12000;
const HUNT_MS = 25000;
const HUNT_RESULT_MS = 9000;
const RELOAD_GRACE_MS = 5000;    // délai laissé à un joueur qui recharge sa page

const realClock = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) };

// Durée de la révélation : le client cale son animation dessus (même formule côté client)
const revealMs = groupCount => REVEAL_BASE_MS + REVEAL_PER_GROUP_MS * Math.min(groupCount, 10);

// Calcul pur du résultat d'une manche (sans toucher aux cœurs).
// groups : groupes finaux ; aliveIds : joueurs en vie ; wolfId : Loup vivant ou null.
function computeOutcome(groups, aliveIds, answeredIds, wolfId) {
  const answered = new Set(answeredIds);
  const max = groups.reduce((m, g) => Math.max(m, g.members.length), 0);
  const allDifferent = answered.size >= 2 && max === 1;
  const winners = allDifferent ? [] : groups.filter(g => g.members.length === max).map(g => g.id);
  const groupOf = id => groups.find(g => g.members.includes(id));
  const losses = [];      // { playerId, reason }
  const immune = [];      // Loup hors du troupeau : épargné
  for (const id of aliveIds) {
    if (!answered.has(id)) { losses.push({ playerId: id, reason: 'noAnswer' }); continue; }
    const g = groupOf(id);
    if (g && winners.includes(g.id)) continue;
    if (id === wolfId) { immune.push(id); continue; }
    losses.push({ playerId: id, reason: allDifferent ? 'allDifferent' : 'minority' });
  }
  const wg = wolfId && answered.has(wolfId) ? groupOf(wolfId) : null;
  const wolfSolo = !!wg && wg.members.length === 1;
  const noAnswer = aliveIds.filter(id => !answered.has(id));
  return { winners, allDifferent, losses, immune, wolfSolo, noAnswer };
}

function createEngine({ clock = realClock, rng = Math.random, categories = [], onUpdate = () => {} } = {}) {
  const player = (room, id) => room.players.find(p => p.id === id);
  const aliveIds = room => room.players.filter(isAlive).map(p => p.id);
  const connectedAlive = room => room.players.filter(p => isAlive(p) && p.connected).map(p => p.id);
  const randomOf = list => list[Math.floor(rng() * list.length)];

  // Un seul chrono de phase par room : programmer une étape annule la précédente
  function schedule(room, ms, fn) {
    if (room.timer) clock.clear(room.timer);
    room.timer = null;
    room.deadline = ms == null ? null : clock.now() + ms;
    room.phaseMs = ms;
    if (ms == null) return;
    room.timer = clock.set(() => { room.timer = null; fn(); onUpdate(room); }, ms);
  }

  function stop(room) {
    if (room.timer) clock.clear(room.timer);
    room.timer = null;
  }

  /* ---------- Début de partie ---------- */

  function start(room) {
    const present = room.players.filter(p => p.connected);
    if (present.length < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs connectés.`;
    if (room.settings.wolf && present.length < MIN_PLAYERS_WOLF) return `Le Loup demande au moins ${MIN_PLAYERS_WOLF} joueurs : désactive-le ou attends un mouton de plus.`;
    room.deck = buildDeck(categories, room.settings.categories, room.customQuestions, rng);
    if (!room.deck.length) return 'Aucune question : active au moins une catégorie ou propose des questions.';
    for (const p of room.players) {
      p.inGame = p.connected;
      p.hearts = p.inGame ? room.settings.hearts : 0;
      p.shields = 0;
      p.diedRound = null;
    }
    room.roundNo = 0;
    room.round = null;
    room.hunt = null;
    room.end = null;
    room.huntUsed = false;
    room.wolfRevealed = false;
    room.wolfId = room.settings.wolf ? randomOf(present).id : null;
    nextRound(room);
    return null;
  }

  function drawQuestion(room) {
    if (!room.deck.length) room.deck = buildDeck(categories, room.settings.categories, room.customQuestions, rng);
    return room.deck.shift();
  }

  /* ---------- Phase de réponse ---------- */

  function nextRound(room) {
    room.roundNo++;
    room.hunt = null;
    room.phase = 'answer';
    room.round = {
      question: drawQuestion(room),
      aliveIds: aliveIds(room),
      answers: new Map(),       // playerId -> { text, guess }
      groups: null,
      proposals: [], nextProposalId: 1, merges: [], ready: new Set(),
      outcome: null, bite: null, applied: false, events: [], private: new Map(),
    };
    schedule(room, room.settings.answerTime * 1000, () => endAnswers(room));
  }

  // Le joueur envoie (ou corrige) sa réponse et son curseur. Renvoie une erreur ou null.
  function answer(room, id, text, guess) {
    const r = room.round;
    if (room.phase !== 'answer' || !r.aliveIds.includes(id)) return null;
    const t = cleanText(text, MAX_ANSWER);
    if (!t) return 'Écris une réponse.';
    let g = Math.round(Number(guess));
    if (!Number.isFinite(g)) g = 0;
    g = Math.max(0, Math.min(r.aliveIds.length - 1, g));
    r.answers.set(id, { text: t, guess: g });
    // Tous les joueurs vivants et connectés ont répondu : on n'attend pas la fin du chrono
    if (connectedAlive(room).every(pid => r.answers.has(pid))) endAnswers(room);
    return null;
  }

  function endAnswers(room) {
    const r = room.round;
    if (room.phase !== 'answer') return;
    r.groups = groupAnswers([...r.answers].map(([playerId, a]) => ({ playerId, text: a.text })));
    // Une seule réponse possible ou personne n'a répondu : rien à fusionner
    if (r.groups.length < 2) return toReveal(room);
    room.phase = 'validate';
    schedule(room, VALIDATE_MS, () => toReveal(room));
  }

  /* ---------- Phase de validation (fusions) ---------- */

  const canAct = (room, id) => room.phase === 'validate' && room.round.aliveIds.includes(id) && !!player(room, id) && isAlive(player(room, id));

  // Un joueur vivant signale « on voulait dire la même chose » : sa demande attend la décision de l'hôte.
  // Plusieurs demandes peuvent attendre en même temps (une seule par paire de groupes).
  function proposeMerge(room, id, a, b) {
    const r = room.round;
    if (!canAct(room, id) || a === b || r.proposals.length >= MAX_PROPOSALS) return;
    if (!r.groups.some(g => g.id === a) || !r.groups.some(g => g.id === b)) return;
    if (r.proposals.some(pr => (pr.a === a && pr.b === b) || (pr.a === b && pr.b === a))) return;
    // L'hôte n'a pas besoin de se demander l'autorisation
    if (room.hostId === id) return doMerge(room, a, b, player(room, id).name);
    r.proposals.push({ id: r.nextProposalId++, a, b, byId: id, byName: player(room, id).name });
    r.ready.clear();
    // On laisse à l'hôte le temps de trancher
    const left = room.deadline - clock.now();
    if (left < PROPOSAL_MIN_MS) schedule(room, PROPOSAL_MIN_MS, () => toReveal(room));
  }

  // L'hôte accepte ou refuse une demande
  function reviewMerge(room, id, proposalId, accept) {
    const r = room.round;
    if (room.phase !== 'validate' || room.hostId !== id) return;
    const pr = r.proposals.find(x => x.id === proposalId);
    if (!pr) return;
    r.proposals = r.proposals.filter(x => x !== pr);
    if (accept) doMerge(room, pr.a, pr.b, pr.byName);
    tryEarlyReveal(room);
  }

  function doMerge(room, a, b, byName) {
    const r = room.round;
    const ga = r.groups.find(g => g.id === a), gb = r.groups.find(g => g.id === b);
    if (!ga || !gb) return;
    // Le groupe le plus gros garde son id et son libellé
    const [into, from] = ga.members.length >= gb.members.length ? [ga, gb] : [gb, ga];
    r.merges.push({ labels: [into.label, from.label], byName });
    mergeGroups(r.groups, into.id, from.id);
    // Les demandes qui visaient le groupe absorbé pointent maintenant vers le groupe fusionné
    for (const pr of r.proposals) {
      if (pr.a === from.id) pr.a = into.id;
      if (pr.b === from.id) pr.b = into.id;
    }
    r.proposals = r.proposals.filter(pr => pr.a !== pr.b);
    r.ready.clear();
  }

  // L'hôte fusionne directement deux groupes
  function hostMerge(room, id, a, b) {
    if (room.phase !== 'validate' || room.hostId !== id || a === b) return;
    doMerge(room, a, b, player(room, id).name);
  }

  // « C'est bon pour moi » : si tous les vivants connectés sont prêts et qu'aucune demande n'attend l'hôte, on révèle
  function ready(room, id) {
    const r = room.round;
    if (!canAct(room, id)) return;
    r.ready.add(id);
    tryEarlyReveal(room);
  }

  function tryEarlyReveal(room) {
    const r = room.round;
    if (room.phase === 'validate' && !r.proposals.length && connectedAlive(room).every(pid => r.ready.has(pid))) toReveal(room);
  }

  /* ---------- Révélation ---------- */

  function toReveal(room) {
    const r = room.round;
    r.proposals = [];
    // Groupes définitifs, du plus gros au plus petit
    r.groups.sort((x, y) => y.members.length - x.members.length);
    const wolf = room.wolfId && r.aliveIds.includes(room.wolfId) ? room.wolfId : null;
    r.outcome = computeOutcome(r.groups, r.aliveIds, [...r.answers.keys()], wolf);
    room.phase = 'reveal';
    // Durée fixe quoi que fasse le Loup, pour ne rien trahir
    schedule(room, revealMs(r.groups.length), () => toResults(room));
  }

  // Le Loup seul avec sa réponse choisit (en secret) le joueur qui perdra un cœur
  function wolfBite(room, id, targetId) {
    const r = room.round;
    if (room.phase !== 'reveal' || room.wolfId !== id || !r.outcome.wolfSolo || r.bite) return;
    if (targetId === id || !r.aliveIds.includes(targetId)) return;
    r.bite = targetId;
  }

  // Retire un cœur, ou un bouclier s'il y en a un. Renvoie true si le bouclier a servi.
  function hit(p) {
    if (p.shields > 0) { p.shields--; return true; }
    p.hearts = Math.max(0, p.hearts - 1);
    return false;
  }

  function toResults(room) {
    const r = room.round, o = r.outcome;
    if (o.wolfSolo && !r.bite) {
      // Pas de choix à temps : victime au hasard
      const others = r.aliveIds.filter(id => id !== room.wolfId);
      if (others.length) r.bite = randomOf(others);
    }
    const priv = id => {
      if (!r.private.has(id)) r.private.set(id, {});
      return r.private.get(id);
    };
    // 1. Pertes de la manche (boucliers d'abord)
    const hits = o.losses.map(l => ({ ...l }));
    if (r.bite) hits.push({ playerId: r.bite, reason: 'bite' });
    for (const h of hits) {
      const p = player(room, h.playerId);
      if (!p) continue;
      const shielded = hit(p);
      if (shielded) priv(p.id).shieldUsed = (priv(p.id).shieldUsed || 0) + 1;
      // Bouclier et immunité du Loup sont indiscernables pour les autres
      r.events.push({ playerId: p.id, reason: h.reason, publicKind: shielded ? 'spared' : h.reason });
    }
    for (const id of o.immune) {
      r.events.push({ playerId: id, reason: 'wolf', publicKind: 'spared' });
      priv(id).wolfImmune = true;
    }
    // 2. Curseurs : un curseur exact donne un bouclier pour une prochaine perte
    for (const [id, a] of r.answers) {
      const g = r.groups.find(x => x.members.includes(id));
      const same = g ? g.members.length - 1 : 0;
      const exact = a.guess === same;
      const p = player(room, id);
      Object.assign(priv(id), { guess: a.guess, same, exact });
      if (exact && p && p.hearts > 0) { p.shields++; priv(id).shieldGained = true; }
    }
    if (r.bite && room.wolfId) priv(room.wolfId).bit = r.bite;
    markDeaths(room);
    r.applied = true;
    room.phase = 'results';
    schedule(room, RESULTS_MS, () => afterRound(room));
  }

  function markDeaths(room) {
    for (const p of room.players) if (p.inGame && p.hearts <= 0 && p.diedRound == null) p.diedRound = room.roundNo;
  }

  // Fin de partie s'il reste 1 mouton (victoire) ou 0 (égalité entre les derniers tombés)
  function checkEnd(room) {
    const alive = room.players.filter(isAlive);
    if (alive.length > 1) return false;
    let winners, tie = false;
    if (alive.length === 1) winners = [alive[0].id];
    else {
      const last = Math.max(...room.players.filter(p => p.inGame).map(p => p.diedRound ?? 0));
      winners = room.players.filter(p => p.inGame && p.diedRound === last).map(p => p.id);
      tie = true;
    }
    stop(room);
    room.phase = 'end';
    room.deadline = null;
    room.end = { winners, tie, wolfId: room.wolfId, rounds: room.roundNo };
    return true;
  }

  function afterRound(room) {
    if (checkEnd(room)) return;
    nextRound(room);
  }

  // L'hôte passe les résultats sans attendre
  function skipResults(room, id) {
    if (room.hostId !== id) return;
    if (room.phase === 'results' || room.phase === 'huntResult') afterRound(room);
  }

  /* ---------- Démasquer le Loup ---------- */

  // Une fois par partie, un joueur vivant lance le vote pendant les résultats
  function startHunt(room, id) {
    const p = player(room, id);
    if (room.phase !== 'results' || !room.settings.wolf || room.huntUsed || room.wolfRevealed) return;
    if (!p || !isAlive(p)) return;
    if (checkEnd(room)) return;
    room.huntUsed = true;
    room.hunt = { byName: p.name, voterIds: aliveIds(room), votes: new Map(), result: null };
    room.phase = 'hunt';
    schedule(room, HUNT_MS, () => endHunt(room));
  }

  function huntVote(room, id, targetId) {
    const h = room.hunt;
    if (room.phase !== 'hunt' || !h.voterIds.includes(id)) return;
    if (targetId === id || !h.voterIds.includes(targetId)) return;
    h.votes.set(id, targetId);
    const waiting = h.voterIds.filter(v => player(room, v)?.connected && !h.votes.has(v));
    if (!waiting.length) endHunt(room);
  }

  function endHunt(room) {
    const h = room.hunt;
    if (room.phase !== 'hunt') return;
    const tally = new Map();
    for (const t of h.votes.values()) tally.set(t, (tally.get(t) || 0) + 1);
    // Majorité = plus de la moitié des joueurs vivants au moment du vote
    const needed = Math.floor(h.voterIds.length / 2) + 1;
    let designated = null;
    for (const [t, n] of tally) if (n >= needed) designated = t;
    const success = !!designated && designated === room.wolfId;
    const events = [];
    if (success) {
      const w = player(room, room.wolfId);
      if (w) w.hearts = 0;
      room.wolfRevealed = true;
      events.push({ playerId: room.wolfId, kind: 'unmasked' });
    } else {
      // Raté : tous les votants perdent un cœur (le bouclier protège, discrètement)
      for (const v of h.votes.keys()) {
        const p = player(room, v);
        if (p) events.push({ playerId: v, kind: hit(p) ? 'spared' : 'hunt' });
      }
    }
    markDeaths(room);
    h.result = {
      votes: [...h.votes].map(([from, to]) => ({ from, to })),
      tally: [...tally].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
      needed, designated, success,
      wolfId: success ? room.wolfId : null,
      events,
    };
    room.phase = 'huntResult';
    schedule(room, HUNT_RESULT_MS, () => afterRound(room));
  }

  /* ---------- Divers ---------- */

  function backToLobby(room, id) {
    if (room.hostId !== id || room.phase !== 'end') return;
    stop(room);
    room.phase = 'lobby';
    room.round = null; room.hunt = null; room.end = null; room.wolfId = null;
    room.deadline = null; room.phaseMs = null;
    for (const p of room.players) { p.inGame = false; p.hearts = 0; p.shields = 0; p.diedRound = null; }
  }

  // Un joueur quitte la room (ou est retiré après sa déconnexion)
  function playerRemoved(room, id) {
    const r = room.round;
    if (!r) return;
    if (room.phase === 'answer' && connectedAlive(room).length && connectedAlive(room).every(pid => r.answers.has(pid))) endAnswers(room);
    if (room.phase !== 'lobby' && room.phase !== 'end') checkEnd(room);
  }

  // Une déconnexion pendant la phase de réponse ne doit pas bloquer les autres,
  // mais on laisse quelques secondes à celui qui recharge simplement sa page
  function playerDisconnected(room) {
    const r = room.round;
    if (room.phase !== 'answer' || !r) return;
    const roundNo = room.roundNo;
    clock.set(() => {
      if (room.phase !== 'answer' || room.roundNo !== roundNo) return;
      const waiting = connectedAlive(room);
      if (waiting.length && waiting.every(pid => r.answers.has(pid))) { endAnswers(room); onUpdate(room); }
    }, RELOAD_GRACE_MS);
  }

  return {
    start, answer, proposeMerge, reviewMerge, hostMerge, ready, wolfBite, startHunt, huntVote,
    skipResults, backToLobby, playerRemoved, playerDisconnected,
    // exposés pour les tests
    endAnswers, toReveal, toResults, endHunt,
  };
}

module.exports = {
  createEngine, computeOutcome, revealMs, MIN_PLAYERS, MIN_PLAYERS_WOLF, MAX_ANSWER,
  VALIDATE_MS, RESULTS_MS, HUNT_MS, HUNT_RESULT_MS, REVEAL_BASE_MS, REVEAL_PER_GROUP_MS,
};
