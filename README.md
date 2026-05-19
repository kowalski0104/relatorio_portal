# Portal do Acordo

Projeto do relatório gerencial do Portal do Acordo, com frontend Vite/React e backend Node/Express.

## Estrutura

- `portal-do-acordo-frontend/`: aplicação web do relatório.
- `portal-do-acordo-backend/`: API de dados, cache da base ativa e futuras rotas de webhook.
- `portal-do-acordo-backend/database/indexes.sql`: índices sugeridos para otimizar as consultas.
- `docs/azure-deploy.md`: passo a passo para publicar na Azure.

## Rodar localmente

Backend:

```powershell
cd .\portal-do-acordo-backend
npm run dev
```

Frontend:

```powershell
cd .\portal-do-acordo-frontend
npm run dev
```

## Rodar na rede interna

Backend:

```powershell
cd .\portal-do-acordo-backend
npm run dev:lan
```

Frontend:

```powershell
cd .\portal-do-acordo-frontend
npm run dev:lan
```

Depois acesse pelo IP do computador que está hospedando:

```text
http://IP-DO-COMPUTADOR:5173
```

Para descobrir o IP:

```powershell
ipconfig
```

Use o IPv4 da placa conectada à rede da empresa.

## Variáveis de ambiente

Use os arquivos de exemplo como base:

- Backend: `portal-do-acordo-backend/.env.example`
- Frontend produção: `portal-do-acordo-frontend/.env.production.example`

Nunca envie `.env` real para o GitHub.

## Cache local da Base Ativa

A aba Bases usa um cache local em JSON para não rodar a consulta pesada a cada acesso. Com o backend ligado, o cache é atualizado automaticamente uma vez por dia no horário configurado por `ACTIVE_BASE_REFRESH_HOUR`.

Arquivo padrão:

```text
portal-do-acordo-backend/data/base_ativa_cache.json
```

Para disparar uma atualização manual sem travar a tela:

```powershell
Invoke-WebRequest -Method Post http://localhost:3001/api/base-ativa/refresh
```

## Deploy na Azure

O caminho recomendado está documentado em:

```text
docs/azure-deploy.md
```

Resumo:

- Frontend: Azure Static Web Apps Free, com domínio `relatorio.portaldoacordo.com.br`.
- Backend: Azure App Service Free F1, usando a URL `*.azurewebsites.net`.
- Webhook: inicialmente no mesmo backend do App Service.

Observação importante: no plano Free F1 do App Service, domínio próprio no backend não é suportado. Para usar `api-relatorio.portaldoacordo.com.br`, será necessário subir o backend para um plano pago, como Shared/Basic.
