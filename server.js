const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const MOVIES = require('./public/movies.js');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const MAX_PLAYERS = 25;
const TEAM_NAMES = ['Gabbar Gang', 'Munna Bhai Mafia', "Rancho's Crew", "Basanti's Squad"];
const ERAS = ['all', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const rooms = new Map();

/* ---------- helpers ---------- */
const uid = () => crypto.randomBytes(8).toString('hex');
function genCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += L[crypto.randomInt(L.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 14);
const shuffleArr = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function createRoom() {
  return {
    code: genCode(),
    hostId: null,
    settings: { duration: 90, difficulty: 'all', era: 'all', teams: 2, rounds: 2, showWordCount: true, online: true },
    players: new Map(),
    phase: 'lobby', // lobby | turn | between | ended
    scores: [0, 0, 0, 0],
    used: new Set(),
    history: [],
    turn: null,
    last: null,
    turnsDone: 0,
    totalTurns: 0,
    activeTeams: [],
    cursors: [0, 0, 0, 0],
    timer: null,
    hostTimer: null,
    lastActivity: Date.now(),
  };
}

function teamCounts(room, candidates) {
  const counts = {};
  candidates.forEach((t) => (counts[t] = 0));
  room.players.forEach((p) => {
    if (p.team in counts) counts[p.team]++;
  });
  return counts;
}
function assignTeam(room, player) {
  const cand = room.phase === 'lobby' ? [...Array(room.settings.teams).keys()] : room.activeTeams;
  const counts = teamCounts(room, cand);
  player.team = cand.reduce((best, t) => (counts[t] < counts[best] ? t : best), cand[0]);
}

function filteredPool(room) {
  const { difficulty, era } = room.settings;
  let pool = MOVIES.filter((m) => (difficulty === 'all' || m.difficulty === difficulty) && (era === 'all' || m.era === era));
  if (!pool.length) pool = MOVIES;
  return pool;
}
function drawMovie(room) {
  const pool = filteredPool(room);
  let fresh = pool.filter((m) => !room.used.has(m.title));
  if (!fresh.length) {
    pool.forEach((m) => room.used.delete(m.title)); // deck exhausted: recycle
    fresh = pool;
  }
  const m = fresh[crypto.randomInt(fresh.length)];
  room.used.add(m.title);
  return m;
}

const norm = (x) => String(x).toLowerCase().replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function isMatch(guess, title) {
  const g = norm(guess), t = norm(title);
  if (!g) return false;
  return g === t || (t.length >= 7 && lev(g, t) <= Math.floor(t.length / 8));
}
function pattern(title) {
  return title.split(/\s+/).map((w) => w.split('').map((c, i) => (i === 0 || !/[A-Za-z0-9]/.test(c) ? c : '_')).join(' ')).join('   /   ');
}
function award(room, guesser) {
  const t = room.turn;
  const pts = t.hints > 0 ? 1 : 2;
  t.items.push({ movie: t.movie, result: 'guessed', points: pts, guesser: guesser || null });
  room.scores[t.teamIdx] += pts;
  t.movie = drawMovie(room);
  t.hints = 0;
}

function pickActor(room, teamIdx, commit) {
  const members = [...room.players.values()].filter((p) => p.team === teamIdx);
  if (!members.length) return null;
  const cur = room.cursors[teamIdx] || 0;
  for (let k = 0; k < members.length; k++) {
    const i = (cur + k) % members.length;
    if (members[i].connected) {
      if (commit) room.cursors[teamIdx] = i + 1;
      return members[i];
    }
  }
  const i = cur % members.length;
  if (commit) room.cursors[teamIdx] = i + 1;
  return members[i];
}

/* ---------- state views (anti-cheat: movie only goes to the actor) ---------- */
function viewFor(room, p) {
  const s = room.settings;
  const teams = [];
  for (let i = 0; i < s.teams; i++) {
    teams.push({
      idx: i,
      name: TEAM_NAMES[i],
      score: room.scores[i],
      players: [...room.players.values()]
        .filter((x) => x.team === i)
        .map((x) => ({ id: x.id, name: x.name, connected: x.connected })),
    });
  }
  const v = {
    code: room.code,
    phase: room.phase,
    youId: p.id,
    hostId: room.hostId,
    settings: s,
    teams,
    activeTeams: room.activeTeams,
    playerCount: room.players.size,
    turnsDone: room.turnsDone,
    totalTurns: room.totalTurns,
    serverNow: Date.now(),
  };
  if (room.phase === 'turn' && room.turn) {
    const t = room.turn;
    const actor = room.players.get(t.actorId);
    const isActor = p.id === t.actorId;
    v.turn = {
      teamIdx: t.teamIdx,
      actorId: t.actorId,
      actorName: actor ? actor.name : '?',
      actorConnected: !!(actor && actor.connected),
      status: t.status,
      endsAt: t.endsAt,
      duration: t.duration,
      guessed: t.items.filter((i) => i.result === 'guessed').length,
      skipped: t.items.filter((i) => i.result === 'skipped').length,
      wordCount: isActor || s.showWordCount ? t.movie.wordCount : null,
      movie: isActor ? t.movie : null,
      hints: t.hints,
      hintInfo: t.hints >= 1 ? { year: t.movie.year, era: t.movie.era } : null,
      pattern: t.hints >= 2 ? pattern(t.movie.title) : null,
      feed: t.feed.slice(-6),
    };
  }
  if (room.phase === 'between' || room.phase === 'ended') {
    v.last = room.last;
  }
  if (room.phase === 'between' && room.turnsDone < room.totalTurns) {
    const nt = room.activeTeams[room.turnsDone % room.activeTeams.length];
    const na = pickActor(room, nt, false);
    v.nextUp = { teamIdx: nt, actorName: na ? na.name : '?' };
  }
  if (room.phase === 'ended') v.history = room.history;
  return v;
}
function broadcast(room) {
  room.lastActivity = Date.now();
  room.players.forEach((p) => {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p));
  });
}

