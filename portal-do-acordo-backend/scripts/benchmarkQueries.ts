import { promises as fs } from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import sql from 'mssql';

type SystemFilter = 'consulth' | 'sisth' | 'total';
type BenchmarkBlock =
  | 'postgresql-principal'
  | 'comunicacao-postgresql'
  | 'azure-sql-cliques'
  | 'comunicacao-azure-sql'
  | 'comunicacao-hibrida-legado'
  | 'base-ativa-refresh'
  | 'fora-do-benchmark';
type BenchmarkContext = {
  block: BenchmarkBlock;
  workload: string;
  system: SystemFilter;
};
type QuerySample = {
  block: BenchmarkBlock;
  engine: 'postgresql' | 'azure-sql';
  workload: string;
  system: SystemFilter;
  companyId?: number;
  label: string;
  durationMs: number;
  rows?: number;
  range?: string;
  success: boolean;
  error?: string;
};
type WorkloadSample = {
  block: BenchmarkBlock;
  workload: string;
  system: SystemFilter;
  durationMs: number;
  queries: number;
  success: boolean;
  error?: string;
};
type BlockSample = {
  block: BenchmarkBlock;
  status: 'ok' | 'failed' | 'skipped';
  durationMs: number;
  workloads: number;
  external: boolean;
  error?: string;
};

const period = process.env.BENCHMARK_PERIOD ?? '2026-05';
const system: SystemFilter = 'total';
const activeBaseRefreshOnly = process.argv.includes('--active-base-refresh');
const querySamples: QuerySample[] = [];
const workloadSamples: WorkloadSample[] = [];
const blockSamples: BlockSample[] = [];
const companyByClient = new WeakMap<object, number>();
const benchmarkContexts = new AsyncLocalStorage<BenchmarkContext>();
const activeDatabaseQueries = new Set<Promise<unknown>>();
let currentBlock: BenchmarkBlock = 'fora-do-benchmark';
const requestedWorkloads = new Set(
  (process.argv.find((argument) => argument.startsWith('--workload='))?.slice('--workload='.length) ?? '')
    .split(',')
    .map((workload) => workload.trim())
    .filter(Boolean)
);
const requestedBlocks = new Set(
  (process.argv.find((argument) => argument.startsWith('--block='))?.slice('--block='.length) ?? '')
    .split(',')
    .map((block) => block.trim())
    .filter(Boolean)
);

function elapsedSince(start: number) {
  return Math.round((performance.now() - start) * 100) / 100;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function rowCount(result: unknown) {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object' && 'recordset' in result && Array.isArray(result.recordset)) {
    return result.recordset.length;
  }
  return undefined;
}

function queryRange(args: unknown[]) {
  const dates = args.filter((value): value is Date => value instanceof Date);
  return dates.length >= 2 ? `${dates[0].toISOString().slice(0, 10)}..${dates[1].toISOString().slice(0, 10)}` : undefined;
}

function shouldRun(workload: string) {
  return requestedWorkloads.size === 0 || requestedWorkloads.has(workload);
}

function shouldRunBlock(block: BenchmarkBlock) {
  return requestedBlocks.size === 0 || requestedBlocks.has(block);
}

async function waitForDatabaseQueries() {
  while (true) {
    await Promise.allSettled(Array.from(activeDatabaseQueries));
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (activeDatabaseQueries.size === 0) return;
  }
}

function normalized(query: string) {
  return query.replace(/\s+/g, ' ').trim().toLowerCase();
}

