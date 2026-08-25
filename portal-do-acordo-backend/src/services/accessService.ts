Você tem acesso ao caminho:

C:\Users\matheus.kowalski\Desktop\relatorio\portal-do-acordo-backend\src

Não altere nada nesse projeto. Use apenas como referência/leitura.

Objetivo:
Mapear as queries e services existentes do Portal do Acordo para ajudar a construir a nova tela "Banco / Operação > Processos" no projeto:

C:\Users\matheus.kowalski\Desktop\Disparador\mautic-poc\plugins\KowalskiBundle

Quero que você analise principalmente:
- src/routes/
- src/services/
- src/db/
- src/utils/
- qualquer arquivo que contenha SQL bruto
- qualquer uso de Prisma, $queryRawUnsafe, mssql ou conexão com bancos
- queries relacionadas a processos, devedores, credores, títulos, acordos, baixas, acessos, e-mails, telefones, faixas de atraso, valor em aberto, negociador, fase, situação e grupo

Não altere nenhum arquivo.

Me entregue:

1. Lista dos arquivos mais importantes encontrados no Portal do Acordo
   - caminho do arquivo
   - o que ele faz
   - quais tabelas usa
   - quais campos importantes aparecem

2. Mapeamento das tabelas do CRM/Cubo
   Quero uma tabela com:
   - tabela
   - finalidade
   - campos úteis
   - onde apareceu no código

3. Queries que podem ser reaproveitadas
   Especialmente para:
   - listar processos ativos
   - filtrar por grupo/credor
   - calcular valor em aberto
   - calcular faixa de atraso
   - buscar e-mail
   - buscar telefone, se existir
   - buscar status/fase/situação do processo
   - buscar negociador/equipe
   - filtrar títulos em aberto
   - buscar processos distribuídos ou não distribuídos

4. Recomende uma query base para a tela:
   "Banco / Operação > Processos"

Essa query deve retornar, se possível:
- processo
- idempresa
- idcredor
- grupo
- credor
- devedor_nome
- documento
- email_principal
- telefone_principal, se existir
- valor_aberto_total
- vencimento_mais_antigo
- faixa_atraso
- status_processo
- fase
- negociador
- equipe, se existir
- possui_titulo_aberto
- data_cadastro
- data_ultima_atualizacao

5. Compare essa query com a staging atual do mautic-poc:
- cubo_processos_ativos_snapshot
- regua_processos_trabalho
- regua_envios_controle
- regua_bloqueios

Diga:
- quais campos já existem na staging;
- quais campos estão faltando;
- quais campos deveriam ser adicionados no sync futuramente;
- se a tela deve consultar a staging ou o banco original do Portal.

6. Recomende a melhor arquitetura:
- plugin Mautic lendo staging PostgreSQL;
- plugin Mautic lendo Cubo direto;
- serviço intermediário;
- reaproveitar sync para enriquecer staging.

7. Próximo passo técnico recomendado.

Importante:
- Não copiar senhas, tokens ou dados sensíveis.
- Não exibir valores reais de clientes se aparecerem.
- Não alterar arquivos.
- Não criar código ainda.
- Apenas analisar e explicar.import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import { addSqlParam, buildExcludedDashboardAccessFilter, buildExcludedDashboardCreditorFilter, buildNullableExcludedDashboardCreditorFilter, buildSqlInFilter, getPeriodRange, NEGOTIATORS, ReportFilter } from '../utils/reportFilters';

type AcessoRow = {
  id: number | string;
  idempresa: number | string;
  data: Date | string;
  hora: number | string | null;
  credor: string | null;
  processo: number | string;
  situacao: 'COM ACORDO' | 'SEM ACORDO';
};

