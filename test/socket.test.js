// Partie complète avec plusieurs clients Socket.IO, comme plusieurs onglets ouverts
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, io } = require('../server/index');

let url;
test.before(() => new Promise(res => server.listen(0, () => { url = `http://localhost:${server.address().port}`; res(); })));
const tabs = [];
// Ferme tout, même si le test échoue (sinon les clients se reconnectent en boucle)
test.after(() => {
  tabs.forEach(t => t.s.disconnect());
  io.close();
  server.close();
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
});

// Un "onglet" : garde le dernier état reçu et tous les messages bruts
function tab(id, name) {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  const t = { id, name, s, state: null, raw: [], fails: [] };
  tabs.push(t);
  s.on('state', v => { t.state = v; t.raw.push(JSON.stringify(v)); });
  s.on('fail', m => t.fails.push(m));
  return t;
}
const until = (t, pred, ms = 3000) => new Promise((res, rej) => {
  const end = Date.now() + ms;
  (function check() {
    if (t.state && pred(t.state)) return res(t.state);
    if (Date.now() > end) return rej(new Error(`attente dépassée pour ${t.name} (phase ${t.state && t.state.phase})`));
    setTimeout(check, 15);
  })();
});

test('lobby, partie, fusion, révélation et reconnexion avec 4 onglets', async () => {
  const host = tab('h', 'Hôte');
  host.s.emit('create', { id: 'h', name: 'Hôte' });
  const st = await until(host, s => s.code);
  const code = st.code;
  const others = ['A', 'B', 'C'].map(n => tab(n, n));
  others.forEach(t => t.s.emit('join', { id: t.id, name: t.name, code }));
  await until(host, s => s.players.length === 4);

  // Seul l'hôte change les réglages
  others[0].s.emit('settings', { hearts: 1 });
  host.s.emit('settings', { hearts: 2, answerTime: 15 });
  await until(host, s => s.settings.hearts === 2 && s.settings.answerTime === 15);

  // Questions proposées : le texte reste privé
  others[0].s.emit('addQuestion', { text: 'La meilleure pizza' });
  await until(others[0], s => s.questions.mine.length === 1);
  await until(host, s => s.questions.total === 1);
  assert.equal(host.raw.at(-1).includes('La meilleure pizza'), false);

  host.s.emit('start');
  await until(host, s => s.phase === 'answer');
  const all = [host, ...others];
  host.s.emit('answer', { text: 'Chocolat chaud', guess: 1 });
  others[0].s.emit('answer', { text: 'chocolat', guess: 1 });
  others[1].s.emit('answer', { text: 'Thé', guess: 1 });
  await until(host, s => s.round.answered.length === 3);
  // Aucun onglet n'a reçu la réponse d'un autre pendant la phase de réponse
  assert.equal(others[2].raw.some(r => r.includes('Chocolat chaud')), false);

  // Rechargement de C : nouvelle connexion, même id, il retrouve sa place
  others[2].s.disconnect();
  const c2 = tab('C', 'C');
  c2.s.emit('join', { id: 'C', name: '', code });
  await until(c2, s => s.phase === 'answer' && s.me.alive && s.me.hearts === 2);
  c2.s.emit('answer', { text: 'thé', guess: 1 });

  // Validation : 3 groupes, l'onglet A propose de fusionner les deux chocolats
  await until(host, s => s.phase === 'validate');
  const groups = host.state.round.groups;
  assert.equal(groups.length, 3);
  assert.equal(groups[0].members, undefined);
  const id = l => groups.find(g => g.label.toLowerCase().startsWith(l)).id;
  const choc = groups.find(g => g.label === 'Chocolat chaud').id;
  const choc2 = groups.find(g => g.label === 'chocolat').id;
  others[0].s.emit('propose', { a: choc, b: choc2 });
  const v = await until(host, s => s.round.proposals.length === 1);
  host.s.emit('reviewMerge', { id: v.round.proposals[0].id, accept: true });
  await until(host, s => s.phase === 'validate' && s.round.groups.length === 2);
  [host, others[0], others[1], c2].forEach(t => t.s.emit('ready'));

  // Révélation : deux groupes de 2, ex aequo, personne ne perd
  const rv = await until(host, s => s.phase === 'reveal');
  assert.equal(rv.round.winners.length, 2);
  await until(host, s => s.phase === 'results', 8000);
  assert.deepEqual(host.state.players.map(p => p.hearts), [2, 2, 2, 2]);
  assert.equal(host.fails.length, 0);
  assert.equal(others[0].fails.length, 0);
});
