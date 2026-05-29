export type SystemFilter = 'consulth' | 'sisth' | 'total';
export type DashboardTab = 'relatorio' | 'custos' | 'performance' | 'carteiras' | 'base-ativa';
export type ThemeMode = 'sisth' | 'night';

export type ActiveUsersReport = {
  generated_at: string;
  active_window_seconds: number;
  total_active: number;
  by_tab: Array<{ name: string; value: number }>;
  by_device: Array<{ name: string; value: number }>;
  by_browser: Array<{ name: string; value: number }>;
  sessions: Array<{
    session_id: string;
    first_seen: string;
    last_seen: string;
    seconds_online: number;
    path: string;
    tab: string;
    period: string;
    system: string;
    referrer: string;
    timezone: string;
    language: string;
    visibility: string;
    viewport: { width: number | null; height: number | null };
    screen: { width: number | null; height: number | null };
    ip_hash: string;
    browser: string;
    os: string;
    device: string;
  }>;
};

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

export type PortfolioEntry = {
  id: string;
  sistema: Exclude<SystemFilter, 'total'>;
  idempresa: number;
  codimp: string;
  data: string;
  mes: string;
  usuario_cad: string;
  nomearquivo: string;
  idcredor: number;
  credor: string;
  qtdetit: number;
  qtdeimp: number;
  qtdeproc: number;
  qtdedup: number;
  valor_imp: number;
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
  diario?: Array<{
    data: string;
    qtde_emails: number;
    mensagens_wati: number;
  }>;
};

export type EmailClickData = {
  total: {
    cliques: number;
    links_unicos: number;
    processos: number;
    destinatarios: number;
  };
  por_credor: Array<{
    credor: string;
    cliques: number;
    links_unicos: number;
    processos: number;
    destinatarios: number;
    campanhas: number;
    templates: number;
    ips: number;
    user_agents: number;
    primeiro_clique: string | null;
    ultimo_clique: string | null;
  }>;
  recentes: Array<{
    token: string | null;
    canal?: string | null;
    processo: string | null;
    destinatario?: string | null;
    email_destinatario: string | null;
    telefone?: string | null;
    credor: string;
    campanha: string | null;
    template: string | null;
    ip: string | null;
    user_agent: string | null;
    data_clique: string | null;
  }>;
};
