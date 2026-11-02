'use strict';
/*
  supabase.js — conversa com o Supabase usando apenas fetch (sem biblioteca).
  O navegador só chama as 5 funções públicas criadas no 01_schema.sql:
  start_attempt, answer_question, finish_attempt, get_my_result, get_leaderboard.
  Também tem a sessão local do MODO TREINO (sem ranking, sem servidor).
*/
(function () {
  const cfg = window.BBSQL_CONFIG || {};
  const configured = !!cfg.SUPABASE_URL && !!cfg.SUPABASE_ANON_KEY &&
    !String(cfg.SUPABASE_URL).includes('COLE_AQUI') && !String(cfg.SUPABASE_ANON_KEY).includes('COLE_AQUI');

  // Mesma fórmula do servidor (usada só no modo treino)
  function trainingScore(correct, kills, boss, elapsed) {
    const k = Math.max(0, Math.min(kills, 40));
    const bonus = boss ? Math.min(100, Math.floor((600 - elapsed) / 6)) : 0;
    return correct * 100 + k * 50 + (boss ? 300 : 0) + bonus;
  }

  async function rpc(fn, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
    const headers = { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY };
    // Chaves antigas (JWT) também vão no Authorization; as novas (sb_publishable_) só no apikey.
    if (String(cfg.SUPABASE_ANON_KEY).startsWith('eyJ')) headers.Authorization = 'Bearer ' + cfg.SUPABASE_ANON_KEY;
    try {
      const res = await fetch(cfg.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
        method: 'POST', headers, body: JSON.stringify(body || {}), signal: ctrl.signal
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* resposta sem corpo */ }
      if (!res.ok) {
        const err = new Error((data && (data.message || data.hint)) || ('HTTP ' + res.status));
        err.http = res.status;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') { const t = new Error('TIMEOUT'); t.network = true; throw t; }
      if (!e.http) e.network = true;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------- API oficial ----------------
  async function start(code, nickname) {
    const d = await rpc('start_attempt', { p_code: code, p_nickname: nickname });
    if (!d || !d.ok) return d || { ok: false, error: 'RESPOSTA_INVALIDA' };
    return {
      ok: true, mode: 'official', attemptId: d.attempt_id, token: d.token,
      nickname: d.nickname, questions: d.questions
    };
  }

  async function answer(session, questionId, choice) {
    if (session.mode === 'training') {
      const q = window.QUESTION_BANK.find((x) => x.id === questionId);
      return { ok: true, correct: choice === q.correct, correct_index: q.correct, explanation: q.explanation };
    }
    return rpc('answer_question', {
      p_attempt: session.attemptId, p_token: session.token,
      p_question: questionId, p_choice: choice
    });
  }

  // O envio final é seguro para repetir: o servidor só aceita UMA vez.
  async function finish(session, outcome, kills, boss, stats) {
    if (session.mode === 'training') {
      const score = trainingScore(stats.correct, kills, boss && outcome === 'victory', stats.elapsed);
      return {
        ok: true, training: true, score, correct_count: stats.correct, wrong_count: stats.wrong,
        enemies_killed: Math.min(kills, 40), boss_defeated: !!boss, duration_seconds: stats.elapsed,
        outcome, nickname: session.nickname, position: null, total: null
      };
    }
    let lastErr = null;
    for (let i = 0; i < 4; i++) {
      try {
        const d = await rpc('finish_attempt', {
          p_attempt: session.attemptId, p_token: session.token,
          p_outcome: outcome, p_kills: kills, p_boss: !!boss
        });
        if (d && d.ok) return d;
        if (d && d.error === 'RESULTADO_JA_ENVIADO') return await myResult(session);
        return d;
      } catch (e) {
        lastErr = e;
        if (!e.network) break;
        await sleep(1200 * (i + 1));
      }
    }
    throw lastErr || new Error('FALHA_DESCONHECIDA');
  }

  function myResult(session) {
    return rpc('get_my_result', { p_attempt: session.attemptId, p_token: session.token });
  }

  async function leaderboard(limit) {
    return rpc('get_leaderboard', { p_limit: limit || 10 });
  }

  // ---------------- MODO TREINO ----------------
  function shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
    return r;
  }

  function training() {
    const picked = [];
    ['GRANT', 'REVOKE', 'CREATE INDEX', 'DROP INDEX'].forEach((cmd) => {
      shuffle(window.QUESTION_BANK.filter((q) => q.command === cmd)).slice(0, 2).forEach((q) => picked.push(q));
    });
    return {
      ok: true, mode: 'training', nickname: 'TREINO',
      questions: shuffle(picked).map((q) => ({ id: q.id, command: q.command, prompt: q.prompt, options: q.options.slice() }))
    };
  }

  window.API = { configured, start, answer, finish, myResult, leaderboard, training };
})();
