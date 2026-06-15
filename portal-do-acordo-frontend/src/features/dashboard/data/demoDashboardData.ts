import type {
  ActiveBaseReport,
  BaseSummaryReport,
  CommunicationData,
  CostsData,
  DashboardData,
  PortfolioEntry,
  SystemFilter,
} from '../types';
import { isNoCreditorSelection } from '../utils/creditors';
import { monthKey, previousPeriod } from '../utils/dates';
import type { WhatsappCampaignPeriodData } from './whatsappCampaigns';

type ConcreteSystem = Exclude<SystemFilter, 'total'>;

type DemoCreditor = {
  credor: string;
  sistema: ConcreteSystem;
  idempresa: number;
  idcredor: number;
  avgTicket: number;
  weight: number;
};

export const DEMO_PRIMARY_PERIOD = '2026-05';

const DEMO_PERIODS = ['2026-05', '2026-04', '2026-03'];

const DEMO_CREDITORS: DemoCreditor[] = [
  { credor: 'ALFA VAREJO', sistema: 'consulth', idempresa: 401, idcredor: 9101, avgTicket: 2850, weight: 1.28 },
  { credor: 'ORION ALIMENTOS', sistema: 'consulth', idempresa: 401, idcredor: 9102, avgTicket: 3350, weight: 1.1 },
  { credor: 'NOVA ENERGIA', sistema: 'consulth', idempresa: 401, idcredor: 9103, avgTicket: 2450, weight: 0.96 },
  { credor: 'ATLAS SERVICOS', sistema: 'consulth', idempresa: 401, idcredor: 9104, avgTicket: 4100, weight: 0.82 },
  { credor: 'BRAVA SAUDE', sistema: 'sisth', idempresa: 1007, idcredor: 9201, avgTicket: 1980, weight: 1.34 },
  { credor: 'PLURAL BENEFICIOS', sistema: 'sisth', idempresa: 1007, idcredor: 9202, avgTicket: 2240, weight: 1.18 },
  { credor: 'VERTEX TELECOM', sistema: 'sisth', idempresa: 1007, idcredor: 9203, avgTicket: 3120, weight: 1.02 },
  { credor: 'SENTINELA LOGISTICA', sistema: 'sisth', idempresa: 1007, idcredor: 9204, avgTicket: 2680, weight: 0.88 },
];

const BUSINESS_DATES_BY_PERIOD: Record<string, string[]> = {
  '2026-05': [
    '2026-05-04',
    '2026-05-05',
    '2026-05-06',
    '2026-05-07',
    '2026-05-08',
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
    '2026-05-15',
    '2026-05-18',
    '2026-05-19',
    '2026-05-20',
  ],
  '2026-04': [
    '2026-04-01',
    '2026-04-02',
    '2026-04-03',
    '2026-04-06',
    '2026-04-07',
    '2026-04-08',
    '2026-04-09',
    '2026-04-10',
    '2026-04-13',
    '2026-04-14',
    '2026-04-15',
    '2026-04-16',
    '2026-04-17',
    '2026-04-20',
    '2026-04-22',
    '2026-04-23',
    '2026-04-24',
    '2026-04-27',
    '2026-04-28',
    '2026-04-29',
  ],
  '2026-03': [
    '2026-03-02',
    '2026-03-03',
    '2026-03-04',
    '2026-03-05',
    '2026-03-06',
    '2026-03-09',
    '2026-03-10',
    '2026-03-11',
    '2026-03-12',
    '2026-03-13',
    '2026-03-16',
    '2026-03-17',
    '2026-03-18',
    '2026-03-19',
    '2026-03-20',
    '2026-03-23',
    '2026-03-24',
    '2026-03-25',
    '2026-03-26',
    '2026-03-27',
  ],
};

export const DEMO_DASHBOARD_DATA: DashboardData = buildDashboardData();
export const DEMO_WHATSAPP_CAMPAIGN_DATA: Record<string, WhatsappCampaignPeriodData> = buildWhatsappCampaigns();

export function isDemoMode() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('demo');
  return value === '1' || value === 'true';
}

