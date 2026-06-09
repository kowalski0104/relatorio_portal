# Relatorio de implementacao - Email links em lote

Data: 2026-06-09
Projeto: `portal-do-acordo-backend`
Endpoint criado: `POST /api/email-links/bulk-generate`

## 1. Resumo

Foi implementado um endpoint para gerar e reutilizar links de rastreamento em lote usando a tabela existente `email_envios` e a rota publica ja existente `/r/:token`.

Nao foi alterada a rota `/r/:token`. O comportamento dos links antigos permanece igual:

1. `/r/:token` procura o token em `email_envios`.
2. grava clique em `email_cliques`.
3. redireciona para `url_destino`.

O novo endpoint cria ou reutiliza registros em `email_envios` e retorna `link_tracking` por item para uso futuro no `listmonk-integrator`.

## 2. Arquivos alterados

- `src/app.ts`
- `src/routes/emailLinksRoutes.ts`
- `src/services/emailLinksService.ts`
- `.env.example`
- `docs/email-links-bulk-generate.example.json`
- `dist/src/app.js`
- `dist/src/app.js.map`
- `dist/src/routes/emailLinksRoutes.js`
- `dist/src/routes/emailLinksRoutes.js.map`
- `dist/src/services/emailLinksService.js`
- `dist/src/services/emailLinksService.js.map`

Arquivo criado:

- `RELATORIO_IMPLEMENTACAO_EMAIL_LINKS.md`

## 3. Endpoint

Rota:

```http
POST /api/email-links/bulk-generate
```

Como `app.ts` registra:

```ts
app.use('/api/email-links', emailLinksRouter);
```

Logo, a URL local fica:

```text
http://localhost:3001/api/email-links/bulk-generate
```

## 4. Seguranca

O endpoint usa API key via header:

```http
x-api-key: valor_da_chave
```

Variavel de ambiente:

```text
EMAIL_LINKS_API_KEY
```

Regra implementada:

- Se `EMAIL_LINKS_API_KEY` estiver configurada, o header `x-api-key` e obrigatorio.
- Se `EMAIL_LINKS_API_KEY` nao estiver configurada, chamadas locais sao permitidas.
- Se `EMAIL_LINKS_API_KEY` nao estiver configurada e a chamada nao for local, o endpoint retorna `503`.

Nenhuma chave real foi gravada no codigo.

## 5. Variaveis de ambiente documentadas

Foram adicionados placeholders em `.env.example`:

```text
AZURE_SQL_SERVER
AZURE_SQL_DATABASE
AZURE_SQL_USER
AZURE_SQL_PASSWORD
PUBLIC_API_BASE_URL
EMAIL_LINKS_API_KEY
```

Nao foram alterados valores no `.env` real.

## 6. Schema de `email_envios`

Tentei verificar o schema real no Azure SQL via consulta read-only em `INFORMATION_SCHEMA.COLUMNS`, mas a conexao a partir desta maquina falhou na porta 1433.

Nao foi encontrada DDL local da tabela `email_envios`.

Por isso, a implementacao ficou adaptativa:

- em runtime, o endpoint consulta `INFORMATION_SCHEMA.COLUMNS`;
- usa apenas os campos existentes;
- nao cria coluna;
- nao roda migration;
- nao altera estrutura de banco.

Campos minimos exigidos em runtime:

- `token`
- `url_destino`
- `email_destinatario` ou `email`

Campos conhecidos pelo uso atual da rota `/r/:token`:

- `token`
- `processo`
- `email_destinatario`
- `credor`
- `grupo`
- `campanha`
- `template`
- `url_destino`

## 7. Campos usados pelo novo endpoint

O endpoint salva os campos abaixo somente se existirem em `email_envios`:

- `token`
- `url_destino`
- `email_destinatario` ou `email`
- `processo`
- `credor_fantasia`
- `credor`
- `grupo`
- `devedor_razao`
- `devedor_cnpj`
- `titulos_aberto_total`
- `campanha`
- `origem`
- `payload_json` ou `payload`
- `unique_key`
- `created_at`, `createdAt`, `criado_em` ou `data_criacao`
- `updated_at`, `updatedAt`, `atualizado_em` ou `data_atualizacao`
- `ativo`, `is_active` ou `active`

Se `payload_json` nao existir, o payload extra nao sera persistido.
Se `unique_key` nao existir, o endpoint usa busca por campos existentes para tentar reutilizar links.

## 8. Geracao de token

Formato:

