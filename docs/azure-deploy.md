# Deploy na Azure

Este projeto deve ser publicado como dois recursos separados:

- Frontend: Azure Static Web Apps.
- Backend/API/Webhook: Azure App Service.

## Limite importante do plano grátis

O frontend pode usar domínio próprio no Azure Static Web Apps Free.

O backend pode rodar no Azure App Service Free F1, mas esse plano não aceita domínio próprio no App Service. Então, no cenário 100% grátis:

```text
https://relatorio.portaldoacordo.com.br       -> frontend
https://NOME-DO-BACKEND.azurewebsites.net     -> backend, API e webhook
```

Se depois for necessário usar `https://api-relatorio.portaldoacordo.com.br`, será preciso subir o App Service para um plano pago que aceite custom domain.

## 1. Backend no Azure App Service

Crie um App Service:

- Runtime: Node.js
- Sistema operacional: Linux
- Plano: Free F1
- Exemplo de nome: `portal-relatorio-api`
- URL gerada: `https://portal-relatorio-api.azurewebsites.net`

Configurações do App Service:

- Startup command: `npm start`
- Health check manual: `https://portal-relatorio-api.azurewebsites.net/health`

Variáveis de ambiente no App Service:

```text
DATABASE_URL_401=postgresql://...
DATABASE_URL_1007=postgresql://...
EMAIL_MONTHLY_AGGREGATE_DATABASE_URL=postgresql://...
CORS_ORIGINS=https://relatorio.portaldoacordo.com.br,https://NOME-DO-FRONT.azurestaticapps.net,http://localhost:5173
COMUNICACAO_CACHE_TTL_MS=14400000
USE_EMAIL_MONTHLY_AGGREGATE=false
WATI_MESSAGE_COST_BRL=0.05
ACTIVE_BASE_CACHE_FILE=data/base_ativa_cache.json
ACTIVE_BASE_AUTO_REFRESH_ON_START=false
ACTIVE_BASE_REFRESH_HOUR=5
ACTIVE_BASE_SUMMARY_TIMEOUT_MS=60000
ACTIVE_BASE_AGING_TIMEOUT_MS=180000
ACTIVE_BASE_AGING_CREDITOR_TIMEOUT_MS=900000
ACTIVE_BASE_AGING_BATCH_SIZE=1000
ACTIVE_BASE_REFRESHING_STALE_MS=300000
```

Observações:

- Não coloque aspas nos valores dentro da Azure.
- O App Service usa a variável `PORT` automaticamente; o backend já está preparado para isso.
- O plano Free pode dormir e tem limite de CPU. Para relatório interno, serve para validação; para uso constante com gestores e webhook crítico, o ideal é subir de plano depois.

### Deploy do backend sem Deployment Center

Se o Deployment Center der erro de token do GitHub, use o workflow manual do repositório:

```text
.github/workflows/backend-azure-app-service.yml
```

No GitHub, crie estes secrets em `Settings > Secrets and variables > Actions`:

```text
AZURE_BACKEND_APP_NAME=portal-relatorio-api
AZURE_BACKEND_PUBLISH_PROFILE=<conteudo do Publish Profile baixado no App Service>
```

Para baixar o Publish Profile:

```text
Azure Portal > App Service > Overview > Download publish profile
```

Depois rode:

```text
GitHub > Actions > Deploy backend to Azure App Service > Run workflow
```

## 2. Frontend no Azure Static Web Apps

Crie um Static Web App:

- Plano: Free
- Fonte: GitHub
- Repositório: `kowalski0104/relatorio_portal`
- Branch: `main`
- Build preset: Vite ou Custom
- App location: `portal-do-acordo-frontend`
- API location: vazio
- Output location: `dist`
- Build command: `npm run build`

Variável de ambiente de build:

```text
VITE_API_BASE_URL=https://portal-relatorio-api.azurewebsites.net
```

O arquivo `portal-do-acordo-frontend/public/staticwebapp.config.json` já está preparado para:

- fallback de SPA para `index.html`;
- headers básicos de segurança;
- MIME type de JSON.

### Deploy do frontend sem Deployment Center

Se preferir não usar a integração automática do Portal da Azure, use o workflow manual:

```text
.github/workflows/frontend-azure-static-web-app.yml
```

No GitHub, crie estes secrets:

```text
AZURE_STATIC_WEB_APPS_API_TOKEN=<deployment token do Static Web App>
VITE_API_BASE_URL=https://portal-relatorio-api.azurewebsites.net
```

Para pegar o token:

```text
Azure Portal > Static Web App > Manage deployment token
```

Depois rode:

```text
GitHub > Actions > Deploy frontend to Azure Static Web Apps > Run workflow
```

## 3. Domínio do frontend

No Static Web App, adicione o domínio:

```text
relatorio.portaldoacordo.com.br
```

Na zona DNS da Azure do domínio principal, crie os registros que o próprio Static Web App mostrar. Normalmente será um CNAME apontando para o domínio gerado do Static Web Apps.

Depois que o domínio validar, a Azure emite SSL automaticamente para esse domínio.

## 4. Webhook

Quando o webhook for implementado, use inicialmente a URL do App Service:

```text
https://portal-relatorio-api.azurewebsites.net/api/webhook/meta
```

Se for necessário domínio próprio no webhook:

```text
https://api-relatorio.portaldoacordo.com.br/api/webhook/meta
```

Nesse caso o backend precisará sair do plano Free F1 para um plano que aceite custom domain.

## 5. Checklist depois do deploy

Teste o backend:

```text
https://portal-relatorio-api.azurewebsites.net/health
https://portal-relatorio-api.azurewebsites.net/api/baixas
```

Teste o frontend:

```text
https://relatorio.portaldoacordo.com.br
```

Se o frontend abrir mas os dados não carregarem:

- confira `VITE_API_BASE_URL` no Static Web Apps;
- confira `CORS_ORIGINS` no App Service;
- confira se o banco externo aceita conexão do IP da Azure;
- confira as variáveis `DATABASE_URL_401` e `DATABASE_URL_1007`.
