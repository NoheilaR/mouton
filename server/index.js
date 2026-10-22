// Serveur HTTP (Express) + Socket.IO. Le serveur fait foi sur tout :
// le client n'envoie que ses réponses, ses votes et les réglages (s'il est l'hôte).
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createStore, viewFor, cleanText, cleanName } = require('./rooms');
const { createEngine, MAX_ANSWER, revealMs, VALIDATE_MS } = require('./game');
const { loadCategories } = require('./questions');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const categories = loadCategories();
const categoryIds = categories.map(c => c.id);
const categoryInfo = categories.map(c => ({ id: c.id, name: c.name, emoji: c.emoji, count: c.questions.length }));

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC, { index: 'index.html' }));
app.get('/healthz', (req, res) => res.send('ok'));
// Lien direct vers une room : /ABCD
app.get('/:code([A-Za-z]{4})', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

const store = createStore({ categoryIds });

// Chaque joueur reçoit sa propre vue (les infos secrètes restent sur le serveur)
function broadcast(room) {
  const now = Date.now();
  for (const p of room.players) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id, now));
  }
}

const engine = createEngine({ categories, onUpdate: broadcast });

io.on('connection', socket => {
  let room = null, me = null;
  const fail = msg => socket.emit('fail', msg);
  const isHost = () => room && me && room.hostId === me.id;
  // Toute action reçue est protégée et suivie d'une diffusion de l'état
  const on = (event, fn) => socket.on(event, (data = {}) => {
    if (typeof data !== 'object' || data === null) data = {};
    try { fn(data); } catch (e) { console.error(event, e); }
  });
  const act = fn => { if (room && me) { fn(); broadcast(room); } };
  const str = (v, max = 40) => cleanText(v, max);

  function enter(r, id, name) {
    if (room && room !== r) detach();
    const res = store.addPlayer(r, { id, name });
    if (res.error) return fail(res.error);
    room = r; me = res.player;
    me.socketId = socket.id;
    socket.join(r.code);
    socket.emit('joined', {
      code: r.code, categories: categoryInfo, maxAnswer: MAX_ANSWER,
      timing: { validateMs: VALIDATE_MS, revealBase: revealMs(0), revealPerGroup: revealMs(1) - revealMs(0) },
    });
    broadcast(r);
  }

  function detach() {
    if (!room || !me) return;
    const r = room, id = me.id;
    socket.leave(r.code);
    room = null; me = null;
    store.removePlayer(r, id);
    if (!r.players.length) {
      if (r.timer) clearTimeout(r.timer);
      store.rooms.delete(r.code);
      return;
    }
    engine.playerRemoved(r, id);
    broadcast(r);
  }

  const ident = d => ({ id: str(d.id, 40), name: cleanName(d.name) });

  on('create', d => {
    const { id, name } = ident(d);
    if (!id) return fail('Identifiant manquant, recharge la page.');
    if (!name) return fail('Choisis un pseudo.');
    enter(store.create(), id, name);
  });

  on('join', d => {
    const { id, name } = ident(d);
    const code = str(d.code, 4).toUpperCase();
    const r = store.get(code);
    if (!r) return fail(`La room ${code || '?'} n'existe pas (ou plus).`);
    if (!id) return fail('Identifiant manquant, recharge la page.');
    if (!name && !store.player(r, id)) return fail('Choisis un pseudo.');
    enter(r, id, name);
  });

  on('leave', () => { detach(); socket.emit('left'); });

  // Lobby
  on('settings', d => act(() => { if (isHost() && room.phase === 'lobby') store.applySettings(room, d); }));
  on('addQuestion', d => act(() => {
    if (room.phase !== 'lobby') return;
    const err = store.addQuestion(room, me, d.text);
    if (err) fail(err);
  }));
  on('removeQuestion', d => act(() => { if (room.phase === 'lobby') store.removeQuestion(room, me, Number(d.id)); }));
  on('start', () => act(() => {
    if (!isHost() || room.phase !== 'lobby') return;
    const err = engine.start(room);
    if (err) fail(err);
  }));

  // Manche
  on('answer', d => act(() => {
    const err = engine.answer(room, me.id, d.text, d.guess);
    if (err) fail(err);
  }));
  on('propose', d => act(() => engine.proposeMerge(room, me.id, str(d.a, 8), str(d.b, 8))));
  on('reviewMerge', d => act(() => engine.reviewMerge(room, me.id, Number(d.id), d.accept === true)));
  on('hostMerge', d => act(() => engine.hostMerge(room, me.id, str(d.a, 8), str(d.b, 8))));
  on('ready', () => act(() => engine.ready(room, me.id)));
  on('bite', d => act(() => engine.wolfBite(room, me.id, str(d.target))));
  on('next', () => act(() => engine.skipResults(room, me.id)));

  // Loup
  on('hunt', () => act(() => engine.startHunt(room, me.id)));
  on('huntVote', d => act(() => engine.huntVote(room, me.id, str(d.target))));

  // Fin
  on('replay', () => act(() => {
    if (!isHost() || room.phase !== 'end') return;
    const err = engine.start(room);
    if (err) fail(err);
  }));
  on('lobby', () => act(() => engine.backToLobby(room, me.id)));

  socket.on('disconnect', () => {
    if (!room || !me || me.socketId !== socket.id) return;
    store.disconnect(room, me.id);
    engine.playerDisconnected(room, me.id);
    broadcast(room);
  });
});

setInterval(() => store.sweep(
  (room, id) => { engine.playerRemoved(room, id); broadcast(room); },
  room => { if (room.timer) clearTimeout(room.timer); },
), 5000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Moutons sur http://localhost:${PORT}`));
}

module.exports = { server, io };