export function getDemoCosts(periodo: string, sistema: SystemFilter): CostsData {
  const anteriorKey = previousPeriod(periodo);
  const acordosAtual = countAgreementsFor(periodo, sistema);
  const acordosAnterior = countAgreementsFor(anteriorKey, sistema);
  const whatsappCost = whatsappRowsFor(periodo, sistema, new Set<string>()).reduce((sum, row) => sum + row.custo, 0);
  const previousWhatsappCost = whatsappRowsFor(anteriorKey, sistema, new Set<string>()).reduce((sum, row) => sum + row.custo, 0);
  const emailCost = 932;
  const currentCost = whatsappCost + emailCost;
  const previousCost = previousWhatsappCost > 0 ? previousWhatsappCost + emailCost : 0;

  return {
    periodo,
    categories: [
      { name: 'WhatsApp', value: roundMoney(whatsappCost) },
      { name: 'E-mail', value: emailCost },
    ],
    evolution: DEMO_PERIODS.slice().reverse().map((mes) => ({
      mes,
      receita: totalPaidFor(mes, sistema),
      acordos: countAgreementsFor(mes, sistema),
    })),
    comparativo: {
      atual: currentCost,
      anterior: previousCost,
      variacao: previousCost > 0 ? ((currentCost - previousCost) / previousCost) * 100 : 0,
      acordos_atual: acordosAtual,
      acordos_anterior: acordosAnterior,
      custo_por_acordo: acordosAtual > 0 ? currentCost / acordosAtual : 0,
    },
  };
}

export function getDemoCommunication(periodo: string, sistema: SystemFilter, selectedCreditors: Set<string>): CommunicationData {
  const creditors = filterCreditors(sistema, selectedCreditors);
  const rows = creditors.map((creditor, index) => {
    const campaign = DEMO_WHATSAPP_CAMPAIGN_DATA[periodo]?.rows.find((row) => row.credor === creditor.credor);
    const emails = emailCountFor(periodo, creditor, index);
    const whatsapp = campaign?.envios ?? 0;
    return {
      credor: creditor.credor,
      qtde_emails: emails,
      mensagens_wati: whatsapp,
      custo_wati: roundMoney(whatsapp * 0.05),
    };
  });

  const totalEmails = rows.reduce((sum, row) => sum + row.qtde_emails, 0);
  const totalWhatsapp = rows.reduce((sum, row) => sum + row.mensagens_wati, 0);
  const fullCampaignTotal = DEMO_WHATSAPP_CAMPAIGN_DATA[periodo]?.summary.billable ?? totalWhatsapp;
  const whatsappScale = fullCampaignTotal > 0 ? totalWhatsapp / fullCampaignTotal : 0;
  const dates = BUSINESS_DATES_BY_PERIOD[periodo] ?? [];
  const dayWeights = dates.map((_, index) => 0.85 + ((index % 5) * 0.12));
  const totalDayWeight = dayWeights.reduce((sum, weight) => sum + weight, 0) || 1;

  return {
    envios: {
      emails: totalEmails,
      whatsapp: totalWhatsapp,
      custo_whatsapp: roundMoney(totalWhatsapp * 0.05),
    },
    por_credor: rows,
    mensal: DEMO_PERIODS.slice().reverse().map((mes) => {
      const periodRows = filterCreditors(sistema, selectedCreditors).map((creditor, index) => {
        const campaign = DEMO_WHATSAPP_CAMPAIGN_DATA[mes]?.rows.find((row) => row.credor === creditor.credor);
        return {
          emails: emailCountFor(mes, creditor, index),
          whatsapp: campaign?.envios ?? 0,
        };
      });

      return {
        mes,
        qtde_emails: periodRows.reduce((sum, row) => sum + row.emails, 0),
        mensagens_wati: periodRows.reduce((sum, row) => sum + row.whatsapp, 0),
      };
    }),
    diario: dates.map((date, index) => {
      const campaignDay = DEMO_WHATSAPP_CAMPAIGN_DATA[periodo]?.daily.find((row) => row.data === date);
      return {
        data: date,
        qtde_emails: Math.round((totalEmails * dayWeights[index]) / totalDayWeight),
        mensagens_wati: Math.round((campaignDay?.envios ?? 0) * whatsappScale),
      };
    }),
  };
}

