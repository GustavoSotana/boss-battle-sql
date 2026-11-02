'use strict';
/*
  questions.js
  - COMMANDS: cores e efeitos de cada comando na arena (metáforas do jogo).
  - QUESTION_BANK: as 24 perguntas (6 por comando).

  ATENÇÃO: na partida OFICIAL as perguntas e respostas vêm do Supabase
  (arquivo sql/02_questions.sql, gerado a partir deste arquivo). Este banco
  é usado no MODO TREINO, que não vale ranking.
  Campos: id, command, prompt, options (3 itens), correct (0, 1 ou 2), explanation.
*/

const COMMANDS = {
  'GRANT': {
    color: '#38bdf8',
    ability: 'Drone aliado',
    effect: 'Um drone aliado passa a orbitar você e atirar nos robôs.'
  },
  'REVOKE': {
    color: '#ff3b6b',
    ability: 'Escudos revogados',
    effect: 'Os escudos de acesso dos robôs e do chefe caem e eles ficam vulneráveis por alguns segundos.'
  },
  'CREATE INDEX': {
    color: '#a855f7',
    ability: 'Index Boost',
    effect: 'Você ganha velocidade, ataque mais rápido e mais dano por 25 segundos.'
  },
  'DROP INDEX': {
    color: '#fbbf24',
    ability: 'Índices removidos',
    effect: 'Os bônus de desempenho dos robôs somem, eles ficam lentos e o chefe perde a fúria por alguns segundos.'
  }
};