```text
{prefixo}-{UUID}
```

Prefixo:

- `sisth` quando `credor_fantasia` contem `SISTH`;
- `consulth` quando `credor_fantasia` contem `CONSULTH`;
- `portal` nos demais casos.

Exemplos:

```text
sisth-2B88...3CBEA
consulth-F7F8...CB87
portal-UUID
```

Antes de inserir, o endpoint verifica se o token gerado ja existe em `email_envios`.

## 9. Idempotencia e reutilizacao

Se a coluna `unique_key` existir:

- o endpoint calcula uma chave logica;
- procura registro existente por `unique_key`;
- se encontrar, reutiliza o token;
- atualiza os dados principais e `payload_json`, se os campos existirem.

Prioridade da chave logica:

1. `origem + campanha + processo + email + credor_fantasia`
2. `origem + processo + email + credor_fantasia`
3. `origem + email + credor_fantasia`

Fallback quando `unique_key` nao existe:

- tenta reutilizar por combinacoes dos campos existentes;
- usa `campanha`, `processo`, `email`, `credor/grupo` quando disponiveis;
- nao garante idempotencia perfeita em concorrencia, porque nao ha constraint unica confirmada no banco.

Recomendacao futura: criar `unique_key` com indice unico depois de validar o schema real e aprovar migration.

## 10. Validacao de entrada

Regras implementadas:

- `items` e obrigatorio;
- `items` deve ser array;
- limite atual: 1000 itens por request;
- `email` e obrigatorio e validado como email;
- `processo` e opcional;
- `url_destino` e opcional;
- se `url_destino` nao vier, usa `https://portaldoacordo.com.br`;
- `url_destino` deve usar `https` e host `portaldoacordo.com.br`.

## 11. Link retornado

Base publica:

1. usa `PUBLIC_API_BASE_URL`, se configurada;
2. caso contrario, usa:

```text
https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net
```

Formato:

```text
{PUBLIC_API_BASE_URL}/r/{token}
```

Exemplo:

```text
https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net/r/sisth-UUID
```

## 12. Tratamento de erro por item

Se um item falhar:

- o lote continua;
- o item volta com `status: "failed"`;
- o erro e adicionado em `errors`;
- stack trace nao e exposta no response;
- o backend faz log com indice, processo e email.

## 13. Exemplo de payload

Arquivo criado:

```text
docs/email-links-bulk-generate.example.json
```

Conteudo resumido:

```json
{
  "origem": "listmonk",
  "campanha": "teste_email_links",
  "url_destino": "https://portaldoacordo.com.br",
  "items": [
    {
      "processo": "8/104274",
      "email": "cliente.sisth@example.com",
      "devedor_razao": "CLIENTE TESTE SISTH",
      "devedor_cnpj": "00000000000",
      "credor_fantasia": "SISTH",
      "titulos_aberto_total": "R$ 2.158,31",
      "payload": {
        "qualquer_dado_extra": "valor_sisth"
      }
    }
  ]
}
```

## 14. Exemplo de curl

Com API key:

```bash
curl -X POST "http://localhost:3001/api/email-links/bulk-generate" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $EMAIL_LINKS_API_KEY" \
  --data @docs/email-links-bulk-generate.example.json
```

Em ambiente local sem `EMAIL_LINKS_API_KEY` configurada:

```bash
curl -X POST "http://localhost:3001/api/email-links/bulk-generate" \
  -H "Content-Type: application/json" \
  --data @docs/email-links-bulk-generate.example.json
```

PowerShell:

```powershell
$body = Get-Content .\docs\email-links-bulk-generate.example.json -Raw
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3001/api/email-links/bulk-generate" `
  -ContentType "application/json" `
  -Body $body
```

PowerShell com API key:

```powershell
$body = Get-Content .\docs\email-links-bulk-generate.example.json -Raw
$headers = @{ "x-api-key" = $env:EMAIL_LINKS_API_KEY }
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3001/api/email-links/bulk-generate" `
  -ContentType "application/json" `
  -Headers $headers `
  -Body $body
