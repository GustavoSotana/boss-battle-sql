'use strict';
/*
  game.js — BOSS BATTLE SQL
  Telas, movimentação, combate em tempo real, perguntas, chefe BUG-404 e ranking.
  A pontuação OFICIAL é calculada no servidor (veja sql/01_schema.sql).
  A pontuação mostrada durante a partida é apenas provisória.
*/
(function () {
  // ======================= constantes =======================
  const W = 1280, H = 720;
  const AR = { x: 30, y: 80, w: 1220, h: 600 };      // área jogável da arena
  const MATCH_SECONDS = 600;                          // 10 minutos (relógio de parede)
  const BOSS_UNLOCK = 6;                              // desafios respondidos para o chefe aparecer
  const KILL_CAP = 40;                                // robôs que contam pontos
  const ORDER = ['GRANT', 'REVOKE', 'CREATE INDEX', 'DROP INDEX'];
  const CMDS = window.COMMANDS;
  const PIXEL = "'Press Start 2P', 'Courier New', monospace";
  const TERMS = [
    { cmd: 'GRANT', x: 190, y: 200 }, { cmd: 'REVOKE', x: 1090, y: 200 },
    { cmd: 'CREATE INDEX', x: 190, y: 570 }, { cmd: 'DROP INDEX', x: 1090, y: 570 }
  ];
  const ETYPES = {
    drone:   { hp: 30, spd: 88, r: 15, dmg: 8 },
    shooter: { hp: 26, spd: 62, r: 15, dmg: 0, fire: 1.9 },
    tank:    { hp: 80, spd: 50, r: 20, dmg: 14 }
  };

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const fmtDur = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');

  // ======================= áudio =======================
  let muted = false;
  try { muted = localStorage.getItem('bbsql_muted') === '1'; } catch (e) { /* ignora */ }
  let actx = null;
  function beep(freq, dur, type, vol, slide) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol || 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur);
    } catch (e) { /* áudio é opcional */ }
  }
  const later = (fn, ms) => setTimeout(fn, ms);
  const SFX = {
    click: () => beep(660, 0.05, 'square', 0.03),
    slash: () => beep(520, 0.1, 'sawtooth', 0.04, -300),
    hit: () => beep(220, 0.07, 'square', 0.04, -120),
    kill: () => beep(380, 0.12, 'square', 0.05, 300),
    shot: () => beep(900, 0.05, 'square', 0.02, -400),
    hurt: () => beep(130, 0.25, 'sawtooth', 0.07, -60),
    ok: () => { beep(523, 0.1, 'triangle', 0.07); later(() => beep(784, 0.2, 'triangle', 0.07), 100); },
    bad: () => beep(200, 0.35, 'sawtooth', 0.07, -120),
    power: () => { beep(300, 0.4, 'sine', 0.07, 600); },
    boss: () => beep(70, 0.9, 'sawtooth', 0.09, 40),
    win: () => { [523, 659, 784, 1046].forEach((f, i) => later(() => beep(f, 0.2, 'triangle', 0.07), i * 140)); },
    lose: () => { [330, 262, 196].forEach((f, i) => later(() => beep(f, 0.3, 'sawtooth', 0.06), i * 200)); }
  };
  function refreshMuteButtons() {
    document.querySelectorAll('.mute-btn').forEach((b) => {
      b.textContent = b.classList.contains('hud-mute') ? (muted ? 'SOM OFF' : 'SOM ON') : (muted ? 'SOM: DESLIGADO' : 'SOM: LIGADO');
    });
  }
  document.querySelectorAll('.mute-btn').forEach((b) => b.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('bbsql_muted', muted ? '1' : '0'); } catch (e) { /* ignora */ }
    refreshMuteButtons(); SFX.click(); b.blur();
  }));
  refreshMuteButtons();

  // ======================= sprites pixel art =======================
  const SPR_MAPS = {
    player: [
      '....oooo....', '...ohhhho...', '..ohhhhhho..', '..ohvvvvho..', '..ohvvvvho..', '..ohhhhhho..',
      '...obbbbo...', '.oobbaabboo.', 'obbbbaabbbbo', '.obbbbbbbbo.', '..obbooobbo.', '..ooo..ooo..'
    ],
    drone: [
      '....oooo....', '..oorrrroo..', '.orrrrrrrro.', 'orrrddddrrro', 'orreeddeerro', 'orrrddddrrro',
      '.orrrrrrrro.', '..oorrrroo..', '.o.oooooo.o.', 'o..o....o..o', 'o..........o', '............'
    ],
    shooter: [
      '.....oo.....', '.....oo.....', '....oqqo....', '..ooppppoo..', '.oppppppppo.', 'oppeeppeeppo',
      'oppeeppeeppo', '.oppppppppo.', '..oopqqpoo..', '...oppppo...', '..oo.oo.oo..', '............'
    ],
    tank: [
      '..oooooooooo..', '.ommmmmmmmmmo.', 'ommMMMMMMMMmmo', 'ommMrrMMrrMmmo', 'ommMrrMMrrMmmo', 'ommMMMMMMMMmmo',
      'oommmmmmmmmmoo', 'ommmoooooommmo', 'ommmoMMMMommmo', 'ommmoooooommmo', 'oommmmmmmmmmoo',
      '.ommmmmmmmmmo.', '..oooooooooo..', '..oo......oo..'
    ]
  };
  const SPR_PAL = {
    player: { o: '#0a0e22', h: '#7dd3fc', v: '#eaffff', b: '#2563eb', a: '#e879f9' },
    drone: { o: '#0a0e22', r: '#ef4444', d: '#7f1d1d', e: '#fde047' },
    shooter: { o: '#0a0e22', p: '#8b5cf6', q: '#c4b5fd', e: '#22d3ee' },
    tank: { o: '#0a0e22', m: '#475569', M: '#94a3b8', r: '#f43f5e' }
  };
  function buildSprite(map, pal, scale, white) {
    const c = document.createElement('canvas');
    c.width = map[0].length * scale; c.height = map.length * scale;
    const g = c.getContext('2d');
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        const ch = map[y][x];
        if (ch === '.' || !pal[ch]) continue;
        g.fillStyle = white ? '#ffffff' : pal[ch];
        g.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return c;
  }
  const SPR = {};
  Object.keys(SPR_MAPS).forEach((k) => {
    SPR[k] = { n: buildSprite(SPR_MAPS[k], SPR_PAL[k], 3, false), f: buildSprite(SPR_MAPS[k], SPR_PAL[k], 3, true) };
  });

  // ======================= canvas e fundo =======================
  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  const bg = document.createElement('canvas');
  bg.width = W; bg.height = H;
  (function paintBackground() {
    const c = bg.getContext('2d');
    c.fillStyle = '#04060f'; c.fillRect(0, 0, W, H);
    // painéis tecnológicos fora da arena
    for (let i = 0; i < 140; i++) {
      c.fillStyle = 'rgba(56,189,248,' + (0.03 + (i % 5) * 0.01) + ')';
      c.fillRect((i * 97) % W, (i * 53) % H, 20 + (i % 4) * 14, 4);
    }
    // piso
    const g = c.createRadialGradient(W / 2, AR.y + AR.h / 2, 60, W / 2, AR.y + AR.h / 2, 700);
    g.addColorStop(0, '#13214f'); g.addColorStop(1, '#070b22');
    c.fillStyle = g; c.fillRect(AR.x, AR.y, AR.w, AR.h);
    for (let y = AR.y; y < AR.y + AR.h; y += 40) {
      for (let x = AR.x; x < AR.x + AR.w; x += 40) {
        if (((x - AR.x) / 40 + (y - AR.y) / 40) % 2 === 0) { c.fillStyle = 'rgba(255,255,255,0.018)'; c.fillRect(x, y, 40, 40); }
      }
    }
    c.strokeStyle = 'rgba(56,189,248,0.12)'; c.lineWidth = 1;
    for (let x = AR.x; x <= AR.x + AR.w; x += 40) { c.beginPath(); c.moveTo(x, AR.y); c.lineTo(x, AR.y + AR.h); c.stroke(); }
    for (let y = AR.y; y <= AR.y + AR.h; y += 40) { c.beginPath(); c.moveTo(AR.x, y); c.lineTo(AR.x + AR.w, y); c.stroke(); }
    // círculo central
    c.strokeStyle = 'rgba(168,85,247,0.55)'; c.lineWidth = 4;
    c.beginPath(); c.arc(W / 2, AR.y + AR.h / 2, 150, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,59,107,0.35)'; c.lineWidth = 2;
    c.beginPath(); c.arc(W / 2, AR.y + AR.h / 2, 110, 0, Math.PI * 2); c.stroke();
    // brilhos nos cantos
    [[AR.x, AR.y, '#ff3b6b'], [AR.x + AR.w, AR.y, '#a855f7'], [AR.x, AR.y + AR.h, '#a855f7'], [AR.x + AR.w, AR.y + AR.h, '#ff3b6b']].forEach((p) => {
      const rg = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], 260);
      rg.addColorStop(0, p[2] + '55'); rg.addColorStop(1, 'transparent');
      c.fillStyle = rg; c.fillRect(AR.x, AR.y, AR.w, AR.h);
    });
    // paredes neon
    c.shadowColor = '#38bdf8'; c.shadowBlur = 22; c.strokeStyle = '#38bdf8'; c.lineWidth = 5;
    c.strokeRect(AR.x, AR.y, AR.w, AR.h);
    c.shadowBlur = 0; c.strokeStyle = 'rgba(168,85,247,0.7)'; c.lineWidth = 2;
    c.strokeRect(AR.x + 8, AR.y + 8, AR.w - 16, AR.h - 16);
  })();

  // ======================= telas =======================
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (id === 'screen-game') fitStage();
    if (id === 'screen-title') loadRanking('title');
    if (id === 'screen-rank') { renderMyPos(); loadRanking('full'); }
    window.scrollTo(0, 0);
  }
  function fitStage() {
    const stage = $('stage');
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.width = Math.floor(W * s) + 'px';
    stage.style.height = Math.floor(H * s) + 'px';
    stage.style.setProperty('--u', String(s));
  }
  window.addEventListener('resize', fitStage);

  // ======================= ranking =======================
  let myPos = null; // { position, total, score, nickname }

  function renderRows(tbody, rows) {
    tbody.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (Number(r.pos) === 1) tr.className = 'top1';
      if (myPos && Number(r.pos) === Number(myPos.position) && r.nickname === myPos.nickname) tr.classList.add('me');
      [String(r.pos), r.nickname, String(r.score), String(r.correct_count), fmtDur(r.duration_seconds)].forEach((txt) => {
        const td = document.createElement('td'); td.textContent = txt; tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  async function loadRanking(kind) {
    const tbody = $(kind === 'title' ? 'title-rank-body' : 'rank-body');
    const status = $(kind === 'title' ? 'title-rank-status' : 'rank-status');
    if (!window.API.configured) {
      tbody.innerHTML = '';
      status.textContent = 'Ranking indisponível: o Supabase ainda não foi configurado (veja o README).';
      return;
    }
    status.textContent = 'Carregando ranking...';
    try {
      const rows = await window.API.leaderboard(kind === 'title' ? 10 : 50);
      renderRows(tbody, rows || []);
      status.textContent = rows && rows.length ? '' : 'Ninguém terminou uma partida ainda. Seja o primeiro!';
    } catch (e) {
      tbody.innerHTML = '';
      status.textContent = 'Não foi possível carregar o ranking. Verifique a conexão e clique em ATUALIZAR.';
    }
  }
  function renderMyPos() {
    const box = $('my-pos-box');
    if (!myPos || !myPos.position) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = 'Sua posição: #' + myPos.position + ' de ' + myPos.total + ' · ' + myPos.score + ' pontos (' + myPos.nickname + ')';
  }
  setInterval(() => {
    const t = $('screen-title').classList.contains('active'), r = $('screen-rank').classList.contains('active');
    if (t) loadRanking('title'); else if (r) loadRanking('full');
  }, 20000);

  // ======================= menu e entrada =======================
  $('btn-play').onclick = () => { SFX.click(); $('login-msg').textContent = ''; showScreen('screen-login'); $('in-nick').focus(); };
  $('btn-training').onclick = () => { SFX.click(); startGame(window.API.training()); };
  $('btn-ranking').onclick = () => { SFX.click(); showScreen('screen-rank'); };
  $('btn-help').onclick = () => { SFX.click(); showScreen('screen-help'); };
  $('btn-help-back').onclick = () => showScreen('screen-title');
  $('btn-login-back').onclick = () => showScreen('screen-title');
  $('btn-rank-back').onclick = () => showScreen('screen-title');
  $('btn-title-refresh').onclick = () => loadRanking('title');
  $('btn-rank-refresh').onclick = () => loadRanking('full');
  $('btn-res-rank').onclick = () => showScreen('screen-rank');
  $('btn-res-home').onclick = () => { S = null; showScreen('screen-title'); };

  function loginMsg(text, isError) {
    const m = $('login-msg'); m.textContent = text; m.classList.toggle('error', !!isError);
  }
  $('btn-start-official').onclick = async () => {
    const nick = $('in-nick').value.trim().replace(/\s+/g, ' ');
    const code = $('in-code').value.trim();
    if (!window.API.configured) { loginMsg('O servidor ainda não foi configurado (veja o README). Use o MODO TREINO por enquanto.', true); return; }
    if (nick.length < 2 || nick.length > 20) { loginMsg('Escreva um nome de jogador com 2 a 20 caracteres.', true); return; }
    if (code.length < 4) { loginMsg('Digite o código individual que o professor entregou.', true); return; }
    if (!$('chk-understand').checked) { loginMsg('Marque a caixa para confirmar que entendeu a regra da tentativa única.', true); return; }
    const btn = $('btn-start-official');
    btn.disabled = true; loginMsg('Validando seu código no servidor...', false);
    try {
      const r = await window.API.start(code, nick);
      if (!r.ok) { handleStartError(r); return; }
      loginMsg('', false);
      startGame(r);
    } catch (e) {
      loginMsg('Sem conexão com o servidor. Sua tentativa NÃO foi usada se a mensagem de erro apareceu antes de entrar; confira a internet e tente de novo. Se o problema continuar, chame o professor.', true);
    } finally {
      btn.disabled = false;
    }
  };
  function handleStartError(r) {
    if (r.error === 'CODIGO_INVALIDO') loginMsg('Código não encontrado. Confira as letras e números com o professor.', true);
    else if (r.error === 'NICK_INVALIDO') loginMsg('Nome de jogador inválido. Use de 2 a 20 letras, números, espaço, ponto, hífen ou sublinhado.', true);
    else if (r.error === 'TENTATIVA_USADA') {
      const res = r.result;
      let t = 'Sua tentativa oficial já foi utilizada. Cada aluno joga uma única vez.';
      if (res && res.ok) {
        t += ' Seu resultado: ' + res.score + ' pontos, posição #' + res.position + ' de ' + res.total + '.';
        myPos = { position: res.position, total: res.total, score: res.score, nickname: res.nickname };
      } else {
        t += ' Ela ainda está registrada como em andamento ou foi encerrada por tempo.';
      }
      t += ' Se houve falha técnica, fale com o professor.';
      loginMsg(t, true);
    } else loginMsg('Não foi possível entrar (' + (r.error || 'erro') + '). Avise o professor.', true);
  }

  // ======================= estado da partida =======================
  let S = null, rafId = 0, lastTs = 0;
  const keys = {};

  function newMatch(session) {
    const queue = {}, qi = {};
    ORDER.forEach((c) => { queue[c] = []; qi[c] = 0; });
    session.questions.forEach((q) => queue[q.command].push(q));
    S = {
      session, training: session.mode === 'training', startMs: performance.now(), state: 'play',
      endTimer: 0, outcome: null, t: 0,
      p: { x: 640, y: 420, r: 13, hp: 100, max: 100, face: { x: 0, y: 1 }, atkCd: 0, inv: 0, boost: 0, flash: 0 },
      enemies: [], bullets: [], shots: [], drones: [], parts: [], floats: [], rings: [], pickups: [],
      boss: null, bossWarn: 0, bossSpawned: false, bossDead: false,
      terms: TERMS.map((t) => ({ cmd: t.cmd, x: t.x, y: t.y })), queue, qi, cur: null,
      answered: 0, correct: 0, wrong: 0, kills: 0, spawnT: 1.2, shake: 0, redFlash: 0,
      banner: null, nearTerm: null, chipsHtml: '', finalSent: false
    };
  }
  const elapsed = () => Math.min(MATCH_SECONDS, (performance.now() - S.startMs) / 1000);
  const provisional = () => S.correct * 100 + Math.min(S.kills, KILL_CAP) * 50 + (S.bossDead ? 300 : 0);

  function startGame(session) {
    newMatch(session);
    $('mode-tag').hidden = !S.training;
    $('boss-bar').hidden = true;
    $('qmodal').hidden = true; $('pause').hidden = true;
    for (const k in keys) delete keys[k];
    showScreen('screen-game');
    cancelAnimationFrame(rafId);
    lastTs = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function frame(ts) {
    if (!S || S.state === 'over') return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    update(dt);
    if (!S || S.state === 'over') return;
    render();
    updateHud();
    rafId = requestAnimationFrame(frame);
  }

  // ======================= efeitos =======================
  function spark(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, 200);
      S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, color, size: rand(2, 5) });
    }
  }
  function float(x, y, text, color) { S.floats.push({ x, y, text, color: color || '#fff', life: 1.0 }); }
  function ring(x, y, max, dur, color, kind, a) { S.rings.push({ x, y, max, t: 0, dur, color, kind: kind || 'ring', a: a || 0 }); }
  function tickFx(dt) {
    S.parts.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; });
    S.parts = S.parts.filter((p) => p.life > 0);
    S.floats.forEach((f) => { f.y -= 38 * dt; f.life -= dt; });
    S.floats = S.floats.filter((f) => f.life > 0);
    S.rings.forEach((r) => { r.t += dt; });
    S.rings = S.rings.filter((r) => r.t < r.dur);
    S.shake = Math.max(0, S.shake - 30 * dt);
    S.redFlash = Math.max(0, S.redFlash - dt);
    if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
  }

  // ======================= combate =======================
  function hurtPlayer(d, force) {
    const p = S.p;
    if (!force && p.inv > 0) return false;
    p.hp = Math.max(0, p.hp - d);
    p.inv = force ? 0.3 : 0.7; p.flash = 0.15;
    S.shake = Math.max(S.shake, 7); S.redFlash = 0.25;
    SFX.hurt(); float(p.x, p.y - 26, '-' + d, '#ff5470'); spark(p.x, p.y, '#ff5470', 9);
    if (p.hp <= 0 && S.state === 'play') startEnding('defeat');
    return true;
  }

  function attack() {
    const p = S.p;
    p.atkCd = p.boost > 0 ? 0.27 : 0.4;
    const range = 82, dmg = p.boost > 0 ? 25 : 20;
    SFX.slash();
    ring(p.x, p.y, range, 0.18, p.boost > 0 ? '#e879f9' : '#7dd3fc', 'slash', Math.atan2(p.face.y, p.face.x));
    S.enemies.slice().forEach((e) => {
      const d = dist(p, e);
      if (d <= range + e.r) {
        const k = 160 / Math.max(d, 1);
        hurtEnemy(e, dmg, (e.x - p.x) * k, (e.y - p.y) * k);
      }
    });
    if (S.boss && dist(p, S.boss) <= range + S.boss.r) hurtEnemy(S.boss, dmg, 0, 0);
  }

  function hurtEnemy(e, dmg, kx, ky) {
    if (e.dead || e.appear > 0) return;
    if (e.vuln > 0) dmg *= 1.5;
    dmg = Math.round(dmg);
    if (e.sh > 0) {
      const a = Math.min(e.sh, dmg);
      e.sh -= a; dmg -= a; spark(e.x, e.y, '#c084fc', 5);
      if (e.sh <= 0) float(e.x, e.y - e.r - 8, 'ESCUDO QUEBROU', '#c084fc');
    }
    if (dmg > 0) {
      e.hp -= dmg; e.flash = 0.1;
      float(e.x + rand(-8, 8), e.y - e.r, String(dmg), '#ffffff');
      spark(e.x, e.y, e.isBoss ? '#ff3b6b' : '#fb7185', 4);
    }
    e.vx += kx || 0; e.vy += ky || 0;
    SFX.hit();
    if (e.hp <= 0) { if (e.isBoss) killBoss(); else killEnemy(e); }
  }

  function killEnemy(e) {
    e.dead = true; S.kills++;
    spark(e.x, e.y, '#fbbf24', 14); ring(e.x, e.y, 40, 0.3, '#fbbf24');
    float(e.x, e.y - 22, S.kills <= KILL_CAP ? '+50' : 'LIMITE', '#fbbf24');
    SFX.kill();
    if (Math.random() < 0.18) S.pickups.push({ x: e.x, y: e.y, life: 10, amt: 14 });
  }

  function killBoss() {
    const b = S.boss;
    S.bossDead = true;
    spark(b.x, b.y, '#ff3b6b', 50); spark(b.x, b.y, '#a855f7', 40); spark(b.x, b.y, '#fbbf24', 30);
    ring(b.x, b.y, 420, 0.9, '#ff3b6b'); ring(b.x, b.y, 280, 0.7, '#fbbf24');
    float(b.x, b.y - 70, '+300 BUG-404 DERROTADO!', '#fbbf24');
    S.enemies.forEach((e) => { e.dead = true; spark(e.x, e.y, '#fb7185', 8); });
    S.bullets = []; S.boss = null; S.shake = 18;
    startEnding('victory');
  }

  function startEnding(outcome) {
    if (S.state === 'ending' || S.state === 'over') return;
    S.state = 'ending'; S.outcome = outcome;
    S.endTimer = outcome === 'victory' ? 2.2 : 1.5;
    if (outcome === 'victory') SFX.win(); else SFX.lose();
    if (outcome === 'defeat') { const p = S.p; spark(p.x, p.y, '#38bdf8', 40); spark(p.x, p.y, '#ff3b6b', 20); }
  }

  function fireRing(x, y, n, speed, dmg, color, offset) {
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      S.bullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 6, dmg, life: 6, color });
    }
  }
  function specialAttack() {
    const src = S.boss || (S.enemies.length ? S.enemies[Math.floor(Math.random() * S.enemies.length)] : { x: W / 2, y: AR.y + 90 });
    float(S.p.x, S.p.y - 50, 'ATAQUE ESPECIAL: SQL INJECTION!', '#ff3b6b');
    fireRing(src.x, src.y, 12, 190, 8, '#ff3b6b', rand(0, 6));
    ring(src.x, src.y, 120, 0.5, '#ff3b6b');
    S.shake = Math.max(S.shake, 8);
  }

  // ======================= poderes (metáforas do jogo) =======================
  function applyAbility(cmd) {
    const p = S.p;
    SFX.power();
    if (cmd === 'GRANT') {
      S.drones.push({ a: rand(0, 6.28), cd: 0.4, x: p.x, y: p.y });
      ring(p.x, p.y, 120, 0.6, '#38bdf8'); spark(p.x, p.y, '#38bdf8', 20);
      float(p.x, p.y - 40, 'DRONE ALIADO ONLINE!', '#38bdf8');
    } else if (cmd === 'REVOKE') {
      let n = 0;
      S.enemies.forEach((e) => { if (e.sh > 0) n++; e.sh = 0; e.vuln = 8; spark(e.x, e.y, '#ff3b6b', 10); });
      if (S.boss) { if (S.boss.sh > 0) n++; S.boss.sh = 0; S.boss.vuln = 6; }
      ring(p.x, p.y, 760, 0.7, '#ff3b6b'); ring(p.x, p.y, 420, 0.5, '#ff7a93');
      float(p.x, p.y - 40, n ? 'ESCUDOS REVOGADOS: ' + n : 'PRIVILÉGIOS REVOGADOS!', '#ff3b6b');
      S.shake = 6;
    } else if (cmd === 'CREATE INDEX') {
      p.boost = Math.min(p.boost + 25, 50);
      ring(p.x, p.y, 100, 0.7, '#a855f7'); ring(p.x, p.y, 60, 0.5, '#e879f9');
      for (let i = 0; i < 30; i++) S.parts.push({ x: p.x + rand(-20, 20), y: p.y + rand(-10, 20), vx: rand(-30, 30), vy: rand(-220, -80), life: rand(0.5, 1), max: 1, color: '#e879f9', size: rand(2, 5) });
      float(p.x, p.y - 40, 'INDEX BOOST: VELOCIDADE E ATAQUE!', '#e879f9');
    } else if (cmd === 'DROP INDEX') {
      S.enemies.forEach((e) => { e.buff = false; e.slow = 6; spark(e.x, e.y, '#fbbf24', 12); });
      if (S.boss) { S.boss.enrageOff = 8; S.boss.slow = 6; }
      ring(p.x, p.y, 760, 0.7, '#fbbf24'); ring(p.x, p.y, 380, 0.5, '#fde68a');
      float(p.x, p.y - 40, 'ÍNDICES REMOVIDOS DOS INIMIGOS!', '#fbbf24');
      S.shake = 6;
    }
  }

  // ======================= atualização =======================
  function update(dt) {
    if (S.state === 'over') return;
    if (S.state === 'ending') {
      S.endTimer -= dt; tickFx(dt);
      if (S.endTimer <= 0) finishMatch(S.outcome);
      return;
    }
    if (elapsed() >= MATCH_SECONDS) { finishMatch('timeout'); return; }
    if (S.state !== 'play') return; // pergunta ou pausa: combate parado (o relógio continua)
    S.t += dt;
    updatePlayer(dt);
    updateSpawns(dt);
    updateEnemies(dt);
    updateBoss(dt);
    updateDrones(dt);
    updateBullets(dt);
    updatePickups(dt);
    tickFx(dt);
    // terminal próximo
    S.nearTerm = null;
    let best = 75;
    S.terms.forEach((t) => {
      const d = dist(S.p, t);
      if (d < best && remaining(t.cmd) > 0) { best = d; S.nearTerm = t; }
    });
  }
  const remaining = (cmd) => S.queue[cmd].length - S.qi[cmd];

  function updatePlayer(dt) {
    const p = S.p;
    let dx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let dy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (dx || dy) { const l = Math.hypot(dx, dy); dx /= l; dy /= l; p.face = { x: dx, y: dy }; }
    const sp = 190 * (p.boost > 0 ? 1.3 : 1);
    p.x = clamp(p.x + dx * sp * dt, AR.x + p.r + 4, AR.x + AR.w - p.r - 4);
    p.y = clamp(p.y + dy * sp * dt, AR.y + p.r + 4, AR.y + AR.h - p.r - 4);
    p.atkCd -= dt; p.inv -= dt; p.boost -= dt; p.flash -= dt;
    if (keys.Space && p.atkCd <= 0) attack();
    if (p.boost > 0 && Math.random() < dt * 40) S.parts.push({ x: p.x + rand(-8, 8), y: p.y + 10, vx: rand(-20, 20), vy: rand(20, 60), life: 0.4, max: 0.4, color: '#e879f9', size: 3 });
  }

  function edgePoint() {
    let best = null, bd = -1;
    for (let i = 0; i < 4; i++) {
      const side = Math.floor(Math.random() * 4);
      let x, y;
      if (side === 0) { x = rand(AR.x + 40, AR.x + AR.w - 40); y = AR.y + 40; }
      else if (side === 1) { x = rand(AR.x + 40, AR.x + AR.w - 40); y = AR.y + AR.h - 40; }
      else if (side === 2) { x = AR.x + 40; y = rand(AR.y + 40, AR.y + AR.h - 40); }
      else { x = AR.x + AR.w - 40; y = rand(AR.y + 40, AR.y + AR.h - 40); }
      const d = Math.hypot(x - S.p.x, y - S.p.y);
      if (d > bd) { bd = d; best = { x, y }; }
    }
    return best;
  }
  function spawnEnemy(type, x, y) {
    const T = ETYPES[type], el = elapsed();
    S.enemies.push({
      type, x, y, r: T.r, hp: T.hp, max: T.hp, spd: T.spd, dmg: T.dmg, fire: T.fire || 0,
      sh: Math.random() < Math.min(0.5, 0.12 + el / 700) ? (type === 'tank' ? 40 : 22) : 0,
      buff: Math.random() < Math.min(0.4, 0.15 + el / 900),
      cd: rand(0.5, 1.3), flash: 0, vuln: 0, slow: 0, vx: 0, vy: 0, appear: 0.6, dead: false, isBoss: false
    });
  }
  function updateSpawns(dt) {
    const el = elapsed();
    if (S.bossWarn > 0) {
      S.bossWarn -= dt;
      if (S.bossWarn <= 0) spawnBoss();
      return;
    }
    if (!S.bossSpawned && S.answered >= BOSS_UNLOCK) {
      S.bossWarn = 3; S.banner = { text: 'BUG-404 DETECTADO!', t: 3 }; SFX.boss(); return;
    }
    S.spawnT -= dt;
    const cap = S.bossSpawned ? 3 : Math.min(8, 4 + Math.floor(el / 90));
    if (S.spawnT <= 0) {
      S.spawnT = Math.max(1.5, 3.0 - el / 250);
      if (S.enemies.length < cap) {
        const r = Math.random();
        const type = r < 0.55 ? 'drone' : (r < 0.85 || el < 60 ? 'shooter' : 'tank');
        const pt = edgePoint();
        spawnEnemy(type, pt.x, pt.y);
      }
    }
  }

  function updateEnemies(dt) {
    S.enemies = S.enemies.filter((e) => !e.dead);
    const p = S.p;
    S.enemies.forEach((e) => {
      e.flash -= dt; e.vuln -= dt; e.slow -= dt; e.cd -= dt;
      if (e.appear > 0) { e.appear -= dt; return; }
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const sp = e.spd * (e.buff ? 1.4 : 1) * (e.slow > 0 ? 0.55 : 1);
      let mx = 0, my = 0;
      if (e.type === 'shooter') {
        if (d > 300) { mx = ux; my = uy; }
        else if (d < 210) { mx = -ux; my = -uy; }
        else { mx = -uy * 0.6; my = ux * 0.6; }
        if (e.cd <= 0) {
          e.cd = e.fire / (e.buff ? 1.4 : 1) / (e.slow > 0 ? 0.6 : 1);
          S.bullets.push({ x: e.x, y: e.y, vx: ux * 250, vy: uy * 250, r: 5, dmg: 8, life: 4, color: '#ff5470' });
          SFX.shot();
        }
      } else {
        mx = ux; my = uy;
        if (d < e.r + p.r + 4 && e.cd <= 0) { if (hurtPlayer(e.dmg)) e.cd = e.type === 'tank' ? 1.2 : 0.9; }
      }
      e.x += (mx * sp + e.vx) * dt; e.y += (my * sp + e.vy) * dt;
      e.vx *= Math.pow(0.002, dt); e.vy *= Math.pow(0.002, dt);
      e.x = clamp(e.x, AR.x + e.r, AR.x + AR.w - e.r); e.y = clamp(e.y, AR.y + e.r, AR.y + AR.h - e.r);
    });
    // separação simples entre robôs
    for (let i = 0; i < S.enemies.length; i++) {
      for (let j = i + 1; j < S.enemies.length; j++) {
        const a = S.enemies[i], b = S.enemies[j], d = dist(a, b), m = a.r + b.r;
        if (d > 0 && d < m) { const k = (m - d) / 2 / d; a.x -= (b.x - a.x) * k; a.y -= (b.y - a.y) * k; b.x += (b.x - a.x) * k; b.y += (b.y - a.y) * k; }
      }
    }
  }

  // ---------- chefe BUG-404 ----------
  function spawnBoss() {
    S.bossSpawned = true;
    S.boss = {
      isBoss: true, type: 'boss', x: 640, y: AR.y + 130, r: 56, hp: 800, max: 800, sh: 0, vuln: 0, flash: 0,
      phase: 1, state: 'idle', cd: 2.2, tt: 0, dt: 0, dx: 0, dy: 0, enrageOff: 0, slow: 0, last: '', vx: 0, vy: 0, appear: 0, dead: false
    };
    $('boss-bar').hidden = false;
    ring(640, AR.y + 130, 300, 0.8, '#a855f7'); S.shake = 14; SFX.boss();
    S.banner = { text: 'LUTE!', t: 1.5 };
  }
  function updateBoss(dt) {
    const b = S.boss; if (!b) return;
    const p = S.p;
    b.flash -= dt; b.vuln -= dt; b.enrageOff -= dt; b.slow -= dt;
    const frac = b.hp / b.max, ph = frac > 0.66 ? 1 : (frac > 0.33 ? 2 : 3);
    if (ph > b.phase) {
      b.phase = ph; b.sh = 110;
      float(b.x, b.y - 80, 'FASE ' + (ph + 1) + ': ESCUDO DE ACESSO ATIVO', '#c084fc');
      S.pickups.push({ x: b.x + 90, y: b.y + 60, life: 12, amt: 20 }, { x: b.x - 90, y: b.y + 60, life: 12, amt: 20 });
      ring(b.x, b.y, 320, 0.7, '#c084fc'); S.shake = 12; SFX.boss();
    }
    const enraged = b.phase === 3 && b.enrageOff <= 0;
    const d = dist(b, p);
    if (b.state === 'idle') {
      if (d > 230) { b.x += ((p.x - b.x) / d) * 40 * (b.slow > 0 ? 0.6 : 1) * (enraged ? 1.5 : 1) * dt; b.y += ((p.y - b.y) / d) * 40 * (b.slow > 0 ? 0.6 : 1) * (enraged ? 1.5 : 1) * dt; }
      b.cd -= dt * (enraged ? 1.4 : 1) * (b.slow > 0 ? 0.6 : 1);
      if (b.cd <= 0) bossPickAttack(b);
    } else if (b.state === 'tele') {
      b.tt -= dt * (b.slow > 0 ? 0.6 : 1);
      b.x += rand(-1.5, 1.5); b.y += rand(-1.5, 1.5);
      if (b.tt <= 0) {
        const a = Math.atan2(p.y - b.y, p.x - b.x);
        b.dx = Math.cos(a); b.dy = Math.sin(a); b.state = 'dash'; b.dt = 0.55; SFX.shot();
      }
    } else if (b.state === 'dash') {
      b.x += b.dx * 560 * dt; b.y += b.dy * 560 * dt; b.dt -= dt;
      S.parts.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.4, max: 0.4, color: '#a855f7', size: 8 });
      if (dist(b, p) < b.r + p.r) hurtPlayer(18);
      if (b.dt <= 0) { b.state = 'idle'; b.cd = 1.0; }
    }
    b.x = clamp(b.x, AR.x + b.r, AR.x + AR.w - b.r); b.y = clamp(b.y, AR.y + b.r, AR.y + AR.h - b.r);
    if (b.state !== 'dash' && dist(b, p) < b.r + p.r - 4) hurtPlayer(12);
  }
  function bossPickAttack(b) {
    const p = S.p;
    const list = ['ring', 'spread', 'dash'];
    if (b.phase >= 2) list.push('summon');
    let pick = list[Math.floor(Math.random() * list.length)];
    if (pick === b.last) pick = list[(list.indexOf(pick) + 1) % list.length];
    b.last = pick;
    const base = Math.max(1.3, 2.5 - 0.3 * b.phase);
    if (pick === 'ring') {
      fireRing(b.x, b.y, b.phase === 3 ? 20 : 14, 150 + b.phase * 20, 9, '#e879f9', rand(0, 6));
      ring(b.x, b.y, 150, 0.5, '#e879f9'); b.cd = base; SFX.boss();
    } else if (pick === 'spread') {
      const a0 = Math.atan2(p.y - b.y, p.x - b.x), n = b.phase > 1 ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i - (n - 1) / 2) * 0.2;
        S.bullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * 290, vy: Math.sin(a) * 290, r: 7, dmg: 10, life: 4, color: '#ff3b6b' });
      }
      b.cd = base * 0.8; SFX.shot();
    } else if (pick === 'dash') {
      b.state = 'tele'; b.tt = 0.85; float(b.x, b.y - 80, 'CARGA!', '#ff3b6b');
    } else {
      for (let i = 0; i < 2; i++) { if (S.enemies.length < 8) spawnEnemy('drone', b.x + (i ? 70 : -70), b.y + 40); }
      float(b.x, b.y - 80, 'BUG-404 INVOCA ROBÔS!', '#c084fc'); b.cd = base;
    }
  }

  function updateDrones(dt) {
    S.drones.forEach((d, i) => {
      d.a += dt * 2.2;
      const ang = d.a + (i * Math.PI * 2) / Math.max(1, S.drones.length);
      d.x = S.p.x + Math.cos(ang) * 50; d.y = S.p.y + Math.sin(ang) * 50;
      d.cd -= dt;
      if (d.cd <= 0) {
        let tgt = null, bd = 340;
        S.enemies.forEach((e) => { const dd = dist(d, e); if (!e.dead && dd < bd) { bd = dd; tgt = e; } });
        if (S.boss && dist(d, S.boss) < bd) tgt = S.boss;
        if (tgt) {
          const a = Math.atan2(tgt.y - d.y, tgt.x - d.x);
          S.shots.push({ x: d.x, y: d.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, life: 1, dmg: 10 });
          d.cd = 0.8; SFX.shot();
        } else d.cd = 0.2;
      }
    });
  }

  function updateBullets(dt) {
    const p = S.p;
    S.bullets.forEach((b) => {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.x < AR.x || b.x > AR.x + AR.w || b.y < AR.y || b.y > AR.y + AR.h) b.life = 0;
      if (b.life > 0 && Math.hypot(b.x - p.x, b.y - p.y) < b.r + p.r) { if (hurtPlayer(b.dmg)) { b.life = 0; spark(b.x, b.y, b.color, 5); } }
    });
    S.bullets = S.bullets.filter((b) => b.life > 0);
    S.shots.forEach((s) => {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      const targets = S.boss ? S.enemies.concat([S.boss]) : S.enemies;
      for (const e of targets) {
        if (!e.dead && Math.hypot(s.x - e.x, s.y - e.y) < e.r + 4) { hurtEnemy(e, s.dmg, 0, 0); s.life = 0; break; }
      }
    });
    S.shots = S.shots.filter((s) => s.life > 0);
  }

  function updatePickups(dt) {
    const p = S.p;
    S.pickups.forEach((k) => {
      k.life -= dt;
      if (dist(k, p) < 28) {
        const g = Math.min(k.amt, p.max - p.hp);
        p.hp += g; k.life = 0; float(p.x, p.y - 28, '+' + k.amt + ' VIDA', '#4ade80'); spark(k.x, k.y, '#4ade80', 8); SFX.ok();
      }
    });
    S.pickups = S.pickups.filter((k) => k.life > 0);
  }

  // ======================= desenho =======================
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function drawSprite(spr, x, y, flash) {
    const c = flash ? spr.f : spr.n;
    ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
  }
  function drawBar(x, y, w, frac, color) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 4);
  }
  function drawEnemy(e) {
    const a = e.appear > 0 ? 0.25 + 0.5 * (1 - e.appear / 0.6) : 1;
    ctx.globalAlpha = a;
    const bob = Math.sin(S.t * 8 + e.x) * 1.5;
    if (e.buff) {
      ctx.fillStyle = 'rgba(255,59,107,0.22)'; circle(e.x, e.y + bob, e.r + 10); ctx.fill();
      ctx.strokeStyle = 'rgba(255,59,107,0.8)'; ctx.lineWidth = 2; circle(e.x, e.y + bob, e.r + 10 + Math.sin(S.t * 10) * 2); ctx.stroke();
    }
    drawSprite(SPR[e.type], e.x, e.y + bob, e.flash > 0);
    if (e.sh > 0) {
      ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -S.t * 30;
      circle(e.x, e.y + bob, e.r + 7); ctx.stroke(); ctx.setLineDash([]);
    }
    if (e.vuln > 0) { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; circle(e.x, e.y + bob, e.r + 3); ctx.stroke(); }
    if (e.slow > 0) { ctx.fillStyle = '#fbbf24'; ctx.fillRect(e.x - 3, e.y - e.r - 18, 6, 4); }
    drawBar(e.x, e.y - e.r - 10, 30, e.hp / e.max, '#ff5470');
    ctx.globalAlpha = 1;
  }
  function drawBoss(b) {
    const u = 8, t = S.t, bob = Math.sin(t * 3) * 3;
    const col = b.flash > 0 ? '#ffffff' : (b.phase === 3 ? '#ff2d55' : (b.phase === 2 ? '#d946ef' : '#7c3aed'));
    const shade = b.flash > 0 ? '#dddddd' : (b.phase === 3 ? '#be123c' : (b.phase === 2 ? '#a21caf' : '#5b21b6'));
    const glow = ctx.createRadialGradient(b.x, b.y, 20, b.x, b.y, 130);
    glow.addColorStop(0, b.phase === 3 ? 'rgba(255,45,85,0.45)' : 'rgba(168,85,247,0.4)'); glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow; ctx.fillRect(b.x - 140, b.y - 140, 280, 280);
    if (b.state === 'tele') {
      ctx.strokeStyle = 'rgba(255,59,107,' + (0.4 + 0.4 * Math.sin(t * 40)) + ')'; ctx.lineWidth = 6; ctx.setLineDash([16, 10]);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(S.p.x, S.p.y); ctx.stroke(); ctx.setLineDash([]);
    }
    // pernas
    ctx.fillStyle = '#1e0a3c';
    for (let i = 0; i < 3; i++) {
      const o = Math.sin(t * 6 + i) * 6;
      ctx.fillRect(b.x - 84 - o, b.y - 24 + i * 26 + bob, 28, 8); ctx.fillRect(b.x + 56 + o, b.y - 24 + i * 26 + bob, 28, 8);
    }
    // corpo em blocos
    for (let gy = -7; gy <= 7; gy++) {
      for (let gx = -8; gx <= 8; gx++) {
        const nx = gx / 7.6, ny = gy / 6.6, dd = nx * nx + ny * ny;
        if (dd <= 1) {
          ctx.fillStyle = dd > 0.74 ? '#1e0a3c' : (((gx + gy) & 1) ? col : shade);
          ctx.fillRect(Math.round(b.x + gx * u - u / 2), Math.round(b.y + gy * u - u / 2 + bob), u, u);
        }
      }
    }
    // antenas
    ctx.fillStyle = '#1e0a3c'; ctx.fillRect(b.x - 30, b.y - 76 + bob, 6, 22); ctx.fillRect(b.x + 24, b.y - 76 + bob, 6, 22);
    ctx.fillStyle = '#ff3b6b'; ctx.fillRect(b.x - 34, b.y - 84 + bob, 14, 10); ctx.fillRect(b.x + 20, b.y - 84 + bob, 14, 10);
    // olhos e "404"
    ctx.fillStyle = '#fde047'; ctx.fillRect(b.x - 32, b.y - 26 + bob, 16, 16); ctx.fillRect(b.x + 16, b.y - 26 + bob, 16, 16);
    ctx.fillStyle = '#000'; ctx.fillRect(b.x - 26, b.y - 22 + bob, 6, 8); ctx.fillRect(b.x + 22, b.y - 22 + bob, 6, 8);
    ctx.fillStyle = '#ffffff'; ctx.font = '18px ' + PIXEL; ctx.textAlign = 'center'; ctx.fillText('404', b.x, b.y + 30 + bob);
    if (b.phase === 3 && b.enrageOff <= 0) {
      ctx.strokeStyle = 'rgba(255,45,85,' + (0.5 + 0.4 * Math.sin(t * 14)) + ')'; ctx.lineWidth = 4; circle(b.x, b.y, b.r + 14); ctx.stroke();
    }
    if (b.sh > 0) {
      ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 5; ctx.setLineDash([14, 8]); ctx.lineDashOffset = -t * 40;
      circle(b.x, b.y, b.r + 12); ctx.stroke(); ctx.setLineDash([]);
    }
    if (b.vuln > 0) { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 3; circle(b.x, b.y, b.r + 4); ctx.stroke(); }
  }
  function drawTerm(t) {
    const c = CMDS[t.cmd].color, left = remaining(t.cmd), on = left > 0;
    ctx.fillStyle = '#0a1030'; ctx.fillRect(t.x - 30, t.y - 30, 60, 60);
    ctx.save();
    ctx.shadowColor = c; ctx.shadowBlur = on ? 18 : 0; ctx.strokeStyle = on ? c : '#334155'; ctx.lineWidth = 4;
    ctx.strokeRect(t.x - 30, t.y - 30, 60, 60); ctx.restore();
    ctx.fillStyle = on ? c + '55' : '#111827'; ctx.fillRect(t.x - 22, t.y - 22, 44, 30);
    ctx.fillStyle = on ? c : '#475569';
    for (let i = 0; i < 2; i++) ctx.fillRect(t.x - 14 + i * 20, t.y + 14, 8, 8);
    ctx.fillStyle = '#0a1030';
    for (let i = 0; i < 2; i++) if (i >= left) ctx.fillRect(t.x - 13 + i * 20, t.y + 15, 6, 6);
    ctx.fillStyle = on ? '#fff' : '#64748b'; ctx.textAlign = 'center'; ctx.font = '10px ' + PIXEL;
    const lines = t.cmd.split(' ');
    lines.forEach((ln, i) => ctx.fillText(ln, t.x, t.y - 38 - (lines.length - 1 - i) * 13));
    if (S.nearTerm === t) {
      ctx.fillStyle = '#fff'; ctx.font = '12px ' + PIXEL;
      ctx.fillText('[E] RESPONDER', t.x, t.y + 54 + Math.sin(S.t * 8) * 2);
    } else if (!on) {
      ctx.fillStyle = '#64748b'; ctx.font = '9px ' + PIXEL; ctx.fillText('OFFLINE', t.x, t.y + 52);
    }
  }
  function drawPlayer(p) {
    if (p.inv > 0 && Math.floor(S.t * 20) % 2 === 0) ctx.globalAlpha = 0.45;
    if (p.boost > 0) { ctx.strokeStyle = 'rgba(232,121,249,0.8)'; ctx.lineWidth = 3; circle(p.x, p.y, 26 + Math.sin(S.t * 12) * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 18, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    drawSprite(SPR.player, p.x, p.y, p.flash > 0);
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(p.x + p.face.x * 20, p.y + p.face.y * 20); ctx.lineTo(p.x + p.face.x * 30, p.y + p.face.y * 30); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (S.shake > 0) ctx.translate(rand(-S.shake, S.shake) * 0.5, rand(-S.shake, S.shake) * 0.5);
    ctx.drawImage(bg, 0, 0);
    S.terms.forEach(drawTerm);
    S.pickups.forEach((k) => {
      ctx.fillStyle = '#4ade80'; ctx.fillRect(k.x - 8, k.y - 3, 16, 6); ctx.fillRect(k.x - 3, k.y - 8, 6, 16);
      ctx.strokeStyle = 'rgba(74,222,128,0.6)'; ctx.lineWidth = 2; circle(k.x, k.y, 14 + Math.sin(S.t * 8) * 2); ctx.stroke();
    });
    // anéis e efeitos
    S.rings.forEach((r) => {
      const f = r.t / r.dur, al = 1 - f;
      ctx.strokeStyle = r.color; ctx.globalAlpha = Math.max(0, al);
      if (r.kind === 'slash') {
        ctx.lineWidth = 10 * al + 2; ctx.beginPath(); ctx.arc(r.x, r.y, r.max * (0.6 + 0.4 * f), r.a - 1.0, r.a + 1.0); ctx.stroke();
      } else { ctx.lineWidth = 5; circle(r.x, r.y, r.max * f); ctx.stroke(); }
      ctx.globalAlpha = 1;
    });
    S.enemies.slice().sort((a, b) => a.y - b.y).forEach(drawEnemy);
    if (S.boss) drawBoss(S.boss);
    S.bullets.forEach((b) => {
      ctx.fillStyle = b.color; ctx.globalAlpha = 0.35; circle(b.x, b.y, b.r + 4); ctx.fill();
      ctx.globalAlpha = 1; circle(b.x, b.y, b.r); ctx.fill();
      ctx.fillStyle = '#fff'; circle(b.x, b.y, b.r * 0.4); ctx.fill();
    });
    S.shots.forEach((s) => { ctx.fillStyle = '#7dd3fc'; ctx.fillRect(s.x - 4, s.y - 4, 8, 8); });
    S.drones.forEach((d) => {
      ctx.fillStyle = '#0a1030'; ctx.fillRect(d.x - 8, d.y - 8, 16, 16);
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(d.x - 6, d.y - 6, 12, 12); ctx.fillStyle = '#fff'; ctx.fillRect(d.x - 2, d.y - 2, 4, 4);
    });
    if (S.state !== 'ending' || S.outcome === 'victory') drawPlayer(S.p);
    S.parts.forEach((p) => { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    S.floats.forEach((f) => { ctx.globalAlpha = clamp(f.life * 1.5, 0, 1); ctx.font = '700 22px Rajdhani, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y); });
    ctx.globalAlpha = 1;
    ctx.restore();
    if (S.redFlash > 0) { ctx.fillStyle = 'rgba(255,0,60,' + S.redFlash * 0.8 + ')'; ctx.fillRect(0, AR.y, W, AR.h); }
    if (S.p.hp <= 30 && S.state === 'play') { ctx.strokeStyle = 'rgba(255,0,60,' + (0.25 + 0.2 * Math.sin(S.t * 6)) + ')'; ctx.lineWidth = 18; ctx.strokeRect(AR.x, AR.y, AR.w, AR.h); }
    if (S.banner) {
      ctx.textAlign = 'center'; ctx.font = '38px ' + PIXEL;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 300, W, 90);
      ctx.fillStyle = Math.floor(S.banner.t * 6) % 2 ? '#ff3b6b' : '#fbbf24'; ctx.fillText(S.banner.text, W / 2, 360);
    }
  }

  // ======================= HUD =======================
  function updateHud() {
    const p = S.p, el = elapsed(), left = MATCH_SECONDS - el;
    $('hp-fill').style.width = (p.hp / p.max * 100) + '%';
    $('hp-text').textContent = Math.ceil(p.hp);
    $('hp-fill').parentElement.classList.toggle('low', p.hp <= 30);
    $('timer').textContent = fmtClock(left);
    $('timer').classList.toggle('low', left <= 60);
    $('score').textContent = provisional();
    $('phase-label').textContent = S.bossSpawned || S.bossWarn > 0 ? 'FASE 2 · BUG-404' : 'FASE 1 · LIMPEZA DA ARENA';
    let chips = '';
    if (S.drones.length) chips += '<span class="chip" style="color:#38bdf8;border-color:#38bdf8">DRONES x' + S.drones.length + '</span>';
    if (p.boost > 0) chips += '<span class="chip" style="color:#e879f9;border-color:#e879f9">BOOST ' + Math.ceil(p.boost) + 's</span>';
    chips += '<span class="chip" style="color:#fbbf24;border-color:#fbbf24">DESAFIOS ' + S.answered + '/8</span>';
    if (chips !== S.chipsHtml) { $('chips').innerHTML = chips; S.chipsHtml = chips; }
    let obj;
    if (S.bossSpawned) obj = 'DERROTE O BUG-404! Os terminais ainda dão poderes (E).';
    else if (S.bossWarn > 0) obj = 'O BUG-404 ESTÁ CHEGANDO! PREPARE-SE.';
    else obj = 'Responda ' + Math.max(0, BOSS_UNLOCK - S.answered) + ' desafio(s) para invocar o BUG-404: ande até um terminal e aperte E.';
    if ($('objective').textContent !== obj) $('objective').textContent = obj;
    if (S.boss) {
      $('boss-fill').style.width = (S.boss.hp / S.boss.max * 100) + '%';
      $('boss-shield').style.width = Math.min(100, S.boss.sh / 110 * 100) + '%';
    }
  }

  // ======================= perguntas =======================
  const qEl = {
    modal: $('qmodal'), card: $('qcard'), tag: $('q-cmd'), count: $('q-counter'), prompt: $('q-prompt'),
    opts: $('q-options'), fb: $('q-feedback'), verdict: $('q-verdict'), explain: $('q-explain'),
    effect: $('q-effect'), msg: $('q-msg'), confirm: $('q-confirm'), cont: $('q-continue')
  };

  function openQuestion(term) {
    const q = S.queue[term.cmd][S.qi[term.cmd]];
    if (!q) return;
    S.qi[term.cmd]++;
    S.state = 'question';
    S.cur = { q, term, sel: -1, done: false, busy: false, result: null };
    const color = CMDS[term.cmd].color;
    qEl.tag.textContent = term.cmd; qEl.tag.style.background = color;
    qEl.card.style.borderColor = color; qEl.card.style.boxShadow = '0 0 40px ' + color + '66';
    qEl.count.textContent = 'Desafio ' + (S.answered + 1) + ' de 8';
    qEl.prompt.textContent = q.prompt;
    qEl.opts.innerHTML = '';
    q.options.forEach((txt, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'qopt'; b.textContent = 'ABC'[i] + ') ' + txt;
      b.onclick = () => selectOption(i);
      qEl.opts.appendChild(b);
    });
    qEl.fb.hidden = true; qEl.fb.classList.remove('bad');
    qEl.msg.textContent = ''; qEl.msg.classList.remove('error');
    qEl.confirm.hidden = false; qEl.confirm.disabled = true; qEl.cont.hidden = true;
    qEl.modal.hidden = false;
    SFX.click();
  }
  function selectOption(i) {
    const c = S.cur;
    if (!c || c.done || c.busy) return;
    c.sel = i;
    Array.from(qEl.opts.children).forEach((b, k) => b.classList.toggle('sel', k === i));
    qEl.confirm.disabled = false; SFX.click();
  }
  async function confirmAnswer() {
    const c = S.cur;
    if (!c || c.done || c.busy || c.sel < 0) return;
    c.busy = true; qEl.confirm.disabled = true;
    qEl.msg.classList.remove('error'); qEl.msg.textContent = 'Conferindo a resposta...';
    let r;
    try {
      r = await window.API.answer(S.session, c.q.id, c.sel);
    } catch (e) {
      c.busy = false; qEl.confirm.disabled = false;
      qEl.msg.classList.add('error'); qEl.msg.textContent = 'Falha de conexão. Confirme de novo (a resposta não será contada duas vezes).';
      return;
    }
    if (!S || S.cur !== c) return;
    if (!r || !r.ok) {
      if (r && r.error === 'TENTATIVA_ENCERRADA') { qEl.modal.hidden = true; finishMatch('timeout'); return; }
      qEl.msg.classList.add('error'); qEl.msg.textContent = 'Erro do servidor (' + (r && r.error) + '). Avise o professor.';
      c.busy = false; return;
    }
    c.busy = false; c.done = true; c.result = r;
    const ok = !!r.correct;
    S.answered++;
    if (ok) S.correct++; else S.wrong++;
    Array.from(qEl.opts.children).forEach((b, k) => {
      b.disabled = true; b.classList.remove('sel');
      if (k === r.correct_index) b.classList.add('right');
      else if (k === c.sel && !ok) b.classList.add('wrong');
    });
    qEl.fb.hidden = false; qEl.fb.classList.toggle('bad', !ok);
    qEl.verdict.textContent = ok ? 'CORRETO! +100 pontos' : 'ERRADO! -20 de vida';
    qEl.verdict.style.color = ok ? '#4ade80' : '#ff3b6b';
    qEl.explain.textContent = r.explanation;
    const cmd = CMDS[c.term.cmd];
    qEl.effect.textContent = ok
      ? 'Poder na arena (metáfora do jogo): ' + cmd.ability + '. ' + cmd.effect
      : 'Você não recebe o poder desta pergunta e o inimigo faz um ataque especial. A resposta correta está destacada em verde.';
    qEl.msg.textContent = '';
    qEl.confirm.hidden = true; qEl.cont.hidden = false; qEl.cont.focus();
    if (ok) SFX.ok(); else SFX.bad();
  }
  function continueAfterAnswer() {
    const c = S.cur;
    if (!c || !c.done) return;
    qEl.modal.hidden = true;
    S.state = 'play'; S.cur = null;
    S.p.inv = Math.max(S.p.inv, 0.8);
    if (c.result.correct) applyAbility(c.term.cmd);
    else { hurtPlayer(20, true); if (S.state === 'play') specialAttack(); }
  }
  qEl.confirm.onclick = confirmAnswer;
  qEl.cont.onclick = continueAfterAnswer;
  function hideQuestion() { qEl.modal.hidden = true; }

  // ======================= teclado e pausa =======================
  function togglePause() {
    if (!S) return;
    if (S.state === 'play') { S.state = 'paused'; $('pause').hidden = false; }
    else if (S.state === 'paused') { S.state = 'play'; $('pause').hidden = true; S.p.inv = Math.max(S.p.inv, 0.5); }
  }
  $('btn-resume').onclick = togglePause;

  window.addEventListener('keydown', (e) => {
    if (!$('screen-game').classList.contains('active') || !S) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (S.state === 'question') {
      if (e.repeat) return;
      const m = /^(Digit|Numpad)([1-3])$/.exec(e.code);
      if (m) selectOption(Number(m[2]) - 1);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); if (S.cur && S.cur.done) continueAfterAnswer(); else confirmAnswer(); }
      return;
    }
    if (e.code === 'Escape') { if (!e.repeat) togglePause(); return; }
    keys[e.code] = true;
    if (e.code === 'KeyE' && !e.repeat && S.state === 'play' && S.nearTerm) openQuestion(S.nearTerm);
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // ======================= fim da partida e resultado =======================
  let finalData = null;

  function finishMatch(outcome) {
    if (!S || S.state === 'over') return;
    S.state = 'over';
    cancelAnimationFrame(rafId);
    hideQuestion(); $('pause').hidden = true;
    finalData = {
      session: S.session, outcome, kills: S.kills, boss: S.bossDead,
      stats: { correct: S.correct, wrong: S.wrong, elapsed: Math.round(elapsed()) }
    };
    const card = document.querySelector('.result-card');
    card.classList.toggle('win', outcome === 'victory');
    card.classList.toggle('lose', outcome !== 'victory');
    $('res-title').textContent = outcome === 'victory' ? 'VITÓRIA! BUG-404 DERROTADO' : (outcome === 'timeout' ? 'TEMPO ESGOTADO' : 'DERROTA');
    $('res-sub').textContent = S.training
      ? 'Modo treino: esta partida não entra no ranking.'
      : 'Jogador: ' + S.session.nickname + ' · tentativa oficial encerrada.';
    $('res-body').hidden = true; $('btn-res-retry').hidden = true;
    showScreen('screen-result');
    sendResult();
  }

  async function sendResult() {
    const f = finalData;
    $('btn-res-retry').hidden = true;
    $('res-status').textContent = f.session.mode === 'training' ? '' : 'Salvando seu resultado no servidor... não feche esta página.';
    try {
      const r = await window.API.finish(f.session, f.outcome, f.kills, f.boss, f.stats);
      if (!r || !r.ok) {
        $('res-status').textContent = 'O servidor não aceitou o resultado (' + ((r && r.error) || 'erro') + '). Avise o professor.';
        return;
      }
      showFinal(r);
    } catch (e) {
      $('res-status').textContent = 'Sem conexão para salvar o resultado. Volte a conexão e clique em TENTAR ENVIAR DE NOVO. Seu envio não será contado duas vezes. Se fechar a página, o servidor encerra a partida pelo tempo e conta só as respostas dadas.';
      $('btn-res-retry').hidden = false;
    }
  }
  $('btn-res-retry').onclick = () => { if (finalData) sendResult(); };

  function showFinal(r) {
    $('res-status').textContent = r.training ? '' : 'Resultado salvo no ranking oficial.';
    $('res-body').hidden = false;
    $('res-score').textContent = r.score;
    $('res-correct').textContent = r.correct_count;
    $('res-wrong').textContent = r.wrong_count;
    $('res-kills').textContent = r.enemies_killed;
    $('res-boss').textContent = r.boss_defeated ? 'derrotado' : 'não';
    $('res-time').textContent = fmtDur(r.duration_seconds);
    if (r.position) {
      $('res-pos').textContent = '#' + r.position + ' de ' + r.total;
      myPos = { position: r.position, total: r.total, score: r.score, nickname: r.nickname };
      loadRanking('title');
    } else {
      $('res-pos').textContent = r.training ? 'treino' : '-';
    }
  }

  // ======================= início =======================
  fitStage();
  loadRanking('title');
})();
