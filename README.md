# BOSS BATTLE SQL

Jogo 2D de combate em arena (visão de cima) para o trabalho do **Grupo 3 — Segurança e Desempenho em SQL** (`GRANT`, `REVOKE`, `CREATE INDEX`, `DROP INDEX`). Roda no navegador, tem perguntas que mudam a batalha, chefe final **BUG-404** e **ranking online compartilhado** (Supabase). Cada aluno tem **uma única tentativa oficial**, bloqueada no servidor.

> **Estado do projeto:** o jogo funciona sozinho no **MODO TREINO** assim que você abrir o `index.html`. A partida oficial e o ranking **só funcionam depois** que você fizer a configuração do Supabase (Passos 1 a 4). Sem ela, o ranking mostra um aviso, e isso é esperado.

---

## 1. Estrutura de pastas

```
boss-battle-sql/
├── index.html        telas do jogo
├── style.css         visual neon
├── game.js           movimentação, combate, chefe, perguntas, telas
├── questions.js      24 perguntas (modo treino) + efeitos dos comandos
├── supabase.js       comunicação com o Supabase (usa só fetch)
├── config.js         <-- você edita: URL e chave PÚBLICA do Supabase
├── README.md
└── sql/
    ├── 01_schema.sql     tabelas, RLS, funções de servidor e permissões
    └── 02_questions.sql  as 24 perguntas com as respostas (só no servidor)
```

## 2. Controles

| Tecla | Ação |
|---|---|
| `W A S D` ou setas | andar |
| `Espaço` | atacar robôs próximos |
| `E` | abrir um desafio SQL (perto de um terminal) |
| `ESC` | pausar (o relógio oficial **continua**; não reinicia nem altera pontos) |
| `1` `2` `3` / `Enter` | escolher alternativa / confirmar (nas perguntas) |

## 3. Regras do jogo

- Partida de **no máximo 10 minutos**. Termina quando você derrota o BUG-404, a vida chega a zero ou o tempo acaba.
- Há 4 terminais (GRANT, REVOKE, CREATE INDEX, DROP INDEX), cada um com 2 desafios. **Cada pergunta vale uma vez**, então não dá para repetir para acumular pontos.
- Ao responder **6 desafios**, o chefe **BUG-404** aparece (os terminais continuam dando poderes durante a luta).
- O tempo oficial não para durante perguntas ou pausa.

**Poderes (são metáforas do jogo, não o efeito literal dos comandos SQL):**

| Acertou | Efeito na arena |
|---|---|
| `GRANT` | drone aliado que atira nos robôs |
| `REVOKE` | remove os escudos de acesso (anel roxo) dos inimigos e do chefe e os deixa vulneráveis |
| `CREATE INDEX` | bônus de velocidade e ataque por 25 s |
| `DROP INDEX` | remove a aura de bônus dos inimigos, os deixa lentos e tira a fúria do chefe |

**Errou:** perde 20 de vida, não ganha o poder, o inimigo faz um ataque especial e o jogo mostra a resposta certa com a explicação.

**Pontuação (calculada no servidor):**

| Item | Pontos |
|---|---|
| Resposta correta | +100 |
| Robô comum derrotado | +50 (só os 40 primeiros contam) |
| BUG-404 derrotado | +300 |
| Bônus de tempo (só na vitória) | até +100 (tempo restante ÷ 6) |
| Resposta errada | 0 |

Não há bônus duplicado: acertos valem só os +100 de cada resposta. **Desempate no ranking:** mais pontos, depois mais acertos, depois menor tempo, depois quem terminou primeiro.

---

## 4. Configuração do Supabase (passo a passo)

Tudo isto é **manual**: o jogo não funciona online sem estes passos.

### Passo 1 — Criar o projeto
1. Entre em <https://supabase.com> e crie uma conta (pode ser com o GitHub).
2. Clique em **New project**, escolha um nome (ex.: `boss-battle-sql`), crie uma **senha do banco** (guarde) e escolha a região mais próxima (ex.: South America).
3. Espere o projeto ficar pronto (1 a 2 minutos).