```

## 15. Exemplo de response

```json
{
  "success": true,
  "total": 2,
  "created": 2,
  "reused": 0,
  "failed": 0,
  "items": [
    {
      "processo": "8/104274",
      "email": "cliente.sisth@example.com",
      "token": "sisth-2B88...3CBEA",
      "link_tracking": "https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net/r/sisth-2B88...3CBEA",
      "status": "created"
    },
    {
      "processo": "9/204875",
      "email": "cliente.consulth@example.com",
      "token": "consulth-F7F8...CB87",
      "link_tracking": "https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net/r/consulth-F7F8...CB87",
      "status": "created"
    }
  ],
  "errors": []
}
```

## 16. Testes executados

Executado:

```bash
npm run build
```

Resultado:

- build TypeScript concluido com sucesso.

Teste leve de rota sem banco:

- o app foi iniciado em porta temporaria via `createApp()`;
- `POST /api/email-links/bulk-generate` com `items: []` retornou `400`;
- `POST /api/email-links/bulk-generate` com `url_destino` fora de `https://portaldoacordo.com.br` retornou `400`;
- esse teste nao tentou conectar no Azure SQL.

Tambem foi feita checagem de busca por possiveis segredos reais nos arquivos alterados. Nao foi gravada senha real nem API key real.

Nao executado:

- chamada real do endpoint gravando no Azure SQL.

Motivo:

- a tentativa de conexao read-only ao Azure SQL a partir desta maquina falhou por conexao na porta 1433.

## 17. Validacao do fluxo de tracking em 2026-06-09

Objetivo da validacao:

- confirmar conexao com Azure SQL;
- listar schema real de `email_envios` e `email_cliques`;
- chamar `POST /api/email-links/bulk-generate` com payload interno;
- abrir links retornados;
- validar registro em `email_cliques`;
- testar reuso;
- testar links antigos.

### Resultado da conexao Azure SQL

Resultado a partir desta maquina:

```text
Azure SQL: erro de conexao TCP/SQL
Porta: 1433
Mensagem controlada: Failed to connect to sql-email-tracking.database.windows.net:1433 - Could not connect (sequence)
```

Tambem foi testada conectividade TCP:

```text
TcpTestSucceeded: False
```

Conclusao: o banco pode estar ativo, mas esta maquina ainda nao consegue abrir conexao TCP na porta 1433. Isso costuma indicar bloqueio de rede/firewall/liberacao de IP no Azure SQL, antes da etapa de autenticacao por usuario/senha.

Nenhuma senha ou credencial foi impressa.

### Schema real

Nao foi possivel listar o schema real de:

- `email_envios`
- `email_cliques`

Motivo: a consulta read-only em `INFORMATION_SCHEMA.COLUMNS` nao chegou a executar porque a conexao TCP/SQL falhou.

### Payload usado no teste do endpoint

Payload interno usado:

```json
{
  "origem": "listmonk",
  "campanha": "teste_listmonk_tracking_100",
  "url_destino": "https://portaldoacordo.com.br",
  "items": [
    {
      "processo": "TESTE-SISTH-001",
      "email": "matheus.kowalski@sisth.com.br",
      "devedor_razao": "TESTE SISTH",
      "devedor_cnpj": "00000000000",
      "credor_fantasia": "SISTH",
      "titulos_aberto_total": "R$ 2.158,31",
      "payload": {
        "origem_teste": "listmonk",
        "ambiente": "validacao_tracking_100"
      }
    },
    {
      "processo": "TESTE-CONSULTH-001",
      "email": "matheus.kowalski@consulth.com.br",
      "devedor_razao": "TESTE CONSULTH",
      "devedor_cnpj": "00000000000",
      "credor_fantasia": "CONSULTH",
      "titulos_aberto_total": "R$ 2.158,31",
      "payload": {
        "origem_teste": "listmonk",
        "ambiente": "validacao_tracking_100"
      }
    }
  ]
}
```

### Response do endpoint

O backend foi iniciado localmente em porta temporaria via `createApp()` e o endpoint foi chamado.

Resultado:

```json
{
  "status": 500,
  "body": {
    "success": false,
    "error": "Erro ao gerar links de rastreamento."
  }
}
```

Esse e um erro controlado: a stack trace nao foi exposta no response. O motivo interno foi a falha de conexao com o Azure SQL.

Como a escrita em `email_envios` nao ocorreu, nao houve tokens novos nem `link_tracking` novo para abrir.

### Validacao de `/r/:token` com links antigos

Foram testados os links antigos pela URL publica:

```text
/r/sisth-2B88...3CBEA
/r/consulth-F7F8...CB87
```

Resultado:

```text
sisth-2B88...3CBEA    HTTP 302 -> https://portaldoacordo.com.br/
consulth-F7F8...CB87  HTTP 302 -> https://portaldoacordo.com.br/
```