const QUESTION_BANK = [
  // ---------------- GRANT ----------------
  { id: 1, command: 'GRANT',
    prompt: 'O que o comando GRANT faz em um banco de dados?',
    options: ['Concede privilégios a um usuário ou papel.', 'Exclui todas as tabelas.', 'Remove um índice.'],
    correct: 0,
    explanation: 'GRANT é um comando de controle de acesso (DCL): ele concede privilégios, como SELECT ou INSERT, a um usuário ou papel.' },
  { id: 2, command: 'GRANT',
    prompt: 'Qual comando permite que o usuário ana consulte a tabela clientes?',
    options: ['REVOKE SELECT ON clientes FROM ana;', 'GRANT SELECT ON clientes TO ana;', 'CREATE INDEX ON clientes(ana);'],
    correct: 1,
    explanation: 'A forma é GRANT privilégio ON objeto TO usuário. Aqui, ana recebe o privilégio SELECT na tabela clientes.' },
  { id: 3, command: 'GRANT',
    prompt: 'Depois de GRANT INSERT, UPDATE ON pedidos TO vendas; o que o papel vendas pode fazer?',
    options: ['Apagar a tabela pedidos.', 'Criar uma cópia da tabela.', 'Inserir e atualizar dados em pedidos.'],
    correct: 2,
    explanation: 'Só os privilégios listados são concedidos: INSERT e UPDATE. Apagar a tabela ou fazer outras operações exigiria outros privilégios.' },
  { id: 4, command: 'GRANT',
    prompt: 'Qual é a vantagem de conceder privilégios a um papel (role) em vez de a cada usuário?',
    options: ['Facilita administrar as permissões de vários usuários de uma vez.', 'Deixa o banco automaticamente mais rápido.', 'Impede qualquer usuário de acessar os dados.'],
    correct: 0,
    explanation: 'Com papéis, você concede o privilégio uma vez e depois associa os usuários ao papel. Isso organiza e simplifica a manutenção da segurança.' },
  { id: 5, command: 'GRANT',
    prompt: 'Qual princípio de segurança recomenda conceder ao usuário apenas as permissões de que ele precisa?',
    options: ['Normalização.', 'Redundância.', 'Privilégio mínimo.'],
    correct: 2,
    explanation: 'Privilégio mínimo reduz o estrago possível se uma conta for usada de forma indevida ou por engano. Use GRANT com cuidado.' },
  { id: 6, command: 'GRANT',
    prompt: 'Em muitos SGBDs, o que a cláusula WITH GRANT OPTION permite?',
    options: ['Que o privilégio expire em 24 horas.', 'Que quem recebeu o privilégio possa repassá-lo a outros usuários.', 'Que o usuário apague o banco inteiro.'],
    correct: 1,
    explanation: 'WITH GRANT OPTION deixa o destinatário conceder o mesmo privilégio a terceiros. Por isso deve ser usada com muito critério.' },

  // ---------------- REVOKE ----------------
  { id: 7, command: 'REVOKE',
    prompt: 'Para que serve o comando REVOKE?',
    options: ['Criar uma tabela.', 'Retirar privilégios concedidos anteriormente.', 'Aumentar a memória RAM.'],
    correct: 1,
    explanation: 'REVOKE é o oposto de GRANT: retira privilégios que já tinham sido concedidos a um usuário ou papel.' },
  { id: 8, command: 'REVOKE',
    prompt: 'Qual comando retira de ana a permissão de ler a tabela clientes?',
    options: ['REVOKE SELECT ON clientes FROM ana;', 'GRANT SELECT ON clientes TO ana;', 'DROP INDEX clientes;'],
    correct: 0,
    explanation: 'A forma é REVOKE privilégio ON objeto FROM usuário. Repare que REVOKE usa FROM, enquanto GRANT usa TO.' },
  { id: 9, command: 'REVOKE',
    prompt: 'Depois de REVOKE INSERT ON pedidos FROM vendas; o que acontece?',
    options: ['A tabela pedidos é apagada.', 'Todos os dados de pedidos são removidos.', 'O papel vendas perde a permissão de inserir; a tabela e os dados continuam.'],
    correct: 2,
    explanation: 'REVOKE mexe somente nas permissões. A tabela e os dados não são afetados.' },
  { id: 10, command: 'REVOKE',
    prompt: 'Em um REVOKE, quem aparece depois da palavra FROM?',
    options: ['A tabela afetada.', 'O usuário ou papel que perde o privilégio.', 'O nome do índice.'],
    correct: 1,
    explanation: 'Depois do FROM vem o usuário ou papel que perderá o privilégio. A tabela aparece depois do ON.' },
  { id: 11, command: 'REVOKE',
    prompt: 'Um funcionário mudou de setor e não deve mais ver dados financeiros. Qual é a ação mais adequada?',
    options: ['Revogar os privilégios que ele não precisa mais.', 'Dar a ele privilégios de administrador.', 'Criar um índice em todas as tabelas.'],
    correct: 0,
    explanation: 'Manter permissões antigas viola o privilégio mínimo. Revogar o que não é mais necessário é uma boa prática de segurança.' },
  { id: 12, command: 'REVOKE',
    prompt: 'GRANT e REVOKE pertencem a qual grupo de comandos da SQL?',
    options: ['DML (manipulação de dados).', 'DQL (consulta de dados).', 'DCL (controle de dados).'],
    correct: 2,
    explanation: 'DCL (Data Control Language) cuida de permissões e acesso. GRANT e REVOKE são os principais comandos dela.' },

  // ---------------- CREATE INDEX ----------------
  { id: 13, command: 'CREATE INDEX',
    prompt: 'Qual é o principal objetivo de criar um índice em uma tabela?',
    options: ['Acelerar determinadas consultas (buscas).', 'Criptografar os dados.', 'Conceder permissões.'],
    correct: 0,
    explanation: 'Índices podem acelerar consultas, mas ocupam espaço e têm custo de manutenção. Não são grátis.' },
  { id: 14, command: 'CREATE INDEX',
    prompt: 'Qual comando cria um índice na coluna email da tabela clientes?',
    options: ['GRANT INDEX ON clientes(email);', 'CREATE INDEX idx_email ON clientes(email);', 'ADD ROW email INTO clientes;'],
    correct: 1,
    explanation: 'A forma é CREATE INDEX nome ON tabela(coluna). O índice ajuda consultas que filtram ou ordenam por email.' },
  { id: 15, command: 'CREATE INDEX',
    prompt: 'Qual é uma desvantagem de criar índices em excesso?',
    options: ['Eles impedem o uso de SELECT.', 'Eles removem privilégios dos usuários.', 'Ocupam espaço e deixam INSERT, UPDATE e DELETE mais custosos.'],
    correct: 2,
    explanation: 'A cada alteração na tabela, os índices também precisam ser atualizados. Por isso, crie índices só onde há ganho real.' },
  { id: 16, command: 'CREATE INDEX',
    prompt: 'Em qual tipo de coluna um índice costuma trazer mais benefício?',
    options: ['Colunas muito usadas em WHERE, JOIN ou ORDER BY.', 'Colunas que nunca são consultadas.', 'Apenas colunas de tabelas vazias.'],
    correct: 0,
    explanation: 'Índices ajudam onde o banco precisa localizar ou ordenar dados com frequência. Colunas nunca consultadas só geram custo.' },
  { id: 17, command: 'CREATE INDEX',
    prompt: 'O que acontece com um índice quando novos registros são inseridos na tabela?',
    options: ['Nada: o índice nunca muda.', 'O índice também precisa ser atualizado, o que tem um custo.', 'O índice é apagado automaticamente.'],
    correct: 1,
    explanation: 'Manter o índice atualizado é o custo de manutenção. Tabelas com muita escrita sofrem mais com excesso de índices.' },
  { id: 18, command: 'CREATE INDEX',
    prompt: 'Qual comando cria um índice único (sem valores repetidos) na coluna cpf?',
    options: ['CREATE INDEX UNIQUE cpf;', 'GRANT UNIQUE ON cpf;', 'CREATE UNIQUE INDEX idx_cpf ON alunos(cpf);'],
    correct: 2,
    explanation: 'CREATE UNIQUE INDEX impede valores repetidos na coluna e, de quebra, pode acelerar buscas por ela.' },

  // ---------------- DROP INDEX ----------------
  { id: 19, command: 'DROP INDEX',
    prompt: 'O que faz o comando DROP INDEX?',
    options: ['Cria um índice novo.', 'Remove um índice existente.', 'Concede privilégios a um usuário.'],
    correct: 1,
    explanation: 'DROP INDEX remove um índice existente. Isso pode prejudicar o desempenho de algumas consultas que dependiam dele.' },
  { id: 20, command: 'DROP INDEX',
    prompt: 'Qual comando remove o índice chamado idx_email?',
    options: ['DROP INDEX idx_email;', 'DROP TABLE idx_email;', 'REVOKE INDEX idx_email;'],
    correct: 0,
    explanation: 'DROP INDEX nome remove o índice. Em alguns SGBDs (como MySQL e SQL Server) é preciso informar também a tabela com ON.' },
  { id: 21, command: 'DROP INDEX',
    prompt: 'Ao executar DROP INDEX, os dados da tabela são apagados?',
    options: ['Sim, todos os dados.', 'Sim, apenas as colunas indexadas.', 'Não: só o índice é removido; os dados da tabela permanecem.'],
    correct: 2,
    explanation: 'O índice é uma estrutura auxiliar. Removê-lo não apaga as linhas da tabela, mas algumas consultas podem ficar mais lentas.' },
  { id: 22, command: 'DROP INDEX',
    prompt: 'Por que pode valer a pena remover um índice que quase nunca é usado?',
    options: ['Porque aumenta os privilégios do usuário.', 'Porque reduz o espaço ocupado e o custo de INSERT, UPDATE e DELETE.', 'Porque cria uma cópia da tabela.'],
    correct: 1,
    explanation: 'Índices sem uso só geram custo de espaço e de manutenção. Removê-los pode melhorar as operações de escrita.' },
  { id: 23, command: 'DROP INDEX',
    prompt: 'Qual risco existe ao remover um índice que é muito usado pelas consultas?',
    options: ['Algumas consultas podem ficar mais lentas.', 'Os usuários perdem o acesso ao banco.', 'A tabela fica bloqueada para sempre.'],
    correct: 0,
    explanation: 'Sem o índice, o banco pode precisar varrer a tabela inteira. Antes de remover, confirme se ele não é importante.' },
  { id: 24, command: 'DROP INDEX',
    prompt: 'Como decidir se vale a pena remover um índice?',
    options: ['Apagar o de nome mais comprido.', 'Remover todos para ver o que acontece.', 'Verificar se as consultas o utilizam (por exemplo, com EXPLAIN ou estatísticas de uso).'],
    correct: 2,
    explanation: 'Decisões de desempenho devem se basear em evidências: veja o plano de execução (EXPLAIN) e as estatísticas de uso do índice.' }
];

if (typeof module !== 'undefined') { module.exports = { COMMANDS, QUESTION_BANK }; }
if (typeof window !== 'undefined') { window.COMMANDS = COMMANDS; window.QUESTION_BANK = QUESTION_BANK; }