function postgresLabel(workload: string, query: string) {
  const text = normalized(query);

  if (text.startsWith('set local statement_timeout')) return 'configurar-timeout';
  if (text.includes('with active_processes as')) return 'base-ativa-aging-lote';
  if (text.includes('select count(*)::bigint as total from ( select distinct d.processo')) return 'base-ativa-aging-total';
  if (text.includes('count(*)::bigint as processos') && text.includes('from tb_devedor d')) return 'base-ativa-por-credor';
  if (workload === 'periodos') return 'periodos-disponiveis';
  if (workload === 'credores') return 'credores-disponiveis';
  if (workload === 'baixas') return 'baixas-listagem';
  if (workload === 'acordos') return 'acordos-listagem';
  if (workload === 'acessos') return 'acessos-listagem';
  if (workload === 'custos') return text.includes('from tb_baixas') ? 'custos-baixas' : 'custos-acordos';
  if (workload === 'comunicacao') {
    if (text.includes('from portal_email_envios_mensal') || text.includes('from portal_email_envios_dashboard')) {
      return text.includes('group by m.mes') ? 'comunicacao-email-mensal-auxiliar' : 'comunicacao-email-por-credor-auxiliar';
    }
    if (text.includes("date_trunc('month'")) return 'comunicacao-email-mensal';
    if (text.includes('e.data::date as data')) return 'comunicacao-email-diario';
    return 'comunicacao-email-por-credor';
  }
  if (workload === 'carteiras') return 'carteiras-listagem';
  if (workload === 'bases-resumo') {
    if (text.includes('with normalized as')) return 'bases-carteiras-resumo';
    if (text.includes('from tb_baixas')) return 'bases-baixas-resumo';
    return 'bases-acordos-resumo';
  }
  if (workload === 'dashboard-resultados-resumo') {
    if (text.includes('from tb_portal_neg_acessos a')) return 'resultados-resumo-acessos';
    if (text.includes('from tb_baixas')) return 'resultados-resumo-baixas';
    if (text.includes('from tb_acordo')) return 'resultados-resumo-acordos';
    return 'resultados-resumo-outra';
  }
  if (workload === 'dashboard-resultados-graficos') return dashboardResultGraphsLabel(text);
  if (workload.startsWith('dashboard-performance-')) return dashboardPerformanceLabel(text);
  if (workload === 'dashboard-comunicacao-resumo') {
    return text.includes('group by e.data::date') ? 'dashboard-comunicacao-email-diario' : 'dashboard-comunicacao-email-por-credor';
  }
  return 'consulta-postgresql';
}

function dashboardResultGraphsLabel(text: string) {
  if (text.includes('count(distinct b.processo)::bigint as total')) return 'resultados-graficos-pagos-total';
  if (text.includes('count(*)::bigint as total') && text.includes('from tb_acordo')) return 'resultados-graficos-acordos-total';
  if (text.includes('count(distinct a.id_portal_neg)::bigint as negociacoes')) return 'resultados-graficos-funil-acessos';
  if (text.includes('as capital') && text.includes('as juros')) return 'resultados-graficos-componentes';
  if (text.includes('b.databaixa::date as dia')) return 'resultados-graficos-baixas-dia';
  if (text.includes('ac.data_acordo::date as dia')) return 'resultados-graficos-acordos-dia';
  if (text.includes('a.data_cad::date as dia')) return 'resultados-graficos-acessos-dia';
  if (text.includes('as hora') && text.includes('from tb_acordo')) return 'resultados-graficos-acordos-hora';
  if (text.includes('as credor') && text.includes('from tb_baixas')) return 'resultados-graficos-baixas-credor';
  if (text.includes('as credor') && text.includes('from tb_acordo')) return 'resultados-graficos-acordos-credor';
  if (text.includes('as negociador') && text.includes('from tb_baixas')) return 'resultados-graficos-baixas-negociador';
  if (text.includes('as negociador') && text.includes('from tb_acordo')) return 'resultados-graficos-acordos-negociador';
  return 'resultados-graficos-outra';
}

function dashboardPerformanceLabel(text: string) {
  if (text.includes('as "acessoscomacordo"')) return 'performance-metricas-acessos';
  if (text.includes('as recuperado') && text.includes('as pagos') && !text.includes('group by')) return 'performance-metricas-baixas';
  if (text.includes('count(*)::bigint as acordos') && !text.includes('group by')) return 'performance-metricas-acordos';
  if (text.includes("date_trunc('month', b.databaixa)")) return 'performance-baixas-mes';
  if (text.includes("date_trunc('month', ac.data_acordo)")) return 'performance-acordos-mes';
  if (text.includes("date_trunc('month', a.data_cad)")) return 'performance-acessos-mes';
  if (text.includes('b.databaixa::date as dia')) return 'performance-baixas-dia';
  if (text.includes('ac.data_acordo::date as dia')) return 'performance-acordos-dia';
  if (text.includes('a.data_cad::date as dia')) return 'performance-acessos-dia';
  if (text.includes('as negociador') && text.includes('from tb_portal_neg_acessos')) return 'performance-acessos-negociador';
  if (text.includes('as hora') && text.includes('from tb_portal_neg_acessos')) return 'performance-acessos-hora';
  if (text.includes('as hora') && text.includes('from tb_acordo')) return 'performance-acordos-hora';
  if (text.includes('as negociador') && text.includes('from tb_acordo')) return 'performance-acordos-negociador';
  if (text.includes('as negociador') && text.includes('from tb_baixas')) return 'performance-baixas-negociador';
  return 'performance-outra';
}

