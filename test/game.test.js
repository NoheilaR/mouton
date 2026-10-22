const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine, computeOutcome, revealMs, VALIDATE_MS, RESULTS_MS, HUNT_RESULT_MS } = require('../server/game');
const { createStore, viewFor } = require('../server/rooms');

// Horloge factice : les chronos avancent à la demande
function fakeClock() {
  let t = 1000, timers = [];
  return {
    now: () => t,
    set(fn, ms) { const h = { at: t + ms, fn }; timers.push(h); return h; },
    clear(h) { timers = timers.filter(x => x !== h); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const n = timers[0];
        if (!n || n.at > end) break;
        timers.shift(); t = n.at; n.fn();
      }
      t = end;
    },
  };
}

const categories = [{ id: 'test', name: 'Test', emoji: '', questions: Array.from({ length: 30 }, (_, i) => `Question ${i + 1}`) }];

function setup(names = ['A', 'B', 'C', 'D'], settings = {}, rng = () => 0) {
  const clock = fakeClock();
  const store = createStore({ now: clock.now, categoryIds: ['test'] });
  const engine = createEngine({ clock, rng, categories });
  const room = store.create();
  for (const name of names) store.addPlayer(room, { id: name, name });
  store.applySettings(room, { hearts: 3, answerTime: 25, ...settings });
  return { clock, store, engine, room, p: id => store.player(room, id) };
}

const hearts = room => Object.fromEntries(room.players.map(p => [p.id, p.hearts]));

// Joue une manche complète jusqu'aux résultats
function playRound(ctx, answers) {
  const { engine, room, clock } = ctx;
  for (const [id, [text, guess]] of Object.entries(answers)) engine.answer(room, id, text, guess);
  if (room.phase === 'answer') clock.advance(room.settings.answerTime * 1000);
  if (room.phase === 'validate') clock.advance(VALIDATE_MS);
  assert.equal(room.phase, 'reveal');
  clock.advance(revealMs(room.round.groups.length));
  assert.equal(room.phase, 'results');
}

test('il faut au moins 3 joueurs connectés pour lancer', () => {
  const { engine, room } = setup(['A', 'B']);
  assert.match(engine.start(room), /au moins 3/);
  assert.equal(room.phase, 'lobby');
});

test('les réponses ne sont jamais envoyées avant la validation', () => {
  const ctx = setup();
  ctx.engine.start(ctx.room);
  ctx.engine.answer(ctx.room, 'A', 'Vendredi', 1);
  const v = viewFor(ctx.room, 'B');
  assert.equal(JSON.stringify(v).includes('Vendredi'), false);
  assert.deepEqual(v.round.answered, ['A']);
  assert.equal(viewFor(ctx.room, 'A').round.myAnswer.text, 'Vendredi');
});

test('manche classique : la minorité perd un cœur, curseur exact = bouclier', () => {
  const ctx = setup();
  const { engine, room } = ctx;
  engine.start(room);
  playRound(ctx, { A: ['Vendredi', 2], B: ['vendredi', 0], C: ['Le vendredi', 2], D: ['Samedi', 0] });
  assert.deepEqual(hearts(room), { A: 3, B: 3, C: 3, D: 2 });
  // A et C ont deviné 2 autres, D a deviné 0 autre : boucliers
  assert.equal(ctx.p('A').shields, 1);
  assert.equal(ctx.p('B').shields, 0);
  assert.equal(ctx.p('D').shields, 1);
  const vA = viewFor(room, 'A');
  assert.deepEqual(vA.round.private, { guess: 2, same: 2, exact: true, shieldGained: true });
  // Les boucliers des autres ne sont jamais visibles
  assert.equal(viewFor(room, 'B').round.private.shieldGained, undefined);
  assert.deepEqual(vA.round.events, [{ playerId: 'D', kind: 'minority' }]);
});

test('ex aequo en tête : tous ces groupes sont sauvés', () => {
  const o = computeOutcome(
    [{ id: 'g1', members: ['A', 'B'] }, { id: 'g2', members: ['C', 'D'] }, { id: 'g3', members: ['E'] }],
    ['A', 'B', 'C', 'D', 'E'], ['A', 'B', 'C', 'D', 'E'], null);
  assert.deepEqual(o.winners, ['g1', 'g2']);
  assert.deepEqual(o.losses, [{ playerId: 'E', reason: 'minority' }]);
});

