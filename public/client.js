/* Dum Sharath – client */
(function () {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const views = { home: $('v-home'), lobby: $('v-lobby'), game: $('v-game'), end: $('v-end') };

  let S = null; // latest server state (personalised)
  let offset = 0; // serverNow - clientNow
  let buzzedFor = 0;
  let lastTickSec = -1;
  let wakeLock = null;

  /* ---------- session (per-tab so you can test with many tabs) ---------- */
  const loadSession = () => { try { return JSON.parse(sessionStorage.getItem('ds_session')); } catch (e) { return null; } };
  const saveSession = (s) => { try { s ? sessionStorage.setItem('ds_session', JSON.stringify(s)) : sessionStorage.removeItem('ds_session'); } catch (e) {} };
  let session = loadSession();

  /* ---------- small helpers ---------- */
  function setHTML(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
  let toastT;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function call(ev, data) {
    return new Promise((resolve) => {
      socket.timeout(8000).emit(ev, data || {}, (err, res) => {
        if (err) { toast('No response – check your connection'); return resolve({ ok: false }); }
        if (!res.ok && res.error) toast(res.error);
        resolve(res);
      });
    });
  }
  function show(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }
  const TEAM_CLASS = (i) => 't' + i;
  const isHost = () => S && S.youId === S.hostId;
  const eraLabel = (e) => (e === 'all' ? 'All eras' : e);

  /* ---------- audio (Web Audio API) ---------- */
  let ac = null;
  function audio() {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { ac = null; }
    return ac;
  }
  function tone(freq, start, dur, type, vol) {
    const a = audio();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const t0 = a.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  const sfx = {
    start() { tone(523, 0, 0.15, 'triangle'); tone(659, 0.12, 0.15, 'triangle'); tone(784, 0.24, 0.3, 'triangle'); },
    tick() { tone(880, 0, 0.07, 'square', 0.12); },
    buzzer() { tone(140, 0, 0.5, 'sawtooth', 0.4); tone(140, 0.6, 0.9, 'sawtooth', 0.4); if (navigator.vibrate) navigator.vibrate([300, 100, 600]); },
    yourTurn() { tone(660, 0, 0.12, 'sine'); tone(880, 0.14, 0.12, 'sine'); tone(1320, 0.28, 0.25, 'sine'); if (navigator.vibrate) navigator.vibrate([200, 80, 200]); },
    point() { tone(988, 0, 0.1, 'triangle'); tone(1319, 0.1, 0.2, 'triangle'); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.18, 0.3, 'triangle')); tone(1047, 0.8, 0.8, 'triangle'); },
  };
  document.addEventListener('pointerdown', audio, { passive: true }); // unlock on first tap

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (S && S.phase !== 'lobby') keepAwake();
      if (!socket.connected) socket.connect();
    }
  });

  /* ---------- connection / resilience ---------- */
  socket.on('connect', () => {
    $('banner').classList.add('hidden');
    if (session) {
      socket.emit('rejoin', { code: session.code, playerId: session.playerId }, (res) => {
        if (!res || !res.ok) {
          // Server restarted or room gone: try name-based rejoin, else go home.
          socket.emit('join', { code: session.code, name: session.name }, (r2) => {
            if (r2 && r2.ok) { session.playerId = r2.playerId; saveSession(session); }
            else { session = null; saveSession(null); S = null; render(); }
          });
        }
      });
    }
  });
  socket.on('disconnect', () => { if (session) $('banner').classList.remove('hidden'); });

  socket.on('state', (st) => {
    const prev = S;
    S = st;
    offset = st.serverNow - Date.now();
    reactSound(prev, st);
    render();
  });

  function reactSound(prev, st) {
    const pt = prev && prev.turn, nt = st.turn;
    if (nt && nt.status === 'running' && (!pt || pt.status !== 'running' || pt.endsAt !== nt.endsAt)) sfx.start();
    if (nt && (!pt || pt.actorId !== nt.actorId) && nt.actorId === st.youId) sfx.yourTurn();
    if (nt && pt && nt.guessed > pt.guessed && pt.actorId === nt.actorId) sfx.point();
    if (prev && prev.phase === 'turn' && st.phase === 'between' && st.last && st.last.reason === 'timeout' && pt && buzzedFor !== pt.endsAt) {
      buzzedFor = pt.endsAt;
      sfx.buzzer();
    }
    if (prev && prev.phase !== 'ended' && st.phase === 'ended') sfx.fanfare();
  }

  /* ---------- actions ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    audio();
    if (act === 'create') {
      const name = $('name-in').value;
      const r = await call('create', { name });
      if (r.ok) enter(r, name);
    } else if (act === 'join') {
      const name = $('name-in').value;
      const r = await call('join', { code: $('code-in').value, name });
      if (r.ok) enter(r, r.name || name);
    } else if (act === 'team') call('setTeam', { team: +b.dataset.team });
    else if (act === 'shuffle') call('shuffle');
    else if (act === 'start') call('start');
    else if (act === 'share') share();
    else if (act === 'leave') { if (confirm('Leave this room?')) { await call('leave'); session = null; saveSession(null); S = null; render(); } }
    else if (act === 'startTimer') call('startTimer');
    else if (act === 'guessed') call('guessed');
    else if (act === 'skip') call('skip');
    else if (act === 'hint') call('hint');
    else if (act === 'pick') pick(+b.dataset.i);
    else if (act === 'endTurn') call('endTurn');
    else if (act === 'override') { if (confirm('Skip this actor and pick the next player on their team?')) call('override'); }
    else if (act === 'next') call('next');
    else if (act === 'endGame') { if (confirm('End the game now and show the results?')) call('endGame'); }
    else if (act === 'again') call('playAgain');
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    const key = el.dataset.setting;
    call('settings', { key, value: (key === 'showWordCount' || key === 'online') ? el.value === '1' : el.value });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'code-in') document.querySelector('[data-act="join"]').click();
  });

  async function pick(i) {
    const o = S && S.turn && S.turn.options && S.turn.options[i];
    if (!o || o.hidden || S.turn.locked) return;
    const r = await call('guess', { choice: o.text });
    if (r.ok && !r.correct) toast('Wrong! You’re out for this movie.');
  }
  function enter(r, name) {
    session = { code: r.code, playerId: r.playerId, name };
    saveSession(session);
  }
  async function share() {
    const url = location.origin + '/?room=' + S.code;
    const text = `Join my Dum Sharath game! Room code: ${S.code}`;
    try {
      if (navigator.share) return await navigator.share({ title: 'Dum Sharath', text, url });
      await navigator.clipboard.writeText(url);
      toast('Invite link copied!');
    } catch (e) {}
  }

  /* ---------- rendering ---------- */
  function render() {
    if (!S || !session) return renderHome();
    if (S.phase === 'lobby') return renderLobby();
    if (S.phase === 'ended') return renderEnd();
    renderGame();
  }

  let homeBuilt = false;
  function renderHome() {
    show('home');
    if (homeBuilt) return;
    homeBuilt = true;
    const pre = new URLSearchParams(location.search).get('room') || '';
    views.home.innerHTML = `
      <div class="logo"><h1>🎬 Dum Sharath</h1><p>Bollywood Dumb Charades · play on your phones</p></div>
      <div class="card">
        <label for="name-in">Your nickname</label>
        <input id="name-in" maxlength="14" placeholder="e.g. Raju" autocomplete="off">
      </div>
      <div class="card">
        <h3>Join a game</h3>
        <label for="code-in">4-letter room code</label>
        <input id="code-in" maxlength="4" placeholder="SHOL" value="${esc(pre.toUpperCase().slice(0, 4))}" autocomplete="off" autocapitalize="characters">
        <button class="btn" data-act="join">Join Room</button>
        <div class="or">— or —</div>
        <button class="btn sec" data-act="create">Create New Room (I'm the host)</button>
      </div>`;
  }

  function renderLobby() {
    show('lobby');
    const root = views.lobby;
    if (!root._built) {
      root._built = true;
      root.innerHTML = '<div id="lb-head"></div><div id="lb-set"></div><div id="lb-teams"></div><div id="lb-act"></div>';
    }
    const host = isHost();
    const s = S.settings;
    setHTML($('lb-head'), `
      <div class="topbar"><span class="pill">${S.playerCount} / 25 players</span><button class="linkbtn" data-act="leave">Leave</button></div>
      <div class="card roomcode"><small>Room code — friends type this to join</small>
        <div class="big">${esc(S.code)}</div>
        <button class="btn sec small" data-act="share">📲 Share invite</button></div>`);

    const opt = (val, label, cur) => `<option value="${val}" ${String(cur) === String(val) ? 'selected' : ''}>${label}</option>`;
    const eras = ['all', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
    setHTML($('lb-set'), host
      ? `<div class="card"><h3>⚙️ Game settings</h3><div class="settings">
          <div><label>Round timer</label><select data-setting="duration">${[60, 90, 120].map((v) => opt(v, v + ' sec', s.duration)).join('')}</select></div>
          <div><label>Teams</label><select data-setting="teams">${[2, 3, 4].map((v) => opt(v, v + ' teams', s.teams)).join('')}</select></div>
          <div><label>Difficulty</label><select data-setting="difficulty">${['all', 'easy', 'medium', 'hard'].map((v) => opt(v, v[0].toUpperCase() + v.slice(1), s.difficulty)).join('')}</select></div>
          <div><label>Era</label><select data-setting="era">${eras.map((v) => opt(v, eraLabel(v), s.era)).join('')}</select></div>
          <div><label>Turns per team</label><select data-setting="rounds">${[1, 2, 3, 4, 5].map((v) => opt(v, v, s.rounds)).join('')}</select></div>
          <div class="full"><label>Online mode (4-choice answers + actor hints)</label><select data-setting="online">${opt(1, 'On – for video calls', s.online ? 1 : 0)}${opt(0, 'Off – everyone in one room', s.online ? 1 : 0)}</select></div>
          <div><label>Show word-count hint</label><select data-setting="showWordCount">${opt(1, 'Yes', s.showWordCount ? 1 : 0)}${opt(0, 'No', s.showWordCount ? 1 : 0)}</select></div>
        </div></div>`
      : `<div class="card"><h3>⚙️ Game settings</h3><div class="sumline">
          ⏱ <b>${s.duration}s</b> per turn · 👥 <b>${s.teams}</b> teams · 🔁 <b>${s.rounds}</b> turn(s) per team<br>
          🎚 <b>${esc(s.difficulty)}</b> · 📅 <b>${eraLabel(s.era)}</b> · 💡 word hint <b>${s.showWordCount ? 'on' : 'off'}</b> · 💻 online mode <b>${s.online ? 'on' : 'off'}</b></div></div>`);

    const me = S.teams.flatMap((t) => t.players.map((p) => ({ ...p, team: t.idx }))).find((p) => p.id === S.youId);
    setHTML($('lb-teams'), `<div class="teams">${S.teams.map((t) => `
      <div class="team ${TEAM_CLASS(t.idx)} ${me && me.team === t.idx ? 'mine' : ''}">
        <h4><span>${esc(t.name)} · ${t.players.length}</span>
          ${me && me.team === t.idx ? '<span class="pill">Your team</span>' : `<button class="btn small sec" data-act="team" data-team="${t.idx}">Join</button>`}</h4>
        <div class="pl">${t.players.map((p) => `<span class="chip ${p.id === S.youId ? 'you' : ''} ${p.id === S.hostId ? 'host' : ''} ${p.connected ? '' : 'off'}">${esc(p.name)}</span>`).join('') || '<span class="chip off">empty</span>'}</div>
      </div>`).join('')}</div>`);

    const ready = S.teams.filter((t) => t.players.length).length >= 2;
    setHTML($('lb-act'), host
      ? `<button class="btn sec" data-act="shuffle">🔀 Shuffle / Auto-balance teams</button>
         <button class="btn" data-act="start" ${ready ? '' : 'disabled'}>🎬 Start Game</button>
         ${ready ? '' : '<p class="sumline" style="text-align:center">Need players on at least 2 teams</p>'}`
      : '<p class="sumline" style="text-align:center">⏳ Waiting for the host to start… tap a team’s “Join” to switch.</p>');
  }

  function scoreboard() {
    return `<div class="score">${S.teams.filter((t) => S.activeTeams.includes(t.idx)).map((t) => `
      <div class="sc ${TEAM_CLASS(t.idx)} ${S.turn && S.turn.teamIdx === t.idx ? 'act' : ''}"><b>${t.score}</b><span>${esc(t.name)}</span></div>`).join('')}</div>`;
  }

  function renderGame() {
    show('game');
    const root = views.game;
    if (!root._built) {
      root._built = true;
      root.innerHTML = '<div id="g-top"></div><div id="g-stage"></div><div id="g-guess"></div><div id="g-feed"></div><div id="g-host"></div>';
    }
    keepAwake();
    const turnNo = Math.min(S.turnsDone + (S.phase === 'turn' ? 1 : 0), S.totalTurns);
    setHTML($('g-top'), `<div class="topbar"><span class="pill">Room ${esc(S.code)} · Turn ${turnNo}/${S.totalTurns}</span><button class="linkbtn" data-act="leave">Leave</button></div>${scoreboard()}`);

    let html = '';
    if (S.phase === 'turn') {
      const t = S.turn;
      const team = S.teams[t.teamIdx];
      const iAmActor = t.actorId === S.youId;
      const myTeam = (team.players.find((p) => p.id === S.youId));
      const timerBlock = `<div class="timer" id="timer">${t.status === 'running' ? '' : t.duration}</div><div class="bar"><i id="bar"></i></div>`;
      const wc = t.wordCount != null ? `<span class="badge">${t.wordCount} word${t.wordCount > 1 ? 's' : ''}</span>` : '';
      const online = S.settings.online;
      const hintsHtml = (t.hintInfo ? `<div class="stage"><span class="badge" style="background:rgba(255,200,61,.18)">📅 ${t.hintInfo.year} · ${esc(t.hintInfo.era)}</span></div>` : '')
        + '';
      if (iAmActor) {
        const m = t.movie;
        const card = `<div class="movie"><small>Your secret movie 🤫</small><h2>${esc(m.title)}</h2>
          <div class="badges"><span class="badge">${m.year}</span>${wc}<span class="badge">${esc(m.difficulty)}</span></div></div>`;
        html = t.status === 'ready'
          ? `<div class="stage"><div class="who">🎭 You’re acting for <em>${esc(team.name)}</em>!</div></div>${card}
             <div class="stage hint">${online ? '📹 Act with hand gestures on camera. Don’t say any word from the title. Your team picks from 4 options on their phones – use 💡 hints if they’re stuck.' : 'Read it, then start the clock. No talking, no pointing at objects!'}</div>
             <button class="btn good" data-act="startTimer">▶ Start Timer (${t.duration}s)</button>
             <button class="btn sec" data-act="skip">⏭ Skip Movie</button>`
          : `${timerBlock}${card}${hintsHtml}<div class="tally"><span>✅ ${t.guessed} guessed</span><span>⏭ ${t.skipped} skipped</span></div>
             ${online ? `<button class="btn sec" data-act="hint" ${t.hints >= 2 ? 'disabled' : ''}>💡 ${t.hints === 0 ? 'Hint 1: show year & era' : t.hints === 1 ? 'Hint 2: remove 2 wrong options' : 'No more hints'} (−1 point)</button>` : ''}
             <button class="btn good" data-act="guessed">Guessed It! ${t.hints ? '+1' : '+2'}</button>
             <div class="row"><button class="btn sec" data-act="skip">⏭ Skip Movie</button><button class="btn bad" data-act="endTurn">⏹ End Turn</button></div>`;
      } else {
        const mine = !!myTeam;
        html = `<div class="stage"><div class="who">It’s <em>${esc(t.actorName)}</em>’s turn to act for <em>${esc(team.name)}</em>!</div>
          <div class="hint">${mine ? (online ? '📹 Watch the camera, then tap your answer below – one try per movie!' : '🗣 Your team is guessing – shout out your answers!') : '🤐 Opponents are acting – watch quietly, no spoilers!'}</div>
          ${t.status === 'ready' ? `<div class="hint">⏳ Waiting for ${esc(t.actorName)} to start the clock${t.actorConnected ? '' : ' (their phone looks offline)'}…</div>` : ''}</div>
          ${timerBlock}
          ${hintsHtml}
          <div class="stage">${t.wordCount != null ? `<span class="badge" style="background:rgba(255,200,61,.18)">💡 Hint: ${t.wordCount} word${t.wordCount > 1 ? 's' : ''}</span>` : ''}
          <div class="tally"><span>✅ ${t.guessed} guessed so far</span></div></div>`;
      }
    } else if (S.phase === 'between') {
      const l = S.last;
      html = `<div class="card"><h3>Turn over — ${esc(l.teamName)} (${esc(l.actorName)})</h3>
        <div class="stage"><div class="who">+${l.gained} point${l.gained === 1 ? '' : 's'}</div></div>
        <ul class="res">${l.items.map((i) => `<li class="${i.result}"><span>${esc(i.title)} <small>(${i.year})${i.guesser ? ' — ' + esc(i.guesser) : ''}</small></span><span>${i.result === 'guessed' ? '✅ +' + i.points : i.result === 'skipped' ? '⏭ skipped' : '❌ missed'}</span></li>`).join('') || '<li><span>No movies attempted</span><span></span></li>'}</ul></div>
        ${l.final || !S.nextUp ? '<div class="stage hint">That was the last turn! 🏆</div>'
          : `<div class="stage"><div class="hint">Up next</div><div class="who"><em>${esc(S.nextUp.actorName)}</em> for ${esc(S.teams[S.nextUp.teamIdx].name)}</div></div>`}
        ${isHost() ? `<button class="btn" data-act="next">${l.final ? '🏆 See Final Results' : '▶ Start Next Turn'}</button>`
          : '<div class="stage hint">⏳ Waiting for the host to continue…</div>'}`;
    }
    setHTML($('g-stage'), html);

    const tt = S.turn;
    const opts = S.phase === 'turn' && tt.options;
    setHTML($('g-guess'), opts
      ? `<div class="stage hint" style="margin-top:10px">${tt.locked ? '🔒 You used your guess on this movie – wait for teammates' : '👇 Which movie is it? One try per movie!'}</div>
         <div class="opts">${opts.map((o, i) => `<button class="opt ${o.hidden ? 'gone' : ''}" data-act="pick" data-i="${i}" ${o.hidden || tt.locked ? 'disabled' : ''}>${esc(o.text)}</button>`).join('')}</div>` : '');
    const feed = S.phase === 'turn' && S.settings.online && tt.feed ? tt.feed : [];
    setHTML($('g-feed'), feed.length
      ? `<ul class="res feed">${feed.slice().reverse().map((f) => `<li class="${f.correct ? 'guessed' : ''}"><span><b>${esc(f.name)}</b>: ${esc(f.text)}</span><span>${f.correct ? '✅' : ''}</span></li>`).join('')}</ul>` : '');

    setHTML($('g-host'), isHost()
      ? `<div class="hostbar"><p>👑 Host controls</p><div class="row">
          ${S.phase === 'turn' ? '<button class="btn sec small" data-act="override">⏭ Next Actor / Override</button>' : ''}
          <button class="btn bad small" data-act="endGame">🏁 End Game</button></div></div>` : '');
    tick();
  }

  function renderEnd() {
    show('end');
    const ranked = S.teams.filter((t) => S.activeTeams.includes(t.idx)).sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const tied = ranked.filter((t) => t.score === top.score);
    const order = ranked.length >= 3 ? [ranked[1], ranked[0], ranked[2]] : ranked.length === 2 ? [ranked[1], ranked[0]] : ranked;
    const pos = (t) => ranked.indexOf(t) + 1;
    const hist = S.history || [];
    const guessed = hist.filter((h) => h.result === 'guessed').length;
    setHTML(views.end, `
      <div class="logo"><h1>🏆 Game Over</h1></div>
      <div class="winner">${tied.length > 1 ? `It’s a tie! ${tied.map((t) => esc(t.name)).join(' & ')}` : `${esc(top.name)} wins!`}</div>
      <div class="podium">${order.map((t) => `
        <div class="pod p${pos(t)} ${TEAM_CLASS(t.idx)}"><div class="nm">${esc(t.name)}</div>
          <div class="blk">${t.score}<small>${['🥇', '🥈', '🥉'][pos(t) - 1] || ''} #${pos(t)}</small></div></div>`).join('')}</div>
      <div class="card"><h3>🎞 Movies acted out (${hist.length}) · ${guessed} guessed</h3>
        <ul class="res">${hist.map((h) => `<li class="${h.result}"><span>${esc(h.title)} <small>(${h.year}) — ${esc(h.actor)}, ${esc(h.team)}${h.guesser ? ' · guessed by ' + esc(h.guesser) : ''}</small></span><span>${h.result === 'guessed' ? '✅' : h.result === 'skipped' ? '⏭' : '❌'}</span></li>`).join('') || '<li><span>None</span><span></span></li>'}</ul></div>
      ${isHost() ? '<button class="btn" data-act="again">🔁 Play Again (back to lobby)</button>' : '<div class="stage hint">Waiting for host to play again…</div>'}
      <button class="btn sec" data-act="leave">Leave room</button>`);
  }

  /* ---------- synced countdown ---------- */
  function tick() {
    if (!S || S.phase !== 'turn' || !S.turn || S.turn.status !== 'running') { lastTickSec = -1; return; }
    const t = S.turn;
    const msLeft = t.endsAt - (Date.now() + offset);
    const sec = Math.max(0, Math.ceil(msLeft / 1000));
    const el = $('timer');
    if (el) {
      el.textContent = sec;
      el.classList.toggle('low', sec <= 10);
    }
    const bar = $('bar');
    if (bar) bar.style.width = Math.max(0, Math.min(100, (msLeft / (t.duration * 1000)) * 100)) + '%';
    if (sec !== lastTickSec) {
      if (sec > 0 && sec <= 5) sfx.tick();
      lastTickSec = sec;
    }
    if (msLeft <= 0 && buzzedFor !== t.endsAt) { buzzedFor = t.endsAt; sfx.buzzer(); }
  }
  setInterval(tick, 200);

  render();
})();