function azureSqlLabel(workload: string, query: string) {
  const text = normalized(query);
  if (text.includes('from email_eventos_mailgrid')) return 'mailgrid-eventos-resumo';
  if (text.includes('group by convert(date, c.data_clique)')) return 'mailgrid-cliques-dia';
  if (text.includes('select top 25')) return 'mailgrid-cliques-recentes';
  if (text.includes('from cliques')) return 'mailgrid-cliques-resumo';
  return `${workload}-azure-sql`;
}

function recordQuery(sample: QuerySample) {
  querySamples.push(sample);
  const company = sample.companyId ? ` empresa=${sample.companyId}` : '';
  const range = sample.range ? ` periodo=${sample.range}` : '';
  const status = sample.success ? '' : ` erro=${sample.error}`;
  console.log(`  SQL ${sample.engine} ${sample.label}${company}${range}: ${sample.durationMs.toFixed(2)} ms${status}`);
}

function installPostgresInstrumentation() {
  const prototype = PrismaClient.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const originalQuery = prototype.$queryRawUnsafe;
  const originalExecute = prototype.$executeRawUnsafe;

  prototype.$queryRawUnsafe = async function (...args: unknown[]) {
    const start = performance.now();
    const context = benchmarkContexts.getStore() ?? { block: currentBlock, workload: 'fora-do-benchmark', system };
    const query = String(args[0] ?? '');
    const pending = originalQuery.apply(this, args);
    activeDatabaseQueries.add(pending);
    try {
      const result = await pending;
      recordQuery({
        block: context.block,
        engine: 'postgresql',
        workload: context.workload,
        system: context.system,
        companyId: companyByClient.get(this),
        label: postgresLabel(context.workload, query),
        durationMs: elapsedSince(start),
        rows: rowCount(result),
        range: queryRange(args),
        success: true,
      });
      return result;
    } catch (error) {
      recordQuery({
        block: context.block,
        engine: 'postgresql',
        workload: context.workload,
        system: context.system,
        companyId: companyByClient.get(this),
        label: postgresLabel(context.workload, query),
        durationMs: elapsedSince(start),
        range: queryRange(args),
        success: false,
        error: formatError(error),
      });
      throw error;
    } finally {
      activeDatabaseQueries.delete(pending);
    }
  };

  prototype.$executeRawUnsafe = async function (...args: unknown[]) {
    const start = performance.now();
    const context = benchmarkContexts.getStore() ?? { block: currentBlock, workload: 'fora-do-benchmark', system };
    const query = String(args[0] ?? '');
    const pending = originalExecute.apply(this, args);
    activeDatabaseQueries.add(pending);
    try {
      const result = await pending;
      recordQuery({
        block: context.block,
        engine: 'postgresql',
        workload: context.workload,
        system: context.system,
        companyId: companyByClient.get(this),
        label: postgresLabel(context.workload, query),
        durationMs: elapsedSince(start),
        success: true,
      });
      return result;
    } catch (error) {
      recordQuery({
        block: context.block,
        engine: 'postgresql',
        workload: context.workload,
        system: context.system,
        companyId: companyByClient.get(this),
        label: postgresLabel(context.workload, query),
        durationMs: elapsedSince(start),
        success: false,
        error: formatError(error),
      });
      throw error;
    } finally {
      activeDatabaseQueries.delete(pending);
    }
  };
}

function installAzureSqlInstrumentation() {
  const prototype = sql.Request.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = prototype.query;

  prototype.query = async function (...args: unknown[]) {
    const start = performance.now();
    const context = benchmarkContexts.getStore() ?? { block: currentBlock, workload: 'fora-do-benchmark', system };
    const query = String(args[0] ?? '');
    const pending = original.apply(this, args);
    activeDatabaseQueries.add(pending);
    try {
      const result = await pending;
      recordQuery({
        block: context.block,
        engine: 'azure-sql',
        workload: context.workload,
        system: context.system,
        label: azureSqlLabel(context.workload, query),
        durationMs: elapsedSince(start),
        rows: rowCount(result),
        success: true,
      });
      return result;
    } catch (error) {
      recordQuery({
        block: context.block,
        engine: 'azure-sql',
        workload: context.workload,
        system: context.system,
        label: azureSqlLabel(context.workload, query),
        durationMs: elapsedSince(start),
        success: false,
        error: formatError(error),
      });
      throw error;
    } finally {
      activeDatabaseQueries.delete(pending);
    }
  };
}