test('tout le monde différent : tout le monde perd, et pas de réponse = un cœur en moins', () => {
  const o = computeOutcome(
    [{ id: 'g1', members: ['A'] }, { id: 'g2', members: ['B'] }, { id: 'g3', members: ['C'] }],
    ['A', 'B', 'C', 'D'], ['A', 'B', 'C'], null);
  assert.equal(o.allDifferent, true);
  assert.deepEqual(o.losses.map(l => l.reason), ['allDifferent', 'allDifferent', 'allDifferent', 'noAnswer']);
});

test('tout le monde répond : la validation commence sans attendre le chrono', () => {
  const ctx = setup();
  ctx.engine.start(ctx.room);
  for (const [id, t] of [['A', 'chocolat chaud'], ['B', 'chocolat'], ['C', 'thé'], ['D', 'thé']]) ctx.engine.answer(ctx.room, id, t, 0);
  assert.equal(ctx.room.phase, 'validate');
  const v = viewFor(ctx.room, 'A');
  // Pendant la validation : les libellés, mais ni les auteurs ni les tailles
  assert.equal(v.round.groups.length, 3);
  assert.equal(v.round.groups[0].members, undefined);
});

test('fusion par vote majoritaire', () => {
  const ctx = setup();
  const { engine, room } = ctx;
  engine.start(room);
  for (const [id, t] of [['A', 'chocolat chaud'], ['B', 'chocolat'], ['C', 'thé'], ['D', 'thé']]) engine.answer(room, id, t, 0);
  const choc = room.round.groups.find(g => g.label === 'chocolat chaud').id;
  const choc2 = room.round.groups.find(g => g.label === 'chocolat').id;
  engine.proposeMerge(room, 'A', choc, choc2);
  assert.equal(room.round.proposal.needed, 3);
  engine.voteMerge(room, 'B', true);
  assert.equal(room.round.groups.length, 3); // 2 oui sur 4 : pas encore
  engine.voteMerge(room, 'C', true);
  assert.equal(room.round.groups.length, 2);
  assert.equal(room.round.proposal, null);
  ctx.clock.advance(VALIDATE_MS);
  ctx.clock.advance(revealMs(2));
  // Deux groupes de 2 ex aequo : personne ne perd
  assert.deepEqual(hearts(room), { A: 3, B: 3, C: 3, D: 3 });
});

test('fusion rejetée quand la majorité devient impossible, et fusion directe par l’hôte', () => {
  const ctx = setup();
  const { engine, room } = ctx;
  engine.start(room);
  for (const [id, t] of [['A', 'chat'], ['B', 'chien'], ['C', 'lapin'], ['D', 'lapin']]) engine.answer(room, id, t, 0);
  const [g1, g2, g3] = room.round.groups.map(g => g.id);
  engine.proposeMerge(room, 'B', g2, g3);
  engine.voteMerge(room, 'A', false);
  engine.voteMerge(room, 'C', false);
  assert.equal(room.round.proposal, null);
  assert.equal(room.round.groups.length, 3);
  engine.hostMerge(room, 'B', g1, g2); // B n'est pas l'hôte
  assert.equal(room.round.groups.length, 3);
  engine.hostMerge(room, 'A', g2, g3);
  assert.equal(room.round.groups.length, 2);
});

test('le Loup est épargné hors du troupeau, et indiscernable d’un bouclier', () => {
  const ctx = setup(['A', 'B', 'C', 'D'], { wolf: true }); // rng = 0 : A est le Loup
  const { engine, room } = ctx;
  engine.start(room);
  assert.equal(room.wolfId, 'A');
  assert.equal(viewFor(room, 'A').me.isWolf, true);
  assert.equal(viewFor(room, 'B').me.isWolf, false);
  assert.equal(viewFor(room, 'B').players.some(p => p.wolf), false);
  playRound(ctx, { A: ['lion', 9], B: ['chat', 9], C: ['chat', 9], D: ['chien', 9] });
  // A (Loup) et D sont hors du troupeau : seul D perd un cœur
  assert.equal(ctx.p('A').hearts, 3);
  assert.equal(ctx.p('D').hearts, 2);
  const events = viewFor(room, 'C').round.events;
  assert.ok(events.some(e => e.playerId === 'A' && e.kind === 'spared'));
  // Le Loup était seul : il a mordu quelqu'un (au hasard ici, faute de choix)
  assert.ok(room.round.bite && room.round.bite !== 'A');
  assert.ok(events.some(e => e.kind === 'bite'));
});

