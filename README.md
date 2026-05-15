# Portal do Acordo

Projeto do Portal do Acordo com frontend Vite/React e backend Node/Express.

## Estrutura

- `portal-do-acordo-frontend/`: aplicação web do relatório.
- `portal-do-acordo-backend/`: API de dados do Portal do Acordo.
- `ngrok.exe`: binário local usado para compartilhar o ambiente de desenvolvimento quando necessário.

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

Use o IPv4 da placa conectada na rede da empresa.

## Otimização do banco

Os índices sugeridos para acelerar os relatórios ficam em:

```text
portal-do-acordo-backend/database/indexes.sql
```

Execute esse script em cada banco do Portal do Acordo. Ele usa `CREATE INDEX CONCURRENTLY`, então não deve ser executado dentro de uma transação manual.
