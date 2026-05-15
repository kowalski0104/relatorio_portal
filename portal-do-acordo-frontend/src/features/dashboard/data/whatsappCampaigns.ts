export type WhatsappCampaignCredor = {
  credor: string;
  envios: number;
  delivered: number;
  read: number;
  failed: number;
  clicked: number;
  custo: number;
};

export type WhatsappCampaignSummary = {
  campaignRows: number;
  contactRows: number;
  matched: number;
  unmatched: number;
  failed: number;
  billable: number;
  clicked: number;
  totalCost: number;
};

export type WhatsappCampaignPeriodData = {
  summary: WhatsappCampaignSummary;
  rows: WhatsappCampaignCredor[];
};

export const WHATSAPP_CAMPAIGN_DATA: Record<string, WhatsappCampaignPeriodData> = {
  '2026-03': {
    summary: { campaignRows: 138412, contactRows: 97905, matched: 63334, unmatched: 75078, failed: 29357, billable: 109055, clicked: 7746, totalCost: 5452.75 },
    rows: [
      { credor: 'SEM CREDOR', envios: 74780, delivered: 21544, read: 43392, failed: 298, clicked: 4751, custo: 3739 },
      { credor: 'GRUPO JTI', envios: 14155, delivered: 3925, read: 8346, failed: 2574, clicked: 846, custo: 707.75 },
      { credor: 'GEAP', envios: 5681, delivered: 1538, read: 3417, failed: 7815, clicked: 678, custo: 284.05 },
      { credor: 'SOUZA CRUZ', envios: 3468, delivered: 764, read: 2454, failed: 3579, clicked: 432, custo: 173.4 },
      { credor: 'SOLAR BR', envios: 3164, delivered: 585, read: 2259, failed: 8173, clicked: 474, custo: 158.2 },
      { credor: 'PEIXOTO', envios: 1919, delivered: 541, read: 1115, failed: 1327, clicked: 113, custo: 95.95 },
      { credor: 'SOROCABA', envios: 1184, delivered: 263, read: 692, failed: 257, clicked: 58, custo: 59.2 },
      { credor: 'PLATINUM ADMINISTRADORA DE BENEFICIOS', envios: 1157, delivered: 295, read: 817, failed: 3375, clicked: 21, custo: 57.85 },
      { credor: 'HNK BR BEBIDAS LTDA', envios: 778, delivered: 236, read: 519, failed: 356, clicked: 107, custo: 38.9 },
      { credor: 'QUALICORP ADMINISTRADORA DE BENEFICIOS', envios: 707, delivered: 214, read: 422, failed: 408, clicked: 105, custo: 35.35 },
      { credor: 'HNK BR INDUSTRIA DE BEBIDAS LTDA', envios: 542, delivered: 145, read: 376, failed: 243, clicked: 77, custo: 27.1 },
      { credor: 'GRF', envios: 314, delivered: 116, read: 146, failed: 56, clicked: 9, custo: 15.7 },
      { credor: 'QUALICORP', envios: 264, delivered: 91, read: 112, failed: 110, clicked: 9, custo: 13.2 },
      { credor: 'VOTORANTIM', envios: 242, delivered: 79, read: 151, failed: 149, clicked: 6, custo: 12.1 },
      { credor: 'PEIXOTO COMERCIO INDUSTRIA SERVICOS E TRANSPORTES S/A', envios: 179, delivered: 64, read: 102, failed: 72, clicked: 22, custo: 8.95 },
      { credor: 'COMPAR COMPANHIA PARAENSE DE REFRIGERANTES', envios: 151, delivered: 24, read: 115, failed: 352, clicked: 21, custo: 7.55 },
      { credor: 'PEIXOTO COMERCIO', envios: 120, delivered: 25, read: 92, failed: 63, clicked: 1, custo: 6 },
      { credor: 'INDUSTRIA DE BEBIDAS IGARASSU LTDA', envios: 85, delivered: 26, read: 56, failed: 41, clicked: 8, custo: 4.25 },
      { credor: 'AURORA COOP', envios: 53, delivered: 28, read: 22, failed: 13, clicked: 3, custo: 2.65 },
      { credor: 'SUPER VINHOS DISTRIBUIDORA S.A.', envios: 34, delivered: 7, read: 23, failed: 0, clicked: 2, custo: 1.7 },
      { credor: 'CEBRASA', envios: 19, delivered: 1, read: 11, failed: 52, clicked: 0, custo: 0.95 },
      { credor: 'VOTORANTIM CIMENTOS S.A. - 4014', envios: 18, delivered: 3, read: 15, failed: 0, clicked: 0, custo: 0.9 },
      { credor: 'PEIXOTO COMERCIO INDUSTRIA SERVICOS E TRANSPORTES S/A - CAMPANHA', envios: 15, delivered: 4, read: 9, failed: 0, clicked: 1, custo: 0.75 },
      { credor: 'BELLO', envios: 13, delivered: 8, read: 5, failed: 0, clicked: 0, custo: 0.65 },
      { credor: 'PEIXOTO COMERCIO INDUSTRIA', envios: 6, delivered: 2, read: 4, failed: 0, clicked: 0, custo: 0.3 },
      { credor: 'COMPAR COMPANHIA DE REFRIGERANTES', envios: 4, delivered: 0, read: 4, failed: 4, clicked: 2, custo: 0.2 },
      { credor: 'GRF DISTRIBUICAO LTDA', envios: 3, delivered: 0, read: 3, failed: 0, clicked: 0, custo: 0.15 },
      { credor: 'PLATINUM', envios: 0, delivered: 0, read: 0, failed: 40, clicked: 0, custo: 0 },
    ],
  },
  '2026-04': {
    summary: { campaignRows: 118340, contactRows: 97905, matched: 55295, unmatched: 63045, failed: 24410, billable: 93930, clicked: 6455, totalCost: 4696.5 },
    rows: [
      { credor: 'SEM CREDOR', envios: 62838, delivered: 18903, read: 33673, failed: 207, clicked: 3568, custo: 3141.9 },
      { credor: 'GRUPO JTI', envios: 14953, delivered: 4097, read: 8541, failed: 4202, clicked: 992, custo: 747.65 },
      { credor: 'GEAP', envios: 4778, delivered: 1328, read: 2917, failed: 4491, clicked: 719, custo: 238.9 },
      { credor: 'SOUZA CRUZ', envios: 3536, delivered: 848, read: 2356, failed: 3731, clicked: 328, custo: 176.8 },
      { credor: 'SOLAR BR', envios: 3149, delivered: 697, read: 2082, failed: 9612, clicked: 381, custo: 157.45 },
      { credor: 'BELLO', envios: 1475, delivered: 459, read: 949, failed: 703, clicked: 176, custo: 73.75 },
      { credor: 'AURORA COOP', envios: 1234, delivered: 413, read: 761, failed: 484, clicked: 96, custo: 61.7 },
      { credor: 'GRF', envios: 689, delivered: 232, read: 374, failed: 268, clicked: 53, custo: 34.45 },
      { credor: 'PEIXOTO', envios: 513, delivered: 111, read: 318, failed: 367, clicked: 30, custo: 25.65 },
      { credor: 'PLATINUM ADMINISTRADORA DE BENEFICIOS', envios: 249, delivered: 71, read: 174, failed: 29, clicked: 65, custo: 12.45 },
      { credor: 'QUALICORP', envios: 224, delivered: 82, read: 72, failed: 88, clicked: 2, custo: 11.2 },
      { credor: 'VOTORANTIM', envios: 168, delivered: 36, read: 125, failed: 77, clicked: 26, custo: 8.4 },
      { credor: 'COMPAR COMPANHIA PARAENSE DE REFRIGERANTES', envios: 62, delivered: 1, read: 59, failed: 91, clicked: 14, custo: 3.1 },
      { credor: 'SOROCABA', envios: 51, delivered: 14, read: 18, failed: 16, clicked: 2, custo: 2.55 },
      { credor: 'SUPER VINHOS DISTRIBUIDORA S.A.', envios: 3, delivered: 0, read: 2, failed: 0, clicked: 0, custo: 0.15 },
      { credor: 'VOTORANTIM CIMENTOS S.A. - 4014', envios: 3, delivered: 1, read: 2, failed: 0, clicked: 0, custo: 0.15 },
      { credor: 'PEIXOTO COMERCIO INDUSTRIA SERVICOS E TRANSPORTES S/A', envios: 2, delivered: 0, read: 2, failed: 3, clicked: 2, custo: 0.1 },
      { credor: 'QUALICORP ADMINISTRADORA DE BENEFICIOS', envios: 2, delivered: 0, read: 2, failed: 1, clicked: 0, custo: 0.1 },
      { credor: 'CEBRASA', envios: 1, delivered: 0, read: 1, failed: 0, clicked: 1, custo: 0.05 },
      { credor: 'PLATINUM', envios: 0, delivered: 0, read: 0, failed: 40, clicked: 0, custo: 0 },
    ],
  },
  '2026-05': {
    summary: { campaignRows: 65919, contactRows: 97905, matched: 38642, unmatched: 27277, failed: 21805, billable: 44114, clicked: 2753, totalCost: 2205.7 },
    rows: [
      { credor: 'SEM CREDOR', envios: 27258, delivered: 9445, read: 12826, failed: 19, clicked: 1253, custo: 1362.9 },
      { credor: 'GRUPO JTI', envios: 7870, delivered: 2941, read: 3557, failed: 6016, clicked: 377, custo: 393.5 },
      { credor: 'GEAP', envios: 2476, delivered: 671, read: 1740, failed: 343, clicked: 431, custo: 123.8 },
      { credor: 'PEIXOTO', envios: 1671, delivered: 418, read: 1043, failed: 1856, clicked: 173, custo: 83.55 },
      { credor: 'SOUZA CRUZ', envios: 1401, delivered: 400, read: 830, failed: 4177, clicked: 142, custo: 70.05 },
      { credor: 'SOLAR BR', envios: 1372, delivered: 301, read: 877, failed: 8810, clicked: 285, custo: 68.6 },
      { credor: 'VOTORANTIM', envios: 840, delivered: 280, read: 461, failed: 68, clicked: 38, custo: 42 },
      { credor: 'BELLO', envios: 753, delivered: 294, read: 347, failed: 192, clicked: 30, custo: 37.65 },
      { credor: 'AURORA COOP', envios: 443, delivered: 160, read: 231, failed: 266, clicked: 12, custo: 22.15 },
      { credor: 'GRF', envios: 14, delivered: 6, read: 5, failed: 50, clicked: 2, custo: 0.7 },
      { credor: 'QUALICORP', envios: 8, delivered: 0, read: 8, failed: 0, clicked: 6, custo: 0.4 },
      { credor: 'COMPAR COMPANHIA PARAENSE DE REFRIGERANTES', envios: 7, delivered: 0, read: 7, failed: 2, clicked: 3, custo: 0.35 },
      { credor: 'CEBRASA', envios: 1, delivered: 0, read: 1, failed: 6, clicked: 1, custo: 0.05 },
    ],
  },
};