test('le Loup seul choisit sa victime pendant la révélation', () => {
  const ctx = setup(['A', 'B', 'C', 'D'], { wolf: true });
  const { engine, room, clock } = ctx;
  engine.start(room);
  for (const [id, t] of [['A', 'lion'], ['B', 'chat'], ['C', 'chat'], ['D', 'chat']]) engine.answer(room, id, t, 9);
  clock.advance(VALIDATE_MS);
  assert.equal(room.phase, 'reveal');
  assert.deepEqual(viewFor(room, 'A').round.wolfPick.candidates, ['B', 'C', 'D']);
  assert.equal(viewFor(room, 'B').round.wolfPick, undefined);
  engine.wolfBite(room, 'B', 'C'); // seul le Loup peut mordre
  assert.equal(room.round.bite, null);
  engine.wolfBite(room, 'A', 'C');
  clock.advance(revealMs(room.round.groups.length));
  assert.deepEqual(hearts(room), { A: 3, B: 3, C: 2, D: 3 });
});

test('démasquer le Loup : succès', () => {
  const ctx = setup(['A', 'B', 'C', 'D'], { wolf: true });
  const { engine, room, clock } = ctx;
  engine.start(room);
  playRound(ctx, { A: ['chat', 9], B: ['chat', 9], C: ['chat', 9], D: ['chien', 9] });
  engine.startHunt(room, 'B');
  assert.equal(room.phase, 'hunt');
  for (const v of ['B', 'C', 'D']) engine.huntVote(room, v, 'A');
  engine.huntVote(room, 'A', 'B');
  assert.equal(room.phase, 'huntResult');
  assert.equal(room.hunt.result.success, true);
  assert.equal(ctx.p('A').hearts, 0);
  assert.equal(viewFor(room, 'C').players.find(p => p.id === 'A').wolf, true);
  // Une seule fois par partie
  clock.advance(HUNT_RESULT_MS);
  assert.equal(room.phase, 'answer');
  assert.equal(viewFor(room, 'B').huntAvailable, false);
});

test('démasquer le Loup : raté, les votants perdent un cœur', () => {
  const ctx = setup(['A', 'B', 'C', 'D'], { wolf: true });
  const { engine, room } = ctx;
  engine.start(room);
  playRound(ctx, { A: ['chat', 0], B: ['chat', 0], C: ['chat', 0], D: ['chat', 0] }); // curseurs faux : pas de bouclier
  engine.startHunt(room, 'B');
  engine.huntVote(room, 'B', 'C');
  engine.huntVote(room, 'C', 'D');
  ctx.clock.advance(30000);
  assert.equal(room.hunt.result.success, false);
  assert.deepEqual(hearts(room), { A: 3, B: 2, C: 2, D: 3 });
});

test('fin de partie : dernier mouton en vie, ou égalité', () => {
  const ctx = setup(['A', 'B', 'C'], { hearts: 1 });
  const { engine, room, clock } = ctx;
  engine.start(room);
  playRound(ctx, { A: ['chat', 9], B: ['chat', 9], C: ['chien', 9] });
  clock.advance(RESULTS_MS);
  assert.equal(room.phase, 'answer');
  playRound(ctx, { A: ['chat', 9], B: ['chien', 9] });
  clock.advance(RESULTS_MS);
  assert.equal(room.phase, 'end');
  assert.equal(room.end.tie, true);
  assert.deepEqual(room.end.winners, ['A', 'B']);

  const ctx2 = setup(['A', 'B', 'C'], { hearts: 1 });
  ctx2.engine.start(ctx2.room);
  playRound(ctx2, { A: ['chat', 9], B: ['chat', 9] });
  assert.equal(ctx2.room.phase, 'results');
  // B ne joue pas la manche suivante
  ctx2.clock.advance(RESULTS_MS);
  ctx2.engine.answer(ctx2.room, 'A', 'x', 9);
  ctx2.clock.advance(25000 + VALIDATE_MS + revealMs(1) + RESULTS_MS);
  assert.equal(ctx2.room.phase, 'end');
  assert.deepEqual(ctx2.room.end, { winners: ['A'], tie: false, wolfId: null, rounds: 2 });
});

test('pioche sans doublon, questions des joueurs incluses', () => {
  const ctx = setup();
  const { engine, room, store } = ctx;
  store.addQuestion(room, ctx.p('B'), 'Le meilleur fromage');
  engine.start(room);
  const all = [room.round.question.text, ...room.deck.map(c => c.text)];
  assert.equal(all.length, 31);
  assert.equal(new Set(all).size, 31);
  assert.ok(all.includes('Le meilleur fromage'));
});
