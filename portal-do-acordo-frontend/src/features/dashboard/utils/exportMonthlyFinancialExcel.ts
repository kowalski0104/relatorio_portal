import type { Payment } from '../types';
import { monthKey } from './dates';
import { isExcludedDashboardCreditor } from './creditors';

type FinancialValues = {
  valorCobrado: number;
  honorarios: number;
  taxaContrato: number;
  juros: number;
  jurosMora: number;
  multa: number;
  protesto: number;
  taxaAdm: number;
  outrasTaxas: number;
  taxaPd: number;
  total: number;
};

type FinancialRow = FinancialValues & {
  credor: string;
  sistema: Payment['sistema'];
};

const MONTH_NAMES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const SYSTEMS: Payment['sistema'][] = ['consulth', 'sisth'];
const SYSTEM_LABELS: Record<Payment['sistema'], string> = {
  consulth: 'CONSULTH',
  sisth: 'SISTH',
};
const FINANCIAL_KEYS: Array<keyof FinancialValues> = ['valorCobrado', 'honorarios', 'taxaContrato', 'juros', 'jurosMora', 'multa', 'protesto', 'taxaAdm', 'outrasTaxas', 'taxaPd', 'total'];

function safe(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyValues(): FinancialValues {
  return {
    valorCobrado: 0,
    honorarios: 0,
    taxaContrato: 0,
    juros: 0,
    jurosMora: 0,
    multa: 0,
    protesto: 0,
    taxaAdm: 0,
    outrasTaxas: 0,
    taxaPd: 0,
    total: 0,
  };
}

function valuesFromPayment(payment: Payment): FinancialValues {
  const values = {
    valorCobrado: safe(payment.capital_pago), // <-- CORRIGIDO: Agora pega apenas o valor principal
    honorarios: safe(payment.honorarios_pago_portal),
    taxaContrato: safe(payment.taxa_pago),
    juros: safe(payment.juros_pago),
    jurosMora: safe(payment.juros_mora_pago),
    multa: safe(payment.multa_pago),
    protesto: safe(payment.protesto_pago),
    taxaAdm: safe(payment.taxa_adm_pago),
    outrasTaxas: safe(payment.outras_taxas_pago),
    taxaPd: safe(payment.taxa_pd_pago),
  };

  return {
    ...values,
    // CORRIGIDO: Agora o total soma o capital cobrado + todas as taxas
    total: values.valorCobrado 
      + values.honorarios
      + values.taxaContrato
      + values.juros
      + values.jurosMora
      + values.multa
      + values.protesto
      + values.taxaAdm
      + values.outrasTaxas
      + values.taxaPd,
  };
}

function addValues(target: FinancialValues, source: FinancialValues) {
  FINANCIAL_KEYS.forEach((key) => {
    target[key] += source[key];
  });
  return target;
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function stringCell(value: string, style = 'Text') {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function moneyCell(value: number, style = 'Money') {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`;
}

function mergedLabelCell(value: string, style: string) {
  return `<Cell ss:MergeAcross="1" ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function totalsRow(label: string, values: FinancialValues, style: 'Subtotal' | 'GrandTotal') {
  return `<Row>${mergedLabelCell(label, style)}${FINANCIAL_KEYS.map((key) => moneyCell(values[key], style)).join('')}</Row>`;
}

function periodTitle(period: string) {
  const [year, month] = period.split('-').map(Number);
  return `${MONTH_NAMES[month - 1] ?? period} / ${year}`;
}

function buildPeriodWorksheet(period: string, payments: Payment[]) {
  const rowsByCreditor = new Map<string, FinancialRow>();

  payments.forEach((payment) => {
    const key = `${payment.sistema}::${payment.credor}`;
    const current = rowsByCreditor.get(key) ?? {
      credor: payment.credor || 'OUTROS',
      sistema: payment.sistema,
      ...emptyValues(),
    };
    addValues(current, valuesFromPayment(payment));
    rowsByCreditor.set(key, current);
  });

  const rows = Array.from(rowsByCreditor.values()).sort(
    (left, right) => SYSTEMS.indexOf(left.sistema) - SYSTEMS.indexOf(right.sistema) || left.credor.localeCompare(right.credor, 'pt-BR')
  );
  const totalsBySystem = new Map(SYSTEMS.map((sistema) => [sistema, emptyValues()]));
  const grandTotal = emptyValues();

  rows.forEach((row) => {
    addValues(totalsBySystem.get(row.sistema)!, row);
    addValues(grandTotal, row);
  });

  const detailRows = rows.map((row) => (
    `<Row>${stringCell(row.credor)}${stringCell(SYSTEM_LABELS[row.sistema])}${FINANCIAL_KEYS.map((key) => moneyCell(row[key])).join('')}</Row>`
  )).join('');
  const systemRows = SYSTEMS
    .filter((sistema) => rows.some((row) => row.sistema === sistema))
    .map((sistema) => totalsRow(SYSTEM_LABELS[sistema], totalsBySystem.get(sistema)!, 'Subtotal'))
    .join('');
  const headers = ['CREDOR', 'EMPRESA', 'VALOR COBRADO', 'HONORÁRIOS', 'TAXA DE CONTRATO', 'JUROS', 'JUROS DE MORA', 'MULTA', 'PROTESTO', 'TAXA ADM', 'OUTRAS TAXAS', 'TAXA DE PD', 'TOTAL'];

  return `
    <Worksheet ss:Name="${escapeXml(period)}">
      <Table>
        <Column ss:Width="150"/>
        <Column ss:Width="92"/>
        <Column ss:Width="106"/>
        <Column ss:Width="94"/>
        <Column ss:Width="118"/>
        <Column ss:Width="94"/>
        <Column ss:Width="104"/>
        <Column ss:Width="82"/>
        <Column ss:Width="82"/>
        <Column ss:Width="86"/>
        <Column ss:Width="94"/>
        <Column ss:Width="82"/>
        <Column ss:Width="104"/>
        <Row ss:Height="24"><Cell ss:MergeAcross="12" ss:StyleID="Title"><Data ss:Type="String">RELATÓRIO FINANCEIRO MENSAL</Data></Cell></Row>
        <Row ss:Height="20"><Cell ss:MergeAcross="12" ss:StyleID="Period"><Data ss:Type="String">${escapeXml(periodTitle(period))}</Data></Cell></Row>
        <Row/>
        <Row>${headers.map((header) => stringCell(header, 'Header')).join('')}</Row>
        ${detailRows}
        <Row/>
        ${systemRows}
        <Row/>
        ${totalsRow('TOTAL', grandTotal, 'GrandTotal')}
      </Table>
    </Worksheet>`;
}

export function buildMonthlyFinancialWorkbook(payments: Payment[]) {
  const paymentsByPeriod = new Map<string, Payment[]>();

  payments.forEach((payment) => {
    if (isExcludedDashboardCreditor(payment.credor)) return;
    const period = monthKey(payment.data);
    if (!period) return;
    const current = paymentsByPeriod.get(period) ?? [];
    current.push(payment);
    paymentsByPeriod.set(period, current);
  });

  const periods = Array.from(paymentsByPeriod.keys()).sort();
  if (periods.length === 0) return null;

  const worksheets = periods.map((period) => buildPeriodWorksheet(period, paymentsByPeriod.get(period)!)).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Text"><Alignment ss:Vertical="Center"/></Style>
    <Style ss:ID="Title"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Size="14" ss:Color="#FFFFFF"/><Interior ss:Color="#000000" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Period"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1"/></Style>
    <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#000000" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
    <Style ss:ID="Money"><Alignment ss:Horizontal="Right"/><NumberFormat ss:Format="&quot;R$&quot; #,##0.00;[Red]-&quot;R$&quot; #,##0.00;-"/></Style>
    <Style ss:ID="Subtotal"><Alignment ss:Horizontal="Right"/><Font ss:Bold="1"/><Interior ss:Color="#C8D1DD" ss:Pattern="Solid"/><NumberFormat ss:Format="&quot;R$&quot; #,##0.00;[Red]-&quot;R$&quot; #,##0.00;-"/></Style>
    <Style ss:ID="GrandTotal"><Alignment ss:Horizontal="Right"/><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#000000" ss:Pattern="Solid"/><NumberFormat ss:Format="&quot;R$&quot; #,##0.00;[Red]-&quot;R$&quot; #,##0.00;-"/></Style>
  </Styles>
  ${worksheets}
</Workbook>`;

  return { xml, periods };
}

export function downloadMonthlyFinancialExcel(payments: Payment[]) {
  const workbook = buildMonthlyFinancialWorkbook(payments);
  if (!workbook) return false;

  const suffix = workbook.periods.length === 1
    ? workbook.periods[0]
    : `${workbook.periods[0]}-a-${workbook.periods[workbook.periods.length - 1]}`;
  const blob = new Blob([`\uFEFF${workbook.xml}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `relatorio-financeiro-${suffix}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  return true;
}
