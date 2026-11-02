-- =====================================================================
-- BOSS BATTLE SQL — 01_schema.sql
-- Rode este arquivo UMA vez no Supabase: SQL Editor > New query > Run.
-- Depois rode o 02_questions.sql.
-- =====================================================================
-- Ideia de segurança: o navegador NUNCA acessa as tabelas diretamente.
-- Ele só chama as 5 funções liberadas no final deste arquivo. As funções
-- rodam no servidor (SECURITY DEFINER), conferem o código do aluno,
-- corrigem as respostas e calculam a pontuação.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------

-- Banco de perguntas (as respostas corretas ficam só no servidor)
create table if not exists public.questions (
  id            smallint primary key,
  command       text     not null check (command in ('GRANT','REVOKE','CREATE INDEX','DROP INDEX')),
  prompt        text     not null,
  options       text[]   not null check (array_length(options, 1) = 3),
  correct_index smallint not null check (correct_index between 0 and 2),
  explanation   text     not null
);

-- Participantes cadastrados pelo professor. Só o HASH do código é guardado.
create table if not exists public.participants (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  class_name text,
  code_hash  text not null unique,
  created_at timestamptz not null default now()
);

-- Tentativas (partidas). Cada participante só pode ter UMA tentativa válida.
create table if not exists public.attempts (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  nickname       text not null,
  token_hash     text not null,
  question_ids   smallint[] not null,
  status         text not null default 'started' check (status in ('started','finished','expired','void')),
  started_at     timestamptz not null default now(),
  deadline_at    timestamptz not null,
  finished_at    timestamptz,
  void_reason    text,
  voided_at      timestamptz
);

-- Garante, no próprio banco, uma única tentativa não anulada por participante.
create unique index if not exists one_valid_attempt_per_participant
  on public.attempts (participant_id) where status <> 'void';