export function getDemoActiveBase(sistema: SystemFilter, selectedCreditors: Set<string>): ActiveBaseReport {
  const byCredor = filterCreditors(sistema, selectedCreditors).map((creditor, index) => ({
    credor: creditor.credor,
    processos: Math.round(1420 * creditor.weight + index * 115),
  }));
  const total = byCredor.reduce((sum, row) => sum + row.processos, 0);
  const agingFactors = [
    { faixa: '0-30', factor: 0.12 },
    { faixa: '31-60', factor: 0.12 },
    { faixa: '61-90', factor: 0.12 },
    { faixa: '91-180', factor: 0.27 },
    { faixa: '181-360', factor: 0.22 },
    { faixa: '361+', factor: 0.15 },
    { faixa: 'SEM VENCIMENTO', factor: 0 },
  ];

  return {
    updated_at: '2026-05-21T08:00:00.000Z',
    aging_updated_at: '2026-05-21T08:15:00.000Z',
    status: 'ready',
    total_processos: total,
    total_credores: byCredor.length,
    aging_complete: true,
    by_credor: byCredor.sort((a, b) => b.processos - a.processos),
    aging: agingFactors.map((row) => ({ faixa: row.faixa, processos: Math.round(total * row.factor) })),
    aging_by_credor: byCredor.flatMap((credor) => agingFactors.map((row) => ({ credor: credor.credor, faixa: row.faixa, processos: Math.round(credor.processos * row.factor) }))),
  };
}

export function getDemoPortfolio(sistema: SystemFilter, selectedPeriods: Set<string>, selectedCreditors: Set<string>): PortfolioEntry[] {
  const periodList = selectedPeriods.size > 0 ? Array.from(selectedPeriods) : [DEMO_PRIMARY_PERIOD];
  const creditors = filterCreditors(sistema, selectedCreditors);

  return periodList.flatMap((periodo) => {
    const dates = BUSINESS_DATES_BY_PERIOD[periodo] ?? [];
    return creditors.flatMap((creditor, creditorIndex) => [0, 1].map((slice) => {
      const day = dates[(creditorIndex * 2 + slice * 5) % Math.max(dates.length, 1)] ?? `${periodo}-01`;
      const processos = Math.round((260 + creditorIndex * 18 + slice * 34) * creditor.weight);
      const titulos = Math.round(processos * (1.7 + (creditorIndex % 3) * 0.25));
      const valor = roundMoney(processos * creditor.avgTicket * (1.9 + slice * 0.28));

      return {
        id: `demo-portfolio-${periodo}-${creditor.idcredor}-${slice}`,
        sistema: creditor.sistema,
        idempresa: creditor.idempresa,
        codimp: `DM${periodo.replace('-', '')}${creditor.idcredor}${slice}`,
        data: day,
        mes: periodo,
        usuario_cad: slice === 0 ? 'DEMO.USER' : 'AUTO.DEMO',
        nomearquivo: `${creditor.credor.toLowerCase().replace(/\s+/g, '-')}-${periodo}.csv`,
        idcredor: creditor.idcredor,
        credor: creditor.credor,
        qtdetit: titulos,
        qtdeimp: titulos,
        qtdeproc: processos,
        qtdedup: Math.round(titulos * 0.025),
        valor_imp: valor,
      };
    }));
  });
}