### Passo 2 — Criar as tabelas e funções
1. No menu da esquerda, abra **SQL Editor** > **New query**.
2. Abra o arquivo `sql/01_schema.sql`, copie **todo** o conteúdo, cole e clique em **Run**. Deve aparecer *Success*.
3. Crie outra query, cole o conteúdo de `sql/02_questions.sql` e clique em **Run**. O resultado mostra 6 perguntas para cada comando.

### Passo 3 — Pegar a URL e a chave pública
1. Vá em **Project Settings** > **API** (ou **API Keys**).
2. Copie a **Project URL** (ex.: `https://abcdefgh.supabase.co`).
3. Copie a chave **anon / publishable** (é a chave *pública*).
4. Abra o `config.js` e cole os dois valores:

```js
window.BBSQL_CONFIG = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'sua-chave-publica-aqui'
};
```

> ⚠️ **Nunca** use a chave `service_role` (ou `secret`) no jogo nem no GitHub. Ela dá acesso total ao banco. A chave `anon/publishable` é feita para ficar no navegador e é segura aqui porque as tabelas estão trancadas (veja a seção de segurança).

### Passo 4 — Cadastrar os alunos e gerar os códigos (professor)
No **SQL Editor**, rode (troque os nomes e a turma):

```sql
select * from admin_create_participants(
  array['Ana Souza', 'Bruno Lima', 'Carla Dias'],
  'DS-2026'
);
```

O resultado é uma tabela **aluno → código** (ex.: `K7QM-29XD`). **Copie e entregue cada código ao aluno** e guarde a lista: os códigos aparecem só agora, porque o banco guarda apenas o *hash* deles. Os alunos escolhem o nome de jogador na hora de entrar.

Outras consultas úteis do professor (também no SQL Editor):

```sql
select * from admin_status();                          -- quem jogou, quem falta, pontos
select admin_new_code('Ana Souza');                    -- aluno perdeu o código: gera um novo
select admin_void_attempt('Ana Souza', 'motivo...');   -- falha técnica (veja a seção 7)
```

---

## 5. Testar no seu computador

1. Instale o **VS Code** e a extensão **Live Server** (ou rode `python -m http.server 8000` na pasta e abra `http://localhost:8000`).
2. Abra o `index.html`. Clique em **MODO TREINO** para testar controles, combate, perguntas e chefe (não vale ranking).
3. Com o `config.js` preenchido, clique em **JOGAR (PARTIDA OFICIAL)**, use um código gerado no Passo 4 e jogue.

---

## 6. Publicar no GitHub Pages

1. Crie uma conta no <https://github.com> e clique em **New repository** (nome: `boss-battle-sql`, **Public**).
2. Clique em **uploading an existing file** e envie **todos os arquivos e a pasta `sql/`** (com o `config.js` já preenchido com URL e chave **pública**). Clique em **Commit changes**.
3. Vá em **Settings** > **Pages**. Em *Build and deployment*, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e clique em **Save**.
4. Espere 1 a 3 minutos. O link aparece na própria página: `https://SEU-USUARIO.github.io/boss-battle-sql/`.
5. Passe esse link para a turma.

Se mudar algo depois (ex.: o `config.js`), envie o arquivo novamente e espere o Pages atualizar.

## 7. Tentativa única e falhas técnicas

**Como o bloqueio funciona (no servidor):**
- Ao clicar em **INICIAR PARTIDA**, o servidor valida o código, registra a tentativa e já a marca como usada. Um índice único no banco impede uma segunda tentativa válida para o mesmo aluno.
- Fechar o navegador ou perder a internet **não libera** nova tentativa. Se o aluno não enviar o resultado, o servidor encerra a partida quando o tempo acaba e salva só as **respostas já dadas** (robôs e chefe não contam, pois só o navegador sabe disso).
- Quem tentar entrar de novo vê a mensagem de que a tentativa já foi utilizada (e, se já terminou, o próprio resultado e a posição).
- O resultado só é aceito **uma vez**. Reenviar não duplica nada.