-- Respostas dadas (uma por pergunta por tentativa: não dá para repetir)
create table if not exists public.answers (
  attempt_id  uuid not null references public.attempts(id) on delete cascade,
  question_id smallint not null references public.questions(id),
  choice      smallint not null check (choice between -1 and 2),
  is_correct  boolean  not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

-- Resultado final (um por tentativa)
create table if not exists public.results (
  attempt_id       uuid primary key references public.attempts(id) on delete cascade,
  participant_id   uuid not null references public.participants(id) on delete cascade,
  nickname         text not null,
  outcome          text not null check (outcome in ('victory','defeat','timeout','expired')),
  score            integer  not null check (score >= 0),
  correct_count    smallint not null,
  wrong_count      smallint not null,
  enemies_killed   smallint not null,
  boss_defeated    boolean  not null,
  duration_seconds integer  not null,
  created_at       timestamptz not null default now()
);

create index if not exists results_rank_idx
  on public.results (score desc, correct_count desc, duration_seconds asc, created_at asc);

-- ---------------------------------------------------------------------
-- RLS: liga a proteção e NÃO cria nenhuma policy.
-- Resultado: ninguém (anon/authenticated) lê nem escreve nas tabelas.
-- ---------------------------------------------------------------------
alter table public.questions    enable row level security;
alter table public.participants enable row level security;
alter table public.attempts     enable row level security;
alter table public.answers      enable row level security;
alter table public.results      enable row level security;

-- ---------------------------------------------------------------------
-- FUNÇÕES AUXILIARES (internas — o navegador não pode chamá-las)
-- ---------------------------------------------------------------------

create or replace function public.normalize_code(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create or replace function public.hash_text(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex')
$$;

-- Gera um código de 8 caracteres sem letras confusas (sem I, O, 0, 1)
create or replace function public.generate_code()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text := '';
  i int;
begin
  for i in 1..8 loop
    v := v || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1);
  end loop;
  return v;
end $$;

-- Posição no ranking: pontos (maior) > acertos (maior) > tempo (menor) > quem terminou antes
create or replace function public.rank_of(p_attempt uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  me public.results;
  pos integer;
begin
  select * into me from public.results where attempt_id = p_attempt;
  if not found then return null; end if;
  select count(*) + 1 into pos from public.results r
   where r.score > me.score
      or (r.score = me.score and r.correct_count > me.correct_count)
      or (r.score = me.score and r.correct_count = me.correct_count and r.duration_seconds < me.duration_seconds)
      or (r.score = me.score and r.correct_count = me.correct_count and r.duration_seconds = me.duration_seconds
          and r.created_at < me.created_at);
  return pos;
end $$;

create or replace function public.result_json(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.results;
begin
  select * into r from public.results where attempt_id = p_attempt;
  if not found then return null; end if;
  return jsonb_build_object(
    'ok', true,
    'score', r.score,
    'correct_count', r.correct_count,
    'wrong_count', r.wrong_count,
    'enemies_killed', r.enemies_killed,
    'boss_defeated', r.boss_defeated,
    'duration_seconds', r.duration_seconds,
    'outcome', r.outcome,
    'nickname', r.nickname,
    'position', public.rank_of(p_attempt),
    'total', (select count(*) from public.results)
  );
end $$;

-- ---------------------------------------------------------------------
-- CÁLCULO DA PONTUAÇÃO NO SERVIDOR
--   +100 por resposta correta (conferida pelo servidor)
--   +50 por robô derrotado (máx. 40 robôs contam)
--   +300 por derrotar o BUG-404
--   +bônus de tempo (só na vitória): até 100 pontos
-- O combate acontece no navegador, então o servidor só aceita valores
-- plausíveis (limites por tempo de partida e por respostas dadas).
-- ---------------------------------------------------------------------
create or replace function public.close_attempt(p_attempt uuid, p_outcome text, p_kills integer, p_boss boolean)
returns public.results language plpgsql security definer set search_path = public as $$
declare
  v_att public.attempts;
  v_c integer; v_w integer; v_elapsed integer; v_kills integer;
  v_boss boolean; v_bonus integer := 0; v_outcome text; v_score integer;
  v_res public.results;
begin
  select * into v_att from public.attempts where id = p_attempt for update;
  if not found or v_att.status <> 'started' then
    return null;
  end if;

  select count(*) filter (where is_correct), count(*) filter (where not is_correct)
    into v_c, v_w from public.answers where attempt_id = p_attempt;

  if p_outcome = 'expired' then
    v_elapsed := 600; v_kills := 0; v_boss := false; v_outcome := 'expired';
  else
    v_elapsed := least(600, greatest(0, extract(epoch from (now() - v_att.started_at))::integer));
    v_kills   := greatest(0, least(coalesce(p_kills, 0), 40, v_elapsed / 3));
    v_boss    := coalesce(p_boss, false) and p_outcome = 'victory'
                 and (v_c + v_w) >= 6 and v_elapsed >= 90;
    v_outcome := case when p_outcome = 'victory' and not v_boss then 'defeat' else p_outcome end;
    if v_boss then v_bonus := least(100, (600 - v_elapsed) / 6); end if;
  end if;

  v_score := v_c * 100 + v_kills * 50 + (case when v_boss then 300 else 0 end) + v_bonus;

  insert into public.results (attempt_id, participant_id, nickname, outcome, score,
                              correct_count, wrong_count, enemies_killed, boss_defeated, duration_seconds)
  values (p_attempt, v_att.participant_id, v_att.nickname, v_outcome, v_score,
          v_c, v_w, v_kills, v_boss, v_elapsed)
  returning * into v_res;

  update public.attempts
     set status = case when p_outcome = 'expired' then 'expired' else 'finished' end,
         finished_at = now()
   where id = p_attempt;

  return v_res;
end $$;

-- Fecha partidas abandonadas (aluno fechou o navegador, caiu a internet...)
create or replace function public.close_expired_attempts()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.attempts where status = 'started' and now() > deadline_at loop
    perform public.close_attempt(r.id, 'expired', 0, false);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- FUNÇÕES PÚBLICAS (chamadas pelo jogo)
-- ---------------------------------------------------------------------

-- 1) Entrar: valida o código, registra a tentativa e sorteia 8 perguntas.
create or replace function public.start_attempt(p_code text, p_nickname text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_part public.participants; v_att public.attempts;
  v_nick text; v_token text; v_qids smallint[]; v_questions jsonb;
begin
  v_nick := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  if v_nick !~ '^[A-Za-z0-9À-ÿ _.-]{2,20}$' then
    return jsonb_build_object('ok', false, 'error', 'NICK_INVALIDO');
  end if;

  select * into v_part from public.participants
   where code_hash = public.hash_text(public.normalize_code(p_code))
   for update;
  if not found then
    perform pg_sleep(0.5); -- atrapalha quem tenta adivinhar códigos
    return jsonb_build_object('ok', false, 'error', 'CODIGO_INVALIDO');
  end if;

  select * into v_att from public.attempts
   where participant_id = v_part.id and status <> 'void';
  if found then
    if v_att.status = 'started' and now() > v_att.deadline_at then
      perform public.close_attempt(v_att.id, 'expired', 0, false);
    end if;
    return jsonb_build_object('ok', false, 'error', 'TENTATIVA_USADA',
                              'result', public.result_json(v_att.id));
  end if;

  -- 2 perguntas de cada comando, em ordem aleatória
  select array_agg(id order by random()) into v_qids
    from (select id, row_number() over (partition by command order by random()) as rn
            from public.questions) t
   where rn <= 2;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.attempts (participant_id, nickname, token_hash, question_ids, deadline_at)
  values (v_part.id, v_nick, public.hash_text(v_token), v_qids, now() + interval '645 seconds')
  returning * into v_att;

  select jsonb_agg(jsonb_build_object('id', q.id, 'command', q.command,
                                      'prompt', q.prompt, 'options', to_jsonb(q.options))
                   order by array_position(v_qids, q.id))
    into v_questions
    from public.questions q where q.id = any(v_qids);

  return jsonb_build_object('ok', true, 'attempt_id', v_att.id, 'token', v_token,
                            'nickname', v_nick, 'duration_seconds', 600, 'questions', v_questions);
end $$;

-- 2) Responder: o servidor corrige. Cada pergunta só vale uma vez.
create or replace function public.answer_question(p_attempt uuid, p_token text, p_question smallint, p_choice smallint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_att public.attempts; v_q public.questions; v_ans public.answers;
  v_choice smallint; v_ok boolean;
begin
  select * into v_att from public.attempts
   where id = p_attempt and token_hash = public.hash_text(p_token) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'SESSAO_INVALIDA'); end if;
  if v_att.status <> 'started' or now() > v_att.deadline_at then
    return jsonb_build_object('ok', false, 'error', 'TENTATIVA_ENCERRADA');
  end if;
  if not (p_question = any(v_att.question_ids)) then
    return jsonb_build_object('ok', false, 'error', 'PERGUNTA_INVALIDA');
  end if;

  select * into v_q from public.questions where id = p_question;
  v_choice := case when p_choice between 0 and 2 then p_choice else -1 end;

  select * into v_ans from public.answers where attempt_id = p_attempt and question_id = p_question;
  if found then
    if v_ans.choice = v_choice then -- reenvio (ex.: a internet falhou na resposta)
      return jsonb_build_object('ok', true, 'correct', v_ans.is_correct,
        'correct_index', v_q.correct_index, 'explanation', v_q.explanation, 'replay', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'JA_RESPONDIDA');
  end if;

  v_ok := (v_choice = v_q.correct_index);
  insert into public.answers (attempt_id, question_id, choice, is_correct)
  values (p_attempt, p_question, v_choice, v_ok);

  return jsonb_build_object('ok', true, 'correct', v_ok,
    'correct_index', v_q.correct_index, 'explanation', v_q.explanation);
end $$;

-- 3) Finalizar: calcula a pontuação no servidor. Só funciona UMA vez.
create or replace function public.finish_attempt(p_attempt uuid, p_token text, p_outcome text, p_kills integer, p_boss boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_att public.attempts; v_res public.results;
begin
  if p_outcome not in ('victory', 'defeat', 'timeout') then
    return jsonb_build_object('ok', false, 'error', 'DADOS_INVALIDOS');
  end if;
  select * into v_att from public.attempts
   where id = p_attempt and token_hash = public.hash_text(p_token) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'SESSAO_INVALIDA'); end if;
  if v_att.status <> 'started' then
    return jsonb_build_object('ok', false, 'error', 'RESULTADO_JA_ENVIADO');
  end if;

  if now() > v_att.deadline_at then
    v_res := public.close_attempt(p_attempt, 'expired', 0, false);
  else
    v_res := public.close_attempt(p_attempt, p_outcome, p_kills, p_boss);
  end if;
  return public.result_json(p_attempt);
end $$;

-- 4) Ver o próprio resultado e a posição (precisa do token da partida)
create or replace function public.get_my_result(p_attempt uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_att public.attempts; v_json jsonb;
begin
  select * into v_att from public.attempts
   where id = p_attempt and token_hash = public.hash_text(p_token);
  if not found then return jsonb_build_object('ok', false, 'error', 'SESSAO_INVALIDA'); end if;
  v_json := public.result_json(p_attempt);
  if v_json is null then return jsonb_build_object('ok', false, 'error', 'SEM_RESULTADO'); end if;
  return v_json;
end $$;

-- 5) Ranking público (só apelido, pontos, acertos, tempo e posição)
create or replace function public.get_leaderboard(p_limit integer default 10)
returns table (pos bigint, nickname text, score integer, correct_count smallint,
               duration_seconds integer, outcome text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.close_expired_attempts();
  return query
    select row_number() over (order by r.score desc, r.correct_count desc,
                                       r.duration_seconds asc, r.created_at asc) as pos,
           r.nickname, r.score, r.correct_count, r.duration_seconds, r.outcome
      from public.results r
     order by 1
     limit least(greatest(coalesce(p_limit, 10), 1), 100);
end $$;

-- ---------------------------------------------------------------------
-- FUNÇÕES DO PROFESSOR (só funcionam no SQL Editor do Supabase)
-- ---------------------------------------------------------------------

-- Cadastra alunos e GERA os códigos. Os códigos aparecem só uma vez!
-- Uso: select * from admin_create_participants(array['Ana Souza','Bruno Lima'], 'DS-2026');
create or replace function public.admin_create_participants(p_names text[], p_class text default null)
returns table (aluno text, codigo text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_name text; v_code text;
begin
  foreach v_name in array p_names loop
    v_name := btrim(v_name);
    continue when v_name = '';
    loop
      v_code := public.generate_code();
      begin
        insert into public.participants (full_name, class_name, code_hash)
        values (v_name, p_class, public.hash_text(v_code));
        exit;
      exception when unique_violation then
        null; -- código repetido: gera outro
      end;
    end loop;
    aluno := v_name;
    codigo := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
    return next;
  end loop;
end $$;

-- Gera um código novo para um aluno que perdeu o papel (não libera nova tentativa).
-- Uso: select admin_new_code('Ana Souza');
create or replace function public.admin_new_code(p_full_name text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_n integer; v_code text;
begin
  select count(*), min(id::text)::uuid into v_n, v_id
    from public.participants where lower(full_name) = lower(btrim(p_full_name));
  if v_n <> 1 then raise exception 'Encontrei % alunos com esse nome (precisa ser exatamente 1).', v_n; end if;
  loop
    v_code := public.generate_code();
    begin
      update public.participants set code_hash = public.hash_text(v_code) where id = v_id;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
end $$;

-- FALHA TÉCNICA LEGÍTIMA: anula a tentativa para o aluno jogar de novo.
-- O motivo fica registrado. Limite: 1 reinício por aluno (use p_force = true
-- só em caso excepcional). A tentativa anulada fica guardada para auditoria.
-- Uso: select admin_void_attempt('Ana Souza', 'Queda de energia na sala 3');
create or replace function public.admin_void_attempt(p_full_name text, p_reason text, p_force boolean default false)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_n integer; v_att public.attempts; v_voids integer;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Informe o motivo da anulação.'; end if;
  select count(*), min(id::text)::uuid into v_n, v_id
    from public.participants where lower(full_name) = lower(btrim(p_full_name));
  if v_n <> 1 then raise exception 'Encontrei % alunos com esse nome (precisa ser exatamente 1).', v_n; end if;

  select * into v_att from public.attempts where participant_id = v_id and status <> 'void';
  if not found then return 'Esse aluno não tem tentativa para anular.'; end if;

  select count(*) into v_voids from public.attempts where participant_id = v_id and status = 'void';
  if v_voids >= 1 and not p_force then
    raise exception 'Esse aluno já teve um reinício. Para autorizar outro, use p_force => true.';
  end if;

  delete from public.results where attempt_id = v_att.id;
  update public.attempts set status = 'void', void_reason = btrim(p_reason), voided_at = now()
   where id = v_att.id;
  return 'Tentativa anulada. O aluno pode entrar de novo com o mesmo código.';
end $$;

-- Painel do professor: quem já jogou, quem falta, pontos. Não mostra códigos.
-- Uso: select * from admin_status();
create or replace function public.admin_status()
returns table (aluno text, turma text, situacao text, apelido text, pontos integer,
               acertos smallint, segundos integer, reinicios integer)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.class_name, coalesce(a.status, 'sem tentativa'), a.nickname,
         r.score, r.correct_count, r.duration_seconds,
         (select count(*)::integer from public.attempts x where x.participant_id = p.id and x.status = 'void')
    from public.participants p
    left join public.attempts a on a.participant_id = p.id and a.status <> 'void'
    left join public.results  r on r.attempt_id = a.id
   order by p.full_name
$$;

-- ---------------------------------------------------------------------
-- PERMISSÕES: tranca tudo e libera só as 5 funções do jogo
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.start_attempt(text, text)                                to anon, authenticated;
grant execute on function public.answer_question(uuid, text, smallint, smallint)          to anon, authenticated;
grant execute on function public.finish_attempt(uuid, text, text, integer, boolean)       to anon, authenticated;
grant execute on function public.get_my_result(uuid, text)                                to anon, authenticated;
grant execute on function public.get_leaderboard(integer)                                 to anon, authenticated;