async function queryAccesses(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const periodo = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, periodo.start, periodo.end];
  const hasCreditorFilter = (filter.credores ?? []).some((credor) => credor.trim());

  if (!hasCreditorFilter) {
    const query = `
      SELECT
          a.id, a.idempresa, a.data_cad::date AS data,
          CASE
            WHEN TRIM(COALESCE(a.hora_cad, '')) ~ '^[0-9]{1,2}'
            THEN LEAST(SUBSTRING(TRIM(a.hora_cad) FROM '^[0-9]{1,2}')::int, 23)
            ELSE 0
          END AS hora,
          TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
          a.processo,
          CASE
              WHEN ac_status.id IS NOT NULL THEN 'COM ACORDO'
              ELSE 'SEM ACORDO'
          END AS situacao
      FROM tb_portal_neg_acessos a
      LEFT JOIN tb_acordo ac_credor ON ac_credor.id = a.idacordo
          AND ac_credor.idempresa = a.idempresa
      LEFT JOIN tb_credor c ON c.id = ac_credor.idcredor
      LEFT JOIN tb_acordo ac_status ON ac_status.processo = a.processo
          AND ac_status.idempresa = a.idempresa
          AND ac_status.status = 'ANDAMENTO'
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${buildNullableExcludedDashboardCreditorFilter('ac_credor.idcredor')}
        ${buildExcludedDashboardAccessFilter('a')}
      ORDER BY a.data_cad DESC
    `;

    return prisma.$queryRawUnsafe<AcessoRow[]>(query, ...params);
  }

  const negociadores = NEGOTIATORS.map((negociador) => addSqlParam(params, negociador)).join(', ');
  const credorFilter = buildSqlInFilter("TRIM(COALESCE(b.credor, 'OUTROS'))", filter.credores, params);

  const query = `
    SELECT
        a.id, a.idempresa, a.data_cad::date AS data,
        CASE
          WHEN TRIM(COALESCE(a.hora_cad, '')) ~ '^[0-9]{1,2}'
          THEN LEAST(SUBSTRING(TRIM(a.hora_cad) FROM '^[0-9]{1,2}')::int, 23)
          ELSE 0
        END AS hora,
        TRIM(COALESCE(b.credor, 'OUTROS')) AS credor,
        a.processo,
        CASE
            WHEN ac.id IS NOT NULL THEN 'COM ACORDO'
            ELSE 'SEM ACORDO'
        END AS situacao
    FROM tb_portal_neg_acessos a
    LEFT JOIN (
        SELECT DISTINCT tb_baixas.processo, tb_baixas.idempresa,
               TRIM(COALESCE(tb_credor.grupo, 'OUTROS')) AS credor
        FROM tb_baixas
        LEFT JOIN tb_credor ON tb_credor.id = tb_baixas.idcredor
        WHERE tb_baixas.idempresa = $1
          AND tb_baixas.totalpago > 0
          AND tb_baixas.databaixa >= $2
          AND tb_baixas.databaixa < $3
          AND tb_baixas.negociador IN (${negociadores})
          AND tb_baixas.idcredor IS NOT NULL
          ${buildExcludedDashboardCreditorFilter('tb_baixas.idcredor')}
          AND TRIM(COALESCE(tb_credor.grupo, '')) != ''
    ) b ON b.processo = a.processo AND b.idempresa = a.idempresa
    LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
    WHERE a.idempresa = $1
      AND a.data_cad >= $2
      AND a.data_cad < $3
      ${buildExcludedDashboardAccessFilter('a')}
      ${credorFilter}
    ORDER BY a.data_cad DESC
  `;

  return prisma.$queryRawUnsafe<AcessoRow[]>(query, ...params);
}

export async function getAccesses(filter: ReportFilter) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryAccesses(prisma, empresaId, filter)))
  );
  const allData = results.flat();

  return {
    data: allData.map(row => ({
      id: String(row.id),
      processo: String(row.processo),
      data: row.data instanceof Date ? row.data.toISOString().slice(0, 10) : String(row.data).slice(0, 10),
      hora: Number(row.hora ?? 0),
      sistema: Number(row.idempresa) === 401 ? 'consulth' : 'sisth',
      idempresa: Number(row.idempresa),
      credor: row.credor ? String(row.credor) : null,
      situacao: String(row.situacao) as 'COM ACORDO' | 'SEM ACORDO',
    }))
  };
}