/* ---------- game flow ---------- */
function beginTurn(room) {
  clearTimeout(room.timer);
  if (room.turnsDone >= room.totalTurns) return endGame(room);
  let guard = 0;
  let teamIdx, actor;
  while (guard++ < room.activeTeams.length) {
    teamIdx = room.activeTeams[room.turnsDone % room.activeTeams.length];
    actor = pickActor(room, teamIdx, true);
    if (actor) break;
    room.turnsDone++; // empty team, skip its slot
    if (room.turnsDone >= room.totalTurns) return endGame(room);
  }
  if (!actor) return endGame(room);
  room.phase = 'turn';
  room.turn = { teamIdx, actorId: actor.id, status: 'ready', endsAt: 0, duration: room.settings.duration, movie: drawMovie(room), items: [], hints: 0, feed: [] };
  broadcast(room);
}

function startTimer(room) {
  const t = room.turn;
  t.status = 'running';
  t.endsAt = Date.now() + t.duration * 1000;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => finishTurn(room, 'timeout'), t.duration * 1000 + 100);
  broadcast(room);
}

// Closes out the current movie + records every item into the session history.
function closeTurnItems(room, reason) {
  const t = room.turn;
  if (t.status === 'running') t.items.push({ movie: t.movie, result: reason === 'override' ? 'skipped' : 'missed' });
  else room.used.delete(t.movie.title); // never acted: put back in the deck
  const actor = room.players.get(t.actorId);
  t.items.forEach((i) =>
    room.history.push({ title: i.movie.title, year: i.movie.year, result: i.result, points: i.points || 0, guesser: i.guesser || null, team: TEAM_NAMES[t.teamIdx], teamIdx: t.teamIdx, actor: actor ? actor.name : '?' })
  );
}

function finishTurn(room, reason) {
  if (room.phase !== 'turn' || !room.turn) return;
  clearTimeout(room.timer);
  const t = room.turn;
  const actor = room.players.get(t.actorId);
  closeTurnItems(room, reason);
  room.turnsDone++;
  room.last = {
    teamIdx: t.teamIdx,
    teamName: TEAM_NAMES[t.teamIdx],
    actorName: actor ? actor.name : '?',
    reason,
    gained: t.items.reduce((n, i) => n + (i.points || 0), 0),
    items: t.items.map((i) => ({ title: i.movie.title, year: i.movie.year, result: i.result, points: i.points || 0, guesser: i.guesser || null })),
    final: room.turnsDone >= room.totalTurns,
  };
  room.turn = null;
  room.phase = 'between';
  broadcast(room);
}