export function getDemoBaseSummary(sistema: SystemFilter, selectedPeriods: Set<string>, selectedCreditors: Set<string>): BaseSummaryReport {
  const activeBase = getDemoActiveBase(sistema, selectedCreditors);
  const portfolio = getDemoPortfolio(sistema, selectedPeriods, selectedCreditors);
  const portfolioByCreditor = new Map<string, BaseSummaryReport['entrada_por_credor'][number]>();

  portfolio.forEach((row) => {
    const current = portfolioByCreditor.get(row.credor) ?? {
      credor: row.credor,
      borderos: 0,
      valorEntrada: 0,
      recuperado: 0,
      processos: 0,
      titulos: 0,
      importados: 0,
      duplicados: 0,
      acordos: 0,
      percentualRecuperado: 0,
      conversaoCarteira: 0,
    };
    current.borderos += 1;
    current.valorEntrada += row.valor_imp;
    current.processos += row.qtdeproc;
    current.titulos += row.qtdetit;
    current.importados += row.qtdeimp;
    current.duplicados += row.qtdedup;
    portfolioByCreditor.set(row.credor, current);
  });

  const entradaPorCredor = Array.from(portfolioByCreditor.values())
    .map((row, index) => {
      const recuperado = roundMoney(row.valorEntrada * (0.12 + (index % 4) * 0.018));
      const acordos = Math.round(row.processos * (0.018 + (index % 3) * 0.004));
      return {
        ...row,
        recuperado,
        acordos,
        percentualRecuperado: row.valorEntrada > 0 ? (recuperado / row.valorEntrada) * 100 : 0,
        conversaoCarteira: row.processos > 0 ? (acordos / row.processos) * 100 : 0,
      };
    })
    .sort((a, b) => b.valorEntrada - a.valorEntrada);

  const totalValorEntrada = entradaPorCredor.reduce((sum, row) => sum + row.valorEntrada, 0);
  const totalProcessosEntrada = entradaPorCredor.reduce((sum, row) => sum + row.processos, 0);
  const totalRecuperado = entradaPorCredor.reduce((sum, row) => sum + row.recuperado, 0);
  const totalAcordos = entradaPorCredor.reduce((sum, row) => sum + row.acordos, 0);
  const overallTicket = totalProcessosEntrada > 0 ? totalValorEntrada / totalProcessosEntrada : 0;
  const entryByCreditor = new Map(entradaPorCredor.map((row) => [row.credor, row]));
  const totalAgingByCreditor = new Map<string, number>();

  activeBase.aging_by_credor?.forEach((row) => {
    totalAgingByCreditor.set(row.credor, (totalAgingByCreditor.get(row.credor) ?? 0) + row.processos);
  });

  const agingOrder = ['0-30', '31-60', '61-90', '91-180', '181-360', '361+'];
  const agingLabels: Record<string, string> = {
    '0-30': '0 a 30 dias',
    '31-60': '31 a 60 dias',
    '61-90': '61 a 90 dias',
    '91-180': '91 a 180 dias',
    '181-360': '181 a 360 dias',
    '361+': '361+ dias',
  };
  const agingMap = new Map(agingOrder.map((faixa) => [faixa, { faixa, name: agingLabels[faixa], processos: 0, valorCarteira: 0, valorMedio: 0, recuperado: 0, recuperacao: 0, acordos: 0, conversao: 0 }]));

  activeBase.aging_by_credor?.forEach((row) => {
    if (row.faixa === 'SEM VENCIMENTO') return;
    const current = agingMap.get(row.faixa);
    if (!current) return;

    const creditorPortfolio = entryByCreditor.get(row.credor);
    const creditorTicket = creditorPortfolio && creditorPortfolio.processos > 0 ? creditorPortfolio.valorEntrada / creditorPortfolio.processos : overallTicket;
    const creditorBaseTotal = totalAgingByCreditor.get(row.credor) ?? 0;
    const share = creditorBaseTotal > 0 ? row.processos / creditorBaseTotal : 0;
    const creditorRecovered = creditorPortfolio?.recuperado ?? totalRecuperado;
    const creditorAgreements = creditorPortfolio?.acordos ?? totalAcordos;

    current.processos += row.processos;
    current.valorCarteira += row.processos * creditorTicket;
    current.recuperado += creditorRecovered * share;
    current.acordos += creditorAgreements * share;
  });

  const aging = Array.from(agingMap.values()).map((row) => ({
    ...row,
    valorMedio: row.processos > 0 ? row.valorCarteira / row.processos : 0,
    recuperacao: row.valorCarteira > 0 ? (row.recuperado / row.valorCarteira) * 100 : 0,
    conversao: row.processos > 0 ? (row.acordos / row.processos) * 100 : 0,
  }));

  return {
    generated_at: new Date().toISOString(),
    updated_at: activeBase.updated_at,
    aging_updated_at: activeBase.aging_updated_at,
    status: activeBase.status,
    error: activeBase.error,
    aging_complete: activeBase.aging_complete,
    total_processos: activeBase.total_processos,
    total_credores: activeBase.total_credores,
    valor_total_carteira: totalValorEntrada,
    total_borderos: entradaPorCredor.reduce((sum, row) => sum + row.borderos, 0),
    ticket_medio: activeBase.total_processos > 0 ? totalValorEntrada / activeBase.total_processos : 0,
    processos_por_credor: activeBase.by_credor,
    entrada_por_credor: entradaPorCredor,
    aging,
  };
}