async function runWorkload(workload: string, operation: () => Promise<unknown>) {
  if (!shouldRun(workload)) return;
  console.log(`\n[${workload}]`);
  const queryStart = querySamples.length;
  const start = performance.now();
  try {
    await benchmarkContexts.run({ block: currentBlock, workload, system }, operation);
    const durationMs = elapsedSince(start);
    workloadSamples.push({ block: currentBlock, workload, system, durationMs, queries: querySamples.length - queryStart, success: true });
    console.log(`TOTAL ${workload}: ${durationMs.toFixed(2)} ms`);
  } catch (error) {
    const durationMs = elapsedSince(start);
    const message = formatError(error);
    workloadSamples.push({ block: currentBlock, workload, system, durationMs, queries: querySamples.length - queryStart, success: false, error: message });
    console.log(`ERRO ${workload}: ${durationMs.toFixed(2)} ms - ${message}`);
  } finally {
    await waitForDatabaseQueries();
  }
}

async function runBlock(block: BenchmarkBlock, external: boolean, operation: () => Promise<void>) {
  if (!shouldRunBlock(block)) return;
  console.log(`\n=== BLOCO ${block} ===`);
  const workloadStart = workloadSamples.length;
  const start = performance.now();
  const previousBlock = currentBlock;
  currentBlock = block;

  try {
    await operation();
    await waitForDatabaseQueries();
    const workloads = workloadSamples.slice(workloadStart);
    const failure = workloads.find((sample) => !sample.success);
    const durationMs = elapsedSince(start);
    blockSamples.push({
      block,
      status: failure ? 'failed' : 'ok',
      durationMs,
      workloads: workloads.length,
      external,
      error: failure?.error,
    });
  } catch (error) {
    const message = formatError(error);
    blockSamples.push({
      block,
      status: 'failed',
      durationMs: elapsedSince(start),
      workloads: workloadSamples.length - workloadStart,
      external,
      error: message,
    });
    console.log(`ERRO BLOCO ${block}: ${message}`);
  } finally {
    currentBlock = previousBlock;
  }
}