function overrideActor(room) {
  if (room.phase !== 'turn' || !room.turn) return;
  clearTimeout(room.timer);
  closeTurnItems(room, 'override');
  room.turn = null;
  beginTurn(room); // same team, next actor (cursor already advanced); turn is not consumed
}

function endGame(room) {
  clearTimeout(room.timer);
  room.phase = 'ended';
  room.turn = null;
  broadcast(room);
}

function resetToLobby(room) {
  clearTimeout(room.timer);
  room.phase = 'lobby';
  room.scores = [0, 0, 0, 0];
  room.used = new Set();
  room.history = [];
  room.turn = null;
  room.last = null;
  room.turnsDone = 0;
  room.totalTurns = 0;
  room.activeTeams = [];
  room.cursors = [0, 0, 0, 0];
  broadcast(room);
}

/* ---------- sockets ---------- */
function attach(socket, room, p) {
  if (p.socketId && p.socketId !== socket.id) {
    const old = io.sockets.sockets.get(p.socketId);
    if (old) old.data = {};
  }
  p.socketId = socket.id;
  p.connected = true;
  clearTimeout(p.rmTimer);
  if (p.id === room.hostId) clearTimeout(room.hostTimer);
  socket.data = { code: room.code, pid: p.id };
}

function ctx(socket) {
  const { code, pid } = socket.data || {};
  const room = rooms.get(code);
  const player = room && room.players.get(pid);
  return room && player ? { room, player } : null;
}