function buildDashboardData(): DashboardData {
  const baixas: DashboardData['baixas'] = [];
  const acordos: DashboardData['acordos'] = [];
  const acessos: DashboardData['acessos'] = [];

  DEMO_PERIODS.forEach((periodo, periodIndex) => {
    const dates = BUSINESS_DATES_BY_PERIOD[periodo] ?? [];
    const periodFactor = periodo === '2026-05' ? 1.12 : periodo === '2026-04' ? 0.98 : 0.88;

    dates.forEach((date, dayIndex) => {
      DEMO_CREDITORS.forEach((creditor, creditorIndex) => {
        const agreementCount = Math.max(1, Math.round((1.6 + creditor.weight + ((dayIndex + creditorIndex) % 3)) * periodFactor));
        const paymentCount = Math.max(1, agreementCount - ((dayIndex + creditorIndex + periodIndex) % 4 === 0 ? 1 : 0));
        const accessCount = Math.round(agreementCount * (4.7 + creditor.weight) + 7 + ((dayIndex + creditorIndex) % 6));

        for (let i = 0; i < agreementCount; i += 1) {
          const capital = roundMoney(creditor.avgTicket * periodFactor * (0.74 + ((dayIndex + creditorIndex + i) % 6) * 0.075));
          const honorarios = roundMoney(capital * 0.11);
          const processo = demoProcess('A', periodo, creditor, dayIndex, i);
          acordos.push({
            id: `demo-agreement-${processo}`,
            processo,
            data: date,
            hora: 8 + ((dayIndex * 2 + creditorIndex + i) % 11),
            sistema: creditor.sistema,
            idempresa: creditor.idempresa,
            credor: creditor.credor,
            negociador: ['Digital', 'Portal', 'Operacao'][i % 3],
            tot_sub_total: roundMoney(capital * 1.18),
            tot_ho: honorarios,
            status: 'ACORDO',
          });
        }

        for (let i = 0; i < paymentCount; i += 1) {
          const capital = roundMoney(creditor.avgTicket * periodFactor * (0.68 + ((dayIndex + creditorIndex + i) % 7) * 0.08));
          const juros = roundMoney(capital * (0.045 + (i % 3) * 0.008));
          const multa = roundMoney(capital * 0.018);
          const honorarios = roundMoney(capital * 0.105);
          const total = roundMoney(capital + juros + multa + honorarios);
          const processo = demoProcess('P', periodo, creditor, dayIndex, i);
          baixas.push({
            id: `demo-payment-${processo}`,
            processo,
            data: date,
            sistema: creditor.sistema,
            idempresa: creditor.idempresa,
            credor: creditor.credor,
            negociador: ['Digital', 'Portal', 'Operacao'][i % 3],
            capital_pago: capital,
            protesto_pago: 0,
            juros_pago: juros,
            juros_mora_pago: 0,
            multa_pago: multa,
            honorarios_pago_portal: honorarios,
            total_pago_portal: total,
            taxa_pago: roundMoney(juros + multa),
            taxa_adm_pago: roundMoney(honorarios * 0.12),
            taxa_pd_pago: 0,
            outras_taxas_pago: multa,
            juros_retido_pago: 0,
          });
        }

        for (let i = 0; i < accessCount; i += 1) {
          const hasAgreement = i < agreementCount || (i + dayIndex + creditorIndex) % 13 === 0;
          const processo = demoProcess('V', periodo, creditor, dayIndex, i);
          acessos.push({
            id: `demo-access-${processo}`,
            processo,
            data: date,
            hora: 7 + ((dayIndex + creditorIndex + i) % 14),
            sistema: creditor.sistema,
            idempresa: creditor.idempresa,
            credor: creditor.credor,
            situacao: hasAgreement ? 'COM ACORDO' : 'SEM ACORDO',
          });
        }
      });
    });
  });

  return { baixas, acordos, acessos };
}