Conclusao: a rota publica antiga `/r/:token` continua funcionando para os tokens existentes e redireciona corretamente para o Portal do Acordo.

Observacao: pelo codigo atual, `/r/:token` grava clique antes do redirect. Como a resposta foi `302`, a execucao passou pela consulta do token e pelo insert de clique no backend publico. Ainda assim, nao foi possivel confirmar o novo registro diretamente em `email_cliques` a partir desta maquina porque a conexao direta ao Azure SQL esta bloqueada.

### Validacao de `email_cliques`

Nao foi possivel consultar `email_cliques` diretamente nesta validacao.

Motivo:

- conexao TCP/SQL para Azure SQL falhou;
- nao foi executada consulta de dados reais por outro canal para evitar expor dados de clientes.

### Teste de reuso

Nao foi possivel validar reuso.

Motivo:

- o primeiro POST nao conseguiu criar/reutilizar registros em `email_envios`;
- sem token criado, nao houve segunda execucao valida para comparar `created` vs `reused`.

### Pendencia para validacao 100%

Para concluir a validacao completa, e necessario liberar a conectividade SQL da maquina/ambiente de teste:

1. liberar no Azure SQL firewall o IP publico de saida usado pelo ambiente local, ou testar diretamente do ambiente Azure onde a API publica ja roda;
2. confirmar `TcpTestSucceeded: True` para `sql-email-tracking.database.windows.net:1433`;
3. rerodar a consulta read-only de schema;
4. rerodar o POST do `bulk-generate`;
5. abrir os `link_tracking` retornados;
6. consultar `email_cliques` pelos tokens criados;
7. repetir o POST para validar `reused`.

## 18. Validacao pelo Azure App Service em 2026-06-09

Objetivo desta rodada:

- publicar o backend no Azure App Service pelo caminho existente de deploy;
- validar a API publica;
- testar links antigos depois do deploy;
- testar `POST /api/email-links/bulk-generate` no ambiente Azure, sem depender da conexao SQL local.

### Pre-publicacao

Build local:

```text
npm run build: OK
```

Checagens realizadas antes do push:

- `git diff --cached --check`: OK;
- `.env` nao foi staged;
- `.env` esta ignorado pelo Git;
- `.env.example` contem apenas placeholders;
- busca por padroes de senha, token, API key e connection string em arquivos versionaveis: sem achados;
- listmonk, editor e integrador nao foram alterados.

### Deploy/publicacao

O deploy do backend usa o workflow:

```text
.github/workflows/backend-azure-app-service.yml
```

Como a Azure CLI nao esta instalada nesta maquina, a publicacao foi feita pelo fluxo existente:

1. commit em `main`;
2. push para `origin/main`;
3. GitHub Actions faz `npm ci`, `npm run build` e deploy para Azure App Service.

Commit publicado:

```text
a58f04c Add bulk email tracking link endpoint
```

Resultado observado na API publica:

- antes do deploy: `POST /api/email-links/bulk-generate` retornava `404 Cannot POST`;
- depois do deploy: o endpoint passou a responder no App Service.

### Health/status da API publica

Base:

```text
https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net
```

Resultados:

```text
GET /       HTTP 200
GET /health HTTP 200
```

### Links antigos depois do deploy

Links testados, mascarados:

```text
/r/sisth-2B88...3CBEA
/r/consulth-F7F8...CB87
```

Resultado:

```text
sisth-2B88...3CBEA    HTTP 302 -> https://portaldoacordo.com.br/
consulth-F7F8...CB87  HTTP 302 -> https://portaldoacordo.com.br/
```

Conclusao: o deploy nao quebrou o comportamento dos links antigos.

### Teste do endpoint novo no App Service

Endpoint:

```text
POST https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net/api/email-links/bulk-generate
```

Payload usado:

```json
{
  "origem": "listmonk",
  "campanha": "teste_listmonk_tracking_100",
  "url_destino": "https://portaldoacordo.com.br",
  "items": [
    {
      "processo": "TESTE-SISTH-001",
      "email": "matheus.kowalski@sisth.com.br",
      "devedor_razao": "TESTE SISTH",
      "devedor_cnpj": "00000000000",
      "credor_fantasia": "SISTH",
      "titulos_aberto_total": "R$ 2.158,31",
      "payload": {
        "origem_teste": "listmonk",
        "ambiente": "azure_app_service"
      }
    },
    {
      "processo": "TESTE-CONSULTH-001",
      "email": "matheus.kowalski@consulth.com.br",
      "devedor_razao": "TESTE CONSULTH",
      "devedor_cnpj": "00000000000",
      "credor_fantasia": "CONSULTH",
      "titulos_aberto_total": "R$ 2.158,31",
      "payload": {
        "origem_teste": "listmonk",
        "ambiente": "azure_app_service"
      }
    }
  ]
}
```