**Procedimento para falha técnica legítima (professor):**
1. Confirme o problema (queda de energia, computador travou etc.) e veja o estado do aluno com `select * from admin_status();`.
2. Rode `select admin_void_attempt('Nome do Aluno', 'motivo da falha');`
3. A tentativa antiga é anulada (fica guardada com o motivo, para conferência) e o aluno pode entrar de novo **com o mesmo código**. Ele recebe perguntas sorteadas de novo.
4. Há limite de **1 reinício por aluno**. Para um caso realmente excepcional, use `admin_void_attempt('Nome', 'motivo', true)`.

Sugestão de regra para a turma: reinício só com autorização do professor e registro do motivo.

## 8. Testar o ranking em dois computadores

1. No **computador A**, abra o link do GitHub Pages, entre com o código do aluno 1 e termine a partida (ou deixe o tempo acabar).
2. No **computador B** (ou outro navegador, ou aba anônima), abra o mesmo link. A tela inicial mostra o **Top 10** com o aluno 1. Se não aparecer, clique em **ATUALIZAR**.
3. No computador B, jogue com o código do aluno 2. Ao terminar, o ranking dos **dois** computadores deve mostrar os dois jogadores, ordenados por pontos.
4. Teste a tentativa única: no computador B, tente entrar de novo com o código do aluno 2. Deve aparecer *"Sua tentativa oficial já foi utilizada"*.
5. Teste a segurança: no navegador, abra `SUA_URL/rest/v1/results?select=*` (com a chave no cabeçalho `apikey`) e confira que retorna **erro de permissão**, e não os dados.

## 9. Segurança: o que foi feito e o que **não** dá para garantir

**Feito:**
- Todas as tabelas têm **RLS ligado e nenhuma policy**, e as permissões de `anon`/`authenticated` foram revogadas. O navegador **não consegue ler nem escrever** em nenhuma tabela, só chamar 5 funções.
- Os códigos ficam como **hash SHA-256**; ninguém (nem no navegador) consegue listar códigos de outros alunos.
- O servidor **corrige as respostas**, impede repetir pergunta e **calcula a pontuação**. O jogador não envia pontos, só o que aconteceu (resultado, robôs, chefe).
- O ranking público mostra só **apelido, pontos, acertos, tempo e posição**.
- O código errado tem uma pequena espera (anti-adivinhação) e o código tem ~1 trilhão de combinações.
- Nenhuma chave secreta está no código publicado.

**Limite honesto:** o combate roda no navegador. O servidor confere o que consegue (respostas, tempo, limites de robôs derrotados, chefe só com 6 desafios e pelo menos 90 s de partida), mas um aluno muito habilidoso com ferramentas de desenvolvedor poderia declarar mais robôs derrotados dentro desses limites. Por isso o teto é baixo (40 robôs = 2000 pontos), e a maior parte da pontuação vem de respostas e do chefe. Para validação total do combate seria preciso rodar a simulação no servidor, o que está fora do escopo de um projeto escolar. O professor pode conferir resultados suspeitos com `admin_status()`.

## 10. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Ranking indisponível: Supabase não configurado" | Preencha o `config.js` (Passo 3) e envie de novo ao GitHub. |
| "Código não encontrado" | Confira o código com o professor (letras e números, sem I, O, 0 ou 1). |
| Erro ao rodar `01_schema.sql` | Rode o arquivo inteiro de uma vez, em uma query nova. Se pedir, confirme. |
| Ranking não carrega | Veja a internet e clique em **ATUALIZAR**. A mensagem de falha é mostrada na tela. |
| Ranking vazio | Ele só mostra partidas **concluídas**. Partidas abandonadas entram quando o tempo expira. |
| Fontes diferentes | O jogo usa Google Fonts; sem internet para ela, usa fontes padrão e continua funcionando. |

## 11. Créditos

Projeto escolar do curso técnico de Desenvolvimento de Sistemas — SENAI. Tema: Segurança e Desempenho em SQL (Grupo 3).