function buildWhatsappCampaigns(): Record<string, WhatsappCampaignPeriodData> {
  return Object.fromEntries(DEMO_PERIODS.map((periodo) => {
    const periodFactor = periodo === '2026-05' ? 1 : periodo === '2026-04' ? 1.08 : 0.9;
    const rows = DEMO_CREDITORS.map((creditor, index) => {
      const envios = Math.round((1850 + index * 180) * creditor.weight * periodFactor);
      const clicked = Math.round(envios * (0.052 + (index % 4) * 0.009));
      return {
        credor: creditor.credor,
        envios,
        delivered: Math.round(envios * 0.86),
        read: Math.round(envios * 0.62),
        failed: Math.round(envios * 0.06),
        clicked,
        custo: roundMoney(envios * 0.05),
      };
    });
    const totalEnvios = rows.reduce((sum, row) => sum + row.envios, 0);
    const totalClicked = rows.reduce((sum, row) => sum + row.clicked, 0);
    const dates = BUSINESS_DATES_BY_PERIOD[periodo] ?? [];
    const dayWeights = dates.map((_, index) => 0.9 + ((index % 6) * 0.1));
    const totalDayWeight = dayWeights.reduce((sum, weight) => sum + weight, 0) || 1;
    const daily = dates.map((date, index) => ({
      data: date,
      envios: Math.round((totalEnvios * dayWeights[index]) / totalDayWeight),
      clicked: Math.round((totalClicked * dayWeights[index]) / totalDayWeight),
    }));
    const failed = rows.reduce((sum, row) => sum + row.failed, 0);

    return [periodo, {
      summary: {
        campaignRows: totalEnvios + failed,
        contactRows: totalEnvios,
        matched: totalEnvios,
        unmatched: 0,
        failed,
        billable: totalEnvios,
        clicked: totalClicked,
        totalCost: roundMoney(totalEnvios * 0.05),
      },
      daily,
      rows,
    }];
  }));
}

function filterCreditors(sistema: SystemFilter, selectedCreditors: Set<string>) {
  if (isNoCreditorSelection(selectedCreditors)) return [];
  return DEMO_CREDITORS.filter((creditor) => {
    const systemMatches = sistema === 'total' || creditor.sistema === sistema;
    const creditorMatches = selectedCreditors.size === 0 || selectedCreditors.has(creditor.credor);
    return systemMatches && creditorMatches;
  });
}

function totalPaidFor(periodo: string, sistema: SystemFilter) {
  return roundMoney(DEMO_DASHBOARD_DATA.baixas
    .filter((row) => monthKey(row.data) === periodo && matchesSystem(row, sistema))
    .reduce((sum, row) => sum + row.capital_pago + row.juros_pago + row.multa_pago + row.honorarios_pago_portal, 0));
}

function countAgreementsFor(periodo: string, sistema: SystemFilter) {
  return DEMO_DASHBOARD_DATA.acordos.filter((row) => monthKey(row.data) === periodo && matchesSystem(row, sistema)).length;
}

function whatsappRowsFor(periodo: string, sistema: SystemFilter, selectedCreditors: Set<string>) {
  const allowed = new Set(filterCreditors(sistema, selectedCreditors).map((creditor) => creditor.credor));
  return (DEMO_WHATSAPP_CAMPAIGN_DATA[periodo]?.rows ?? []).filter((row) => allowed.has(row.credor));
}

function emailCountFor(periodo: string, creditor: DemoCreditor, index: number) {
  const factor = periodo === '2026-05' ? 1.04 : periodo === '2026-04' ? 0.96 : 0.86;
  return Math.round((1350 + index * 190) * creditor.weight * factor);
}

function matchesSystem(row: { idempresa: number }, sistema: SystemFilter) {
  return sistema === 'total' || (sistema === 'consulth' ? row.idempresa === 401 : row.idempresa === 1007);
}

function demoProcess(prefix: string, periodo: string, creditor: DemoCreditor, dayIndex: number, rowIndex: number) {
  return `${prefix}${periodo.replace('-', '')}${creditor.idcredor}${String(dayIndex + 1).padStart(2, '0')}${String(rowIndex + 1).padStart(2, '0')}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