io.on('connection', (socket) => {
  const fail = (cb, error) => typeof cb === 'function' && cb({ ok: false, error });
  const ok = (cb, extra) => typeof cb === 'function' && cb({ ok: true, ...extra });

  socket.on('create', (d, cb) => {
    const name = cleanName(d && d.name);
    if (!name) return fail(cb, 'Enter your nickname first');
    const room = createRoom();
    rooms.set(room.code, room);
    const p = { id: uid(), name, team: 0, socketId: null, connected: true };
    room.players.set(p.id, p);
    room.hostId = p.id;
    attach(socket, room, p);
    ok(cb, { code: room.code, playerId: p.id });
    broadcast(room);
  });

  socket.on('join', (d, cb) => {
    d = d || {};
    const room = rooms.get(String(d.code || '').toUpperCase().trim());
    const name = cleanName(d.name);
    if (!room) return fail(cb, 'Room not found. Check the 4-letter code.');
    if (!name) return fail(cb, 'Enter your nickname first');
    let p = d.playerId && room.players.get(d.playerId);
    if (!p) {
      p = [...room.players.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (p && p.connected) return fail(cb, 'That nickname is already taken in this room');
    }
    if (!p) {
      if (room.players.size >= MAX_PLAYERS) return fail(cb, `Room is full (${MAX_PLAYERS} players)`);
      p = { id: uid(), name, team: 0, socketId: null, connected: true };
      assignTeam(room, p);
      room.players.set(p.id, p);
    }
    attach(socket, room, p);
    ok(cb, { code: room.code, playerId: p.id, name: p.name });
    broadcast(room);
  });

  socket.on('rejoin', (d, cb) => {
    const room = rooms.get(String((d && d.code) || '').toUpperCase());
    const p = room && room.players.get(d.playerId);
    if (!p) return fail(cb, 'Session expired');
    attach(socket, room, p);
    ok(cb, { code: room.code, playerId: p.id, name: p.name });
    broadcast(room);
  });

  socket.on('leave', (_d, cb) => {
    const c = ctx(socket);
    if (!c) return ok(cb);
    const { room, player } = c;
    socket.data = {};
    player.connected = false;
    player.socketId = null;
    if (room.phase === 'lobby') room.players.delete(player.id);
    if (room.hostId === player.id) transferHost(room);
    ok(cb);
    broadcast(room);
  });

  socket.on('setTeam', (d, cb) => {
    const c = ctx(socket);
    if (!c) return fail(cb, 'Not in a room');
    const { room, player } = c;
    const t = Number(d && d.team);
    if (room.phase !== 'lobby') return fail(cb, 'Teams are locked once the game starts');
    if (!(t >= 0 && t < room.settings.teams)) return fail(cb, 'Invalid team');
    player.team = t;
    ok(cb);
    broadcast(room);
  });

  socket.on('settings', (d, cb) => {
    const c = ctx(socket);
    if (!c) return fail(cb, 'Not in a room');
    const { room, player } = c;
    if (player.id !== room.hostId) return fail(cb, 'Only the host can change settings');
    if (room.phase !== 'lobby') return fail(cb, 'Game already started');
    const s = room.settings;
    const { key, value } = d || {};
    if (key === 'duration' && [60, 90, 120].includes(+value)) s.duration = +value;
    else if (key === 'difficulty' && ['all', 'easy', 'medium', 'hard'].includes(value)) s.difficulty = value;
    else if (key === 'era' && ERAS.includes(value)) s.era = value;
    else if (key === 'teams' && [2, 3, 4].includes(+value)) {
      s.teams = +value;
      room.players.forEach((p) => {
        if (p.team >= s.teams) assignTeam(room, p);
      });
    } else if (key === 'rounds' && +value >= 1 && +value <= 5) s.rounds = +value;
    else if (key === 'showWordCount') s.showWordCount = !!value;
    else if (key === 'online') s.online = !!value;
    else return fail(cb, 'Invalid setting');
    ok(cb);
    broadcast(room);
  });

  socket.on('shuffle', (_d, cb) => {
    const c = ctx(socket);
    if (!c) return fail(cb, 'Not in a room');
    const { room, player } = c;
    if (player.id !== room.hostId || room.phase !== 'lobby') return fail(cb, 'Host only (lobby)');
    shuffleArr([...room.players.values()]).forEach((p, i) => (p.team = i % room.settings.teams));
    ok(cb);
    broadcast(room);
  });

  socket.on('start', (_d, cb) => {
    const c = ctx(socket);
    if (!c) return fail(cb, 'Not in a room');
    const { room, player } = c;
    if (player.id !== room.hostId) return fail(cb, 'Only the host can start');
    if (room.phase !== 'lobby') return fail(cb, 'Game already started');
    const active = [];
    for (let i = 0; i < room.settings.teams; i++) {
      if ([...room.players.values()].some((p) => p.team === i)) active.push(i);
    }
    if (active.length < 2) return fail(cb, 'Need players on at least 2 teams');
    room.activeTeams = active;
    room.totalTurns = room.settings.rounds * active.length;
    room.turnsDone = 0;
    room.scores = [0, 0, 0, 0];
    room.used = new Set();
    room.history = [];
    room.cursors = [0, 0, 0, 0];
    ok(cb);
    beginTurn(room);
  });

  // ---- actor actions ----
  const actorCtx = (cb) => {
    const c = ctx(socket);
    if (!c) return fail(cb, 'Not in a room'), null;
    const { room, player } = c;
    if (room.phase !== 'turn' || !room.turn || room.turn.actorId !== player.id) return fail(cb, 'You are not the actor right now'), null;
    return c;
  };

  socket.on('startTimer', (_d, cb) => {
    const c = actorCtx(cb);
    if (!c || c.room.turn.status !== 'ready') return;
    startTimer(c.room);
    ok(cb);
  });
  socket.on('guessed', (_d, cb) => {
    const c = actorCtx(cb);
    if (!c) return;
    const { room } = c;
    if (room.turn.status !== 'running') return fail(cb, 'Start the timer first');
    award(room, null);
    room.turn.feed.push({ name: '🎤 Heard aloud', text: 'Correct!', correct: true });
    ok(cb);
    broadcast(room);
  });
  socket.on('skip', (_d, cb) => {
    const c = actorCtx(cb);
    if (!c) return;
    const { room } = c;
    if (room.turn.status === 'running') room.turn.items.push({ movie: room.turn.movie, result: 'skipped' });
    room.turn.movie = drawMovie(room);
    room.turn.hints = 0;
    ok(cb);
    broadcast(room);
  });
  socket.on('hint', (_d, cb) => {
    const c = actorCtx(cb);
    if (!c) return;
    const { room } = c;
    if (!room.settings.online) return fail(cb, 'Hints are only in online mode');
    if (room.turn.status !== 'running') return fail(cb, 'Start the timer first');
    if (room.turn.hints >= 2) return fail(cb, 'No more hints for this movie');
    room.turn.hints++;
    ok(cb);
    broadcast(room);
  });
  socket.on('guess', (d, cb) => {
    const c = ctx(socket);
    if (!c) return fail(cb, 'Not in a room');
    const { room, player } = c;
    const t = room.turn;
    if (room.phase !== 'turn' || !t || t.status !== 'running') return fail(cb, 'No round in progress');
    if (!room.settings.online) return fail(cb, 'Typed guesses are off');
    if (player.id === t.actorId) return fail(cb, 'The actor cannot guess');
    if (player.team !== t.teamIdx) return fail(cb, 'Only the acting team can guess');
    const now = Date.now();
    if (player.lastGuess && now - player.lastGuess < 600) return fail(cb, 'Slow down!');
    player.lastGuess = now;
    const text = String((d && d.text) || '').trim().slice(0, 60);
    if (!text) return fail(cb, 'Type a guess');
    const correct = isMatch(text, t.movie.title);
    t.feed.push({ name: player.name, text: correct ? 'got it! 🎉' : text, correct });
    if (t.feed.length > 20) t.feed.shift();
    if (correct) award(room, player.name);
    ok(cb, { correct });
    broadcast(room);
  });
  socket.on('endTurn', (_d, cb) => {
    const c = actorCtx(cb);
    if (!c) return;
    ok(cb);
    finishTurn(c.room, 'ended');
  });

  // ---- host controls ----
  const hostCtx = (cb) => {
    const c = ctx(socket);
    if (!c) return fail(cb, 'Not in a room'), null;
    if (c.player.id !== c.room.hostId) return fail(cb, 'Host only'), null;
    return c;
  };
  socket.on('override', (_d, cb) => {
    const c = hostCtx(cb);
    if (!c) return;
    ok(cb);
    overrideActor(c.room);
  });
  socket.on('next', (_d, cb) => {
    const c = hostCtx(cb);
    if (!c || c.room.phase !== 'between') return;
    ok(cb);
    beginTurn(c.room);
  });
  socket.on('endGame', (_d, cb) => {
    const c = hostCtx(cb);
    if (!c || c.room.phase === 'lobby' || c.room.phase === 'ended') return;
    if (c.room.phase === 'turn') closeTurnItems(c.room, 'ended');
    ok(cb);
    endGame(c.room);
  });
  socket.on('playAgain', (_d, cb) => {
    const c = hostCtx(cb);
    if (!c || c.room.phase !== 'ended') return;
    ok(cb);
    resetToLobby(c.room);
  });

  socket.on('disconnect', () => {
    const c = ctx(socket);
    if (!c) return;
    const { room, player } = c;
    if (player.socketId !== socket.id) return; // replaced by a newer connection
    player.connected = false;
    player.socketId = null;
    // Lobby: drop long-absent players. Host: hand over after a grace period.
    if (room.phase === 'lobby') {
      player.rmTimer = setTimeout(() => {
        if (!player.connected && room.phase === 'lobby') {
          room.players.delete(player.id);
          if (room.hostId === player.id) transferHost(room);
          broadcast(room);
        }
      }, 90000);
    }
    if (room.hostId === player.id) {
      clearTimeout(room.hostTimer);
      room.hostTimer = setTimeout(() => {
        const h = room.players.get(room.hostId);
        if (h && !h.connected) {
          transferHost(room);
          broadcast(room);
        }
      }, 30000);
    }
    broadcast(room);
  });
});

function transferHost(room) {
  const next = [...room.players.values()].find((p) => p.connected && p.id !== room.hostId);
  if (next) room.hostId = next.id;
}

// Garbage-collect abandoned rooms.
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    const anyone = [...room.players.values()].some((p) => p.connected);
    if (!anyone && now - room.lastActivity > 30 * 60 * 1000) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  });
}, 5 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dum Sharath running on http://localhost:${PORT}`));