function skipBlock(block: BenchmarkBlock, external: boolean, reason: string) {
  if (!shouldRunBlock(block)) return;
  blockSamples.push({ block, status: 'skipped', durationMs: 0, workloads: 0, external, error: reason });
  console.log(`\n=== BLOCO ${block} ===`);
  console.log(`IGNORADO: ${reason}`);
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function aggregateQueries() {
  const groups = new Map<string, QuerySample[]>();
  querySamples.forEach((sample) => {
    const key = [sample.block, sample.engine, sample.companyId ?? 'n/a', sample.label].join('|');
    const rows = groups.get(key) ?? [];
    rows.push(sample);
    groups.set(key, rows);
  });

  return Array.from(groups.values())
    .map((samples) => ({
      block: samples[0].block,
      engine: samples[0].engine,
      companyId: samples[0].companyId,
      label: samples[0].label,
      executions: samples.length,
      totalMs: Math.round(samples.reduce((sum, sample) => sum + sample.durationMs, 0) * 100) / 100,
      minMs: Math.min(...samples.map((sample) => sample.durationMs)),
      medianMs: percentile(samples.map((sample) => sample.durationMs), 0.5),
      maxMs: Math.max(...samples.map((sample) => sample.durationMs)),
      failures: samples.filter((sample) => !sample.success).length,
    }))
    .sort((a, b) => b.maxMs - a.maxMs);
}

async function saveReport() {
  const generatedAt = new Date().toISOString();
  const output = path.resolve(process.cwd(), 'data', `query-benchmark-${generatedAt.replace(/[:.]/g, '-')}.json`);
  const report = {
    generatedAt,
    reportPath: output,
    period,
    system,
    mode: activeBaseRefreshOnly ? 'active-base-refresh' : 'site-read-routes',
    blocks: blockSamples,
    workloads: workloadSamples,
    queryAggregates: aggregateQueries(),
    queries: querySamples,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nRelatorio salvo em ${output}`);
  return report;
}

async function main() {
  installPostgresInstrumentation();
  installAzureSqlInstrumentation();

  if (activeBaseRefreshOnly) {
    process.env.ACTIVE_BASE_CACHE_FILE = path.resolve(process.cwd(), 'data', 'benchmark-base-ativa-cache.json');
  }

  const [{ getLiveClients }, activeBase] = await Promise.all([
    import('../src/db/prismaClients'),
    import('../src/services/activeBaseService'),
  ]);
  const clients = getLiveClients('total');
  clients.forEach(({ empresaId, prisma }) => companyByClient.set(prisma, empresaId));

  if (activeBaseRefreshOnly) {
    await runBlock('base-ativa-refresh', false, async () => {
      await runWorkload('base-ativa-refresh', async () => {
        const cache = await activeBase.refreshActiveBaseCache();
        if (cache.status === 'error') throw new Error(cache.error ?? 'Atualizacao da Base Ativa falhou.');
      });
    });
  } else {
    const [
      { getPeriods },
      { getCreditors },
      { getPayments },
      { getAgreements },
      { getAccesses },
      { getCosts },
      { getCommunication },
      { getPortfolio },
      { getBaseSummary },
      { getDashboardResultSummary },
      { getDashboardResultGraphs },
      { getDashboardPerformanceSummary, getDashboardPerformanceGraphs },
      { getDashboardCommunicationSummary },
      { getEmailClickReport },
    ] = await Promise.all([
      import('../src/services/periodService'),
      import('../src/services/creditorService'),
      import('../src/services/paymentService'),
      import('../src/services/agreementService'),
      import('../src/services/accessService'),
      import('../src/services/costService'),
      import('../src/services/communicationService'),
      import('../src/services/portfolioService'),
      import('../src/services/baseSummaryService'),
      import('../src/services/dashboardSummaryService'),
      import('../src/services/dashboardResultGraphsService'),
      import('../src/services/dashboardPerformanceService'),
      import('../src/services/dashboardCommunicationService'),
      import('../src/routes/emailTrackingRoutes'),
    ]);
    const baseFilter = { periodo: period, sistema: system, credores: [] as string[] };
    const portfolioFilter = { ...baseFilter, periodos: [period] };
    const dashboardFilter = { ...baseFilter, negociador: undefined };

    await runBlock('postgresql-principal', false, async () => {
      await runWorkload('periodos', () => getPeriods({ sistema: system }));
      await runWorkload('credores', () => getCreditors(baseFilter));
      await runWorkload('baixas', () => getPayments(baseFilter));
      await runWorkload('acordos', () => getAgreements(baseFilter));
      await runWorkload('acessos', () => getAccesses(baseFilter));
      await runWorkload('custos', () => getCosts(baseFilter));
      await runWorkload('carteiras', () => getPortfolio(portfolioFilter));
      await runWorkload('base-ativa-cache', () => activeBase.getActiveBase(baseFilter));
      await runWorkload('bases-resumo', () => getBaseSummary(portfolioFilter));
      await runWorkload('dashboard-resultados-resumo', () => getDashboardResultSummary(baseFilter));
      await runWorkload('dashboard-resultados-graficos', () => getDashboardResultGraphs(dashboardFilter));
      await runWorkload('dashboard-performance-resumo', () => getDashboardPerformanceSummary(dashboardFilter));
      await runWorkload('dashboard-performance-graficos', () => getDashboardPerformanceGraphs(dashboardFilter));
    });
    await runBlock('comunicacao-postgresql', false, async () => {
      await runWorkload('comunicacao', () => getCommunication({ ...baseFilter, diario: false }));
    });
    await runBlock('azure-sql-cliques', true, async () => {
      await runWorkload('mailgrid-cliques', () => getEmailClickReport(baseFilter));
    });
    skipBlock('comunicacao-azure-sql', true, 'Nao existe carga Azure isolada para comunicacao. O endpoint legado combina PostgreSQL e Azure SQL e nao e consumido pelo frontend atual.');
    if (requestedWorkloads.has('dashboard-comunicacao-resumo')) {
      await runBlock('comunicacao-hibrida-legado', true, async () => {
        await runWorkload('dashboard-comunicacao-resumo', () => getDashboardCommunicationSummary(dashboardFilter));
      });
    }
  }

  await waitForDatabaseQueries();
  const report = await saveReport();
  await Promise.all(clients.map(({ prisma }) => prisma.$disconnect()));
  const { disconnectEmailMonthlyAggregateClient } = await import('../src/db/emailMonthlyAggregateClient');
  await disconnectEmailMonthlyAggregateClient();

  console.log('\nConsultas mais lentas:');
  report.queryAggregates.slice(0, 15).forEach((row) => {
    const company = row.companyId ? ` empresa=${row.companyId}` : '';
    console.log(`${row.maxMs.toFixed(2)} ms | ${row.block} | ${row.engine}${company} | ${row.label} | execucoes=${row.executions}`);
  });

  console.log('\nResumo por bloco:');
  report.blocks.forEach((block) => {
    const error = block.error ? ` | erro=${block.error}` : '';
    console.log(`${block.block} | status=${block.status} | tempo=${block.durationMs.toFixed(2)} ms | externo=${block.external ? 'sim' : 'nao'}${error}`);
  });
  console.log(`JSON salvo em: ${report.reportPath}`);

  const hasBlockingFailures = blockSamples.some((block) => block.status === 'failed' && !block.external);
  process.exit(hasBlockingFailures ? 1 : 0);
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
