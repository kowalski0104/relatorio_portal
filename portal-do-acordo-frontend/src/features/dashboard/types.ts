export type SystemFilter = 'consulth' | 'sisth' | 'total';
export type DashboardTab = 'relatorio' | 'custos' | 'performance' | 'base-ativa';
export type ThemeMode = 'sisth' | 'night';

export type Payment = {
  id: string;
  processo: string;
  data: string;
  sistema: Exclude<SystemFilter, 'total'>;
  idempresa: number;
  credor: string;
  negociador: string;
  capital_pago: number;
  juros_pago: number;
  multa_pago: number;
  honorarios_pago_portal: number;
  total_pago_portal: number;
  taxa_pago: number;
  taxa_adm_pago: number;
};

export type Agreement = {
  id: string;
  processo: string;
  data: string;
  hora?: number;
  sistema: Exclude<SystemFilter, 'total'>;
  idempresa: number;
  credor: string;
  negociador: string;
  tot_sub_total: number;
  tot_ho: number;
  status: string;
};

export type Access = {
  id: string;
  processo: string;
  data: string;
  hora?: number;
  sistema: Exclude<SystemFilter, 'total'>;
  idempresa: number;
  credor: string | null;
  situacao: 'COM ACORDO' | 'SEM ACORDO';
};

export type DashboardData = {
  baixas: Payment[];
  acordos: Agreement[];
  acessos: Access[];
};

export type ActiveBaseReport = {
  updated_at: string | null;
  aging_updated_at?: string | null;
  status: 'empty' | 'refreshing' | 'partial' | 'ready' | 'error';
  error?: string;
  total_processos: number;
  total_credores: number;
  aging_complete: boolean;
  by_credor: Array<{
    credor: string;
    processos: number;
  }>;
  aging: Array<{
    faixa: string;
    processos: number;
  }>;
};

export type CostsData = {
  periodo: string;
  categories: { name: string; value: number }[];
  evolution: { mes: string; receita: number; acordos: number }[];
  comparativo: {
    atual: number;
    anterior: number;
    variacao: number;
    acordos_atual: number;
    acordos_anterior: number;
    custo_por_acordo: number;
  };
};

export type CommunicationData = {
  envios: {
    emails: number;
    whatsapp: number;
    custo_whatsapp: number;
  };
  por_credor: Array<{
    credor: string;
    qtde_emails: number;
    mensagens_wati: number;
    custo_wati: number;
  }>;
  mensal: Array<{
    mes: string;
    qtde_emails: number;
    mensagens_wati: number;
  }>;
};
