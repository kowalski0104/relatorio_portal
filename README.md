# Portal do Acordo

Dashboard gerencial desenvolvido para acompanhamento de relatórios operacionais do Portal do Acordo.

O projeto reúne uma aplicação web, uma API de dados e rotinas de apoio para consulta, cache e atualização da base ativa. A ideia é centralizar indicadores em uma tela simples, acessível pela rede ou pela URL publicada em produção.

Produção: `https://relatorio.portaldoacordo.com.br`

## Visão geral

O sistema foi criado para facilitar a consulta de informações gerenciais sem depender de planilhas manuais ou consultas pesadas executadas a cada acesso.

Principais pontos do projeto:

* dashboard web para acompanhamento de dados operacionais;
* API para consulta e organização das informações;
* cache local da base ativa para reduzir consultas pesadas;
* scripts SQL para apoio à performance;
* configuração por variáveis de ambiente;
* deploy em ambiente Azure;
* documentação básica para execução local e publicação.

## Estrutura do projeto

```text
portal-do-acordo-frontend/
  Aplicação web do dashboard.

portal-do-acordo-backend/
  API de dados, cache da base ativa e rotas de apoio.

portal-do-acordo-backend/database/indexes.sql
  Índices sugeridos para otimizar consultas.

docs/azure-deploy.md
  Anotações do processo de publicação na Azure.
```

## Rodando localmente

### Backend

```powershell
cd .\portal-do-acordo-backend
npm run dev
```

### Frontend

```powershell
cd .\portal-do-acordo-frontend
npm run dev
```

## Rodando na rede interna

Para disponibilizar o dashboard para outros computadores da mesma rede:

### Backend

```powershell
cd .\portal-do-acordo-backend
npm run dev:lan
```

### Frontend

```powershell
cd .\portal-do-acordo-frontend
npm run dev:lan
```

Depois, acesse pelo IP da máquina que está hospedando:

```text
http://IP-DO-COMPUTADOR:5173
```

Para descobrir o IP no Windows:

```powershell
ipconfig
```

Use o IPv4 da placa conectada à rede da empresa.

## Variáveis de ambiente

O projeto usa arquivos de exemplo como base para configuração:

```text
portal-do-acordo-backend/.env.example
portal-do-acordo-frontend/.env.production.example
```

Nunca envie arquivos `.env` reais para o GitHub.

As variáveis de produção devem ser configuradas diretamente no ambiente de hospedagem.

## Cache da base ativa

A aba de bases utiliza um cache local em JSON para evitar que a consulta principal seja executada a cada acesso.

Arquivo padrão:

```text
portal-do-acordo-backend/data/base_ativa_cache.json
```

Com o backend ligado, o cache é atualizado automaticamente uma vez por dia, no horário definido pela variável:

```text
ACTIVE_BASE_REFRESH_HOUR
```

Também é possível disparar a atualização manualmente:

```powershell
Invoke-WebRequest -Method Post http://localhost:3001/api/base-ativa/refresh
```

## Banco de dados

O projeto possui scripts SQL de apoio para melhorar o desempenho de consultas utilizadas pelo relatório.

Arquivo:

```text
portal-do-acordo-backend/database/indexes.sql
```

Esses índices foram pensados para reduzir o custo de consultas recorrentes e melhorar o tempo de resposta do dashboard.

## Deploy na Azure

O processo de publicação está documentado em:

```text
docs/azure-deploy.md
```

Ambiente utilizado:

* Frontend: Azure Static Web Apps;
* Backend: Azure App Service;
* Domínio: `relatorio.portaldoacordo.com.br`;
* Configurações sensíveis via variáveis de ambiente;
* Repositório versionado no GitHub.

Observação: no plano gratuito do Azure App Service, domínio próprio para o backend possui limitações. Para usar um subdomínio próprio na API, é necessário migrar para um plano compatível.

## Tecnologias utilizadas

* SQL/PostgreSQL
* Azure Static Web Apps
* Azure App Service
* GitHub
* API backend para consulta de dados
* Dashboard web
* Cache local em JSON
* Scripts SQL para otimização

## Status

Projeto em uso e em evolução.