Response observado:

```json
{
  "success": false,
  "error": "EMAIL_LINKS_API_KEY nao configurada para chamadas remotas."
}
```

Status HTTP:

```text
503
```

Conclusao: o endpoint novo esta publicado, mas o App Service ainda nao tem `EMAIL_LINKS_API_KEY` configurada. Por seguranca, o endpoint bloqueia chamadas remotas quando essa variavel nao existe.

Nenhum valor de API key foi impresso.

### Variaveis do App Service

Nao foi possivel listar App Settings diretamente desta maquina porque a Azure CLI nao esta instalada.

Validacao indireta:

- API publica esta online;
- links antigos continuam redirecionando, o que indica que a API publica continua acessando a estrutura existente de tracking;
- `EMAIL_LINKS_API_KEY` esta ausente no App Service, comprovado pelo response `503` do endpoint novo;
- `PUBLIC_API_BASE_URL` ainda nao foi exercitada pelo endpoint, porque a chamada foi bloqueada antes de gerar links.

Variaveis que devem ser conferidas no Azure Portal:

```text
AZURE_SQL_SERVER
AZURE_SQL_DATABASE
AZURE_SQL_USER ou AZURE_SQL_USERNAME
AZURE_SQL_PASSWORD
PUBLIC_API_BASE_URL
EMAIL_LINKS_API_KEY
TRACKING_FALLBACK_URL, se usada futuramente
```

Valor recomendado para `PUBLIC_API_BASE_URL`:

```text
https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net
```

Valor recomendado para fallback de tracking, se for criado/configurado:

```text
https://portaldoacordo.com.br
```

### O que nao foi possivel concluir nesta rodada

Como o endpoint foi bloqueado pela ausencia de `EMAIL_LINKS_API_KEY`, ainda nao foi possivel validar:

- criacao/reuso em `email_envios`;
- retorno de `token`;
- retorno de `link_tracking`;
- abertura dos links novos;
- registro de clique novo em `email_cliques`;
- segundo POST retornando `reused` ou evidenciando duplicidade.

### Proximo passo imediato

Configurar `EMAIL_LINKS_API_KEY` no Azure App Service, sem gravar o valor no repositorio.

Depois disso, repetir o POST enviando:

```text
x-api-key: valor_configurado_no_app_service
```

O valor nao deve ser impresso no terminal nem no relatorio.

## 19. Limitacoes atuais

1. Schema real nao confirmado ao vivo nesta maquina.

O endpoint descobre as colunas em runtime. Se o ambiente de execucao conseguir conectar no Azure SQL, ele usa o schema real.

2. Sem migration.

Nao foram criadas `unique_key` nem `payload_json`. Se esses campos nao existirem, a idempotencia e o payload extra ficam limitados.

3. Idempotencia sem constraint unica nao e perfeita.

Sem indice unico em `unique_key`, duas chamadas concorrentes podem criar duplicidade.

4. Limite de 1000 itens por request.

Para bases grandes, o `listmonk-integrator` deve chamar o endpoint em lotes.

5. Limite do JSON do Express.

O app usa `express.json()` global. Se os lotes crescerem demais, pode ser necessario configurar limite de body explicitamente.

## 20. Proximos passos para integrar com listmonk-integrator

1. Validar conectividade do backend com Azure SQL no ambiente onde ele roda.
2. Executar consulta read-only do schema real de `email_envios`.
3. Testar payload pequeno com dois itens internos.
4. Clicar nos `link_tracking` retornados e confirmar registro em `email_cliques`.
5. Se aprovado, ajustar o `listmonk-integrator` para:
   - normalizar CSV/XLSX;
   - chamar `POST /api/email-links/bulk-generate`;
   - adicionar `link_tracking` no CSV final;
   - adicionar `link_tracking` ao `available_variables.json`.
6. No editor/listmonk, usar:

```gotemplate
{{ TrackLink .Subscriber.Attribs.link_tracking . }}
```

7. Avaliar migration futura, com aprovacao previa, para:
   - adicionar `unique_key`;
   - adicionar `payload_json`;
   - criar indice unico em `unique_key`;
   - adicionar campos de auditoria de importacao, se necessario.
