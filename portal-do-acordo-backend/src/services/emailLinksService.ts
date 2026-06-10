import crypto from 'crypto';
import sql from 'mssql';

export const DEFAULT_DESTINATION_URL = 'https://portaldoacordo.com.br';
export const DEFAULT_PUBLIC_API_BASE_URL = 'https://portal-relatorio-api-aucpaha6dphdhegp.canadacentral-01.azurewebsites.net';

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

type ColumnInfoRow = {
  TABLE_SCHEMA: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  IS_NULLABLE: 'YES' | 'NO';
  COLUMN_DEFAULT: string | null;
  ORDINAL_POSITION: number;
};

type ColumnInfo = {
  schemaName: string;
  name: string;
  dataType: string;
  maxLength: number | null;
  nullable: boolean;
  defaultValue: string | null;
};

type EmailEnviosSchema = {
  schemaName: string;
  tableName: 'email_envios';
  tableRef: string;
  columns: ColumnInfo[];
  columnsByName: Map<string, ColumnInfo>;
};

type ColumnValue = {
  column: ColumnInfo;
  value: unknown;
};

type MatchCondition = {
  sql: string;
  paramName: string;
  value: string;
};

export type EmailLinkInputItem = {
  processo?: string;
  email: string;
  grupo?: string;
  devedor_razao?: string;
  devedor_cnpj?: string;
  credor_fantasia?: string;
  titulos_aberto_total?: string;
  campanha?: string;
  template?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type BulkGenerateEmailLinksInput = {
  origem: string;
  campanha?: string;
  url_destino?: string;
  items: EmailLinkInputItem[];
};

export type BulkGenerateEmailLinkItemResult = {
  processo?: string;
  email: string;
  token?: string;
  link_tracking?: string;
  status: 'created' | 'reused' | 'failed';
};

export type BulkGenerateEmailLinkError = {
  index: number;
  processo?: string;
  email?: string;
  error: string;
};

export type BulkGenerateEmailLinksResult = {
  success: boolean;
  total: number;
  created: number;
  reused: number;
  failed: number;
  items: BulkGenerateEmailLinkItemResult[];
  errors: BulkGenerateEmailLinkError[];
  schema: {
    table: string;
    columns: string[];
    uniqueKeyColumn: string | null;
    payloadColumn: string | null;
  };
};

export class EmailLinksPublicError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'EmailLinksPublicError';
    this.statusCode = statusCode;
  }
}

let pool: sql.ConnectionPool | null = null;
let poolPromise: Promise<sql.ConnectionPool> | null = null;
let cachedSchema: { value: EmailEnviosSchema; expiresAt: number } | null = null;

export async function bulkGenerateEmailLinks(input: BulkGenerateEmailLinksInput): Promise<BulkGenerateEmailLinksResult> {
  const destinationUrl = normalizeDestinationUrl(input.url_destino);
  const publicApiBaseUrl = getPublicApiBaseUrl();
  const pool = await getConnection();
  const schema = await getEmailEnviosSchema(pool);

  ensureMinimumSchema(schema);

  let created = 0;
  let reused = 0;
  let failed = 0;
  const items: BulkGenerateEmailLinkItemResult[] = [];
  const errors: BulkGenerateEmailLinkError[] = [];

  for (const [index, item] of input.items.entries()) {
    try {
      const result = await upsertEmailLink(pool, schema, input, item, destinationUrl, publicApiBaseUrl);
      if (result.status === 'created') created += 1;
      if (result.status === 'reused') reused += 1;
      items.push(result);
    } catch (error) {
      failed += 1;
      const processo = cleanString(item.processo);
      const email = cleanString(item.email);
      errors.push({
        index,
        processo,
        email,
        error: getClientSafeError(error),
      });
      items.push({
        processo,
        email: email ?? '',
        status: 'failed',
      });
      console.error('Falha ao gerar link de email', {
        index,
        processo,
        email,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const uniqueKeyColumn = getColumn(schema, 'unique_key');
  const payloadColumn = getColumn(schema, 'payload_json', 'payload');

  return {
    success: failed === 0,
    total: input.items.length,
    created,
    reused,
    failed,
    items,
    errors,
    schema: {
      table: schema.tableRef,
      columns: schema.columns.map((column) => column.name),
      uniqueKeyColumn: uniqueKeyColumn?.name ?? null,
      payloadColumn: payloadColumn?.name ?? null,
    },
  };
}

async function upsertEmailLink(
  pool: sql.ConnectionPool,
  schema: EmailEnviosSchema,
  input: BulkGenerateEmailLinksInput,
  item: EmailLinkInputItem,
  destinationUrl: string,
  publicApiBaseUrl: string
): Promise<BulkGenerateEmailLinkItemResult> {
  const email = cleanString(item.email);
  if (!email) throw new EmailLinksPublicError('Item sem email obrigatorio.', 400);

  const processo = cleanString(item.processo);
  const rawUniqueKey = buildLogicalUniqueKey(input, item);
  const uniqueKeyColumn = getColumn(schema, 'unique_key');
  const persistedUniqueKey = formatUniqueKeyForColumn(rawUniqueKey, uniqueKeyColumn);

  const existingToken = await findExistingToken(pool, schema, input, item, persistedUniqueKey);
  if (existingToken) {
    await updateExistingEmailLink(pool, schema, input, item, destinationUrl, rawUniqueKey, persistedUniqueKey, existingToken);
    return {
      processo,
      email,
      token: existingToken,
      link_tracking: buildTrackingLink(publicApiBaseUrl, existingToken),
      status: 'reused',
    };
  }

  const token = await createUniqueToken(pool, schema, prefixForCredor(item.credor_fantasia));
  await insertEmailLink(pool, schema, input, item, destinationUrl, rawUniqueKey, persistedUniqueKey, token);

  return {
    processo,
    email,
    token,
    link_tracking: buildTrackingLink(publicApiBaseUrl, token),
    status: 'created',
  };
}

async function getConnection(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  if (poolPromise) return poolPromise;

  const missing = ['AZURE_SQL_SERVER', 'AZURE_SQL_DATABASE', 'AZURE_SQL_USER', 'AZURE_SQL_PASSWORD']
    .filter((name) => !process.env[name]);

  if (missing.length) {
    throw new EmailLinksPublicError(`Variaveis de ambiente ausentes: ${missing.join(', ')}.`);
  }

  const nextPool = new sql.ConnectionPool({
    server: process.env.AZURE_SQL_SERVER!,
    database: process.env.AZURE_SQL_DATABASE!,
    user: process.env.AZURE_SQL_USER!,
    password: process.env.AZURE_SQL_PASSWORD!,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    options: { encrypt: true, trustServerCertificate: false, connectTimeout: 30000 },
  });

  nextPool.on('error', (error) => {
    console.error('Erro na pool de email links:', error);
    pool = null;
    poolPromise = null;
    cachedSchema = null;
  });

  poolPromise = nextPool.connect()
    .then((connectedPool) => {
      pool = connectedPool;
      return connectedPool;
    })
    .catch((error) => {
      pool = null;
      cachedSchema = null;
      throw error;
    })
    .finally(() => {
      poolPromise = null;
    });

  return poolPromise;
}

async function getEmailEnviosSchema(pool: sql.ConnectionPool): Promise<EmailEnviosSchema> {
  if (cachedSchema && cachedSchema.expiresAt > Date.now()) return cachedSchema.value;

  const result = await pool.request().query<ColumnInfoRow>(`
    SELECT
      TABLE_SCHEMA,
      COLUMN_NAME,
      DATA_TYPE,
      CHARACTER_MAXIMUM_LENGTH,
      IS_NULLABLE,
      COLUMN_DEFAULT,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'email_envios'
    ORDER BY ORDINAL_POSITION
  `);

  if (!result.recordset.length) {
    throw new EmailLinksPublicError('Tabela email_envios nao encontrada no Azure SQL.');
  }

  const first = result.recordset[0];
  const columns = result.recordset.map((row) => ({
    schemaName: row.TABLE_SCHEMA,
    name: row.COLUMN_NAME,
    dataType: row.DATA_TYPE.toLowerCase(),
    maxLength: row.CHARACTER_MAXIMUM_LENGTH,
    nullable: row.IS_NULLABLE === 'YES',
    defaultValue: row.COLUMN_DEFAULT,
  }));

  const schema: EmailEnviosSchema = {
    schemaName: first.TABLE_SCHEMA,
    tableName: 'email_envios',
    tableRef: `${quoteIdentifier(first.TABLE_SCHEMA)}.${quoteIdentifier('email_envios')}`,
    columns,
    columnsByName: new Map(columns.map((column) => [column.name.toLowerCase(), column])),
  };

  cachedSchema = {
    value: schema,
    expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
  };

  return schema;
}

function ensureMinimumSchema(schema: EmailEnviosSchema) {
  const required = [
    ['token'],
    ['url_destino'],
    ['email_destinatario', 'email'],
  ];

  const missing = required
    .filter((candidates) => !getColumn(schema, ...candidates))
    .map((candidates) => candidates.join('/'));

  if (missing.length) {
    throw new EmailLinksPublicError(`Tabela email_envios sem campo obrigatorio para o endpoint: ${missing.join(', ')}.`);
  }
}

async function findExistingToken(
  pool: sql.ConnectionPool,
  schema: EmailEnviosSchema,
  input: BulkGenerateEmailLinksInput,
  item: EmailLinkInputItem,
  persistedUniqueKey: string
) {
  const tokenColumn = requireColumn(schema, 'token');
  const uniqueKeyColumn = getColumn(schema, 'unique_key');

  if (uniqueKeyColumn) {
    const request = pool.request();
    addTypedInput(request, 'uniqueKey', uniqueKeyColumn, persistedUniqueKey);
    const result = await request.query<{ token: string }>(`
      SELECT TOP 1 ${columnRef(tokenColumn)} AS token
      FROM ${schema.tableRef}
      WHERE ${columnRef(uniqueKeyColumn)} = @uniqueKey
    `);

    return cleanString(result.recordset[0]?.token);
  }

  for (const conditions of buildFallbackMatchPlans(schema, input, item)) {
    const request = pool.request();
    conditions.forEach((condition) => request.input(condition.paramName, sql.NVarChar(4000), condition.value));
    const result = await request.query<{ token: string }>(`
      SELECT TOP 1 ${columnRef(tokenColumn)} AS token
      FROM ${schema.tableRef}
      WHERE ${conditions.map((condition) => condition.sql).join(' AND ')}
    `);

    const token = cleanString(result.recordset[0]?.token);
    if (token) return token;
  }

  return undefined;
}

async function createUniqueToken(pool: sql.ConnectionPool, schema: EmailEnviosSchema, prefix: string) {
  const tokenColumn = requireColumn(schema, 'token');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = `${prefix}-${crypto.randomUUID().toUpperCase()}`;
    const request = pool.request();
    addTypedInput(request, 'token', tokenColumn, token);
    const result = await request.query<{ token: string }>(`
      SELECT TOP 1 ${columnRef(tokenColumn)} AS token
      FROM ${schema.tableRef}
      WHERE ${columnRef(tokenColumn)} = @token
    `);

    if (!result.recordset.length) return token;
  }

  throw new EmailLinksPublicError('Nao foi possivel gerar token unico.');
}

async function updateExistingEmailLink(
  pool: sql.ConnectionPool,
  schema: EmailEnviosSchema,
  input: BulkGenerateEmailLinksInput,
  item: EmailLinkInputItem,
  destinationUrl: string,
  rawUniqueKey: string,
  persistedUniqueKey: string,
  token: string
) {
  const values = buildColumnValues(schema, input, item, destinationUrl, rawUniqueKey, persistedUniqueKey, token, 'update');
  const tokenColumn = requireColumn(schema, 'token');
  values.delete(tokenColumn.name.toLowerCase());

  if (!values.size) return;

  const request = pool.request();
  const assignments: string[] = [];
  let index = 0;

  values.forEach(({ column, value }) => {
    const paramName = `value${index}`;
    addTypedInput(request, paramName, column, value);
    assignments.push(`${columnRef(column)} = @${paramName}`);
    index += 1;
  });

  addTypedInput(request, 'whereToken', tokenColumn, token);
  await request.query(`
    UPDATE ${schema.tableRef}
    SET ${assignments.join(', ')}
    WHERE ${columnRef(tokenColumn)} = @whereToken
  `);
}

async function insertEmailLink(
  pool: sql.ConnectionPool,
  schema: EmailEnviosSchema,
  input: BulkGenerateEmailLinksInput,
  item: EmailLinkInputItem,
  destinationUrl: string,
  rawUniqueKey: string,
  persistedUniqueKey: string,
  token: string
) {
  const values = buildColumnValues(schema, input, item, destinationUrl, rawUniqueKey, persistedUniqueKey, token, 'insert');
  const request = pool.request();
  const columns: string[] = [];
  const params: string[] = [];
  let index = 0;

  values.forEach(({ column, value }) => {
    const paramName = `value${index}`;
    addTypedInput(request, paramName, column, value);
    columns.push(columnRef(column));
    params.push(`@${paramName}`);
    index += 1;
  });

  await request.query(`
    INSERT INTO ${schema.tableRef} (${columns.join(', ')})
    VALUES (${params.join(', ')})
  `);
}

function buildColumnValues(
  schema: EmailEnviosSchema,
  input: BulkGenerateEmailLinksInput,
  item: EmailLinkInputItem,
  destinationUrl: string,
  rawUniqueKey: string,
  persistedUniqueKey: string,
  token: string,
  mode: 'insert' | 'update'
) {
  const values = new Map<string, ColumnValue>();
  const now = new Date();
  const origem = cleanString(input.origem) ?? 'listmonk';
  const campanha = cleanString(item.campanha) ?? cleanString(input.campanha);
  const template = cleanString(item.template);
  const credor = cleanString(item.credor_fantasia);
  const grupo = resolveGrupo(item);
  const payloadJson = buildPayloadJson(input, item, rawUniqueKey, now);

  setValue(values, getColumn(schema, 'token'), token);
  setValue(values, getColumn(schema, 'url_destino'), destinationUrl);
  setValue(values, getColumn(schema, 'email_destinatario', 'email'), cleanString(item.email));
  setValue(values, getColumn(schema, 'processo'), cleanString(item.processo));
  setValue(values, getColumn(schema, 'credor_fantasia'), credor);
  setValue(values, getColumn(schema, 'credor'), credor);
  setValue(values, getColumn(schema, 'grupo'), grupo);
  setValue(values, getColumn(schema, 'devedor_razao', 'devedor_nome', 'nome_devedor'), cleanString(item.devedor_razao));
  setValue(values, getColumn(schema, 'devedor_cnpj', 'cpf_cnpj', 'cnpj', 'documento'), cleanString(item.devedor_cnpj));
  setValue(values, getColumn(schema, 'titulos_aberto_total', 'valor_total', 'valor_aberto'), cleanString(item.titulos_aberto_total));
  setValue(values, getColumn(schema, 'campanha', 'campaign'), campanha);
  setValue(values, getColumn(schema, 'template'), template);
  setValue(values, getColumn(schema, 'origem', 'source'), origem);
  setValue(values, getColumn(schema, 'payload_json', 'payload'), payloadJson);
  setValue(values, getColumn(schema, 'unique_key'), persistedUniqueKey);
  setValue(values, getColumn(schema, 'updated_at', 'updatedAt', 'atualizado_em', 'data_atualizacao'), now);
  setValue(values, getColumn(schema, 'ativo', 'is_active', 'active'), true);

  if (mode === 'insert') {
    setValue(values, getColumn(schema, 'created_at', 'createdAt', 'criado_em', 'data_criacao'), now);
  }

  return values;
}

function buildFallbackMatchPlans(schema: EmailEnviosSchema, input: BulkGenerateEmailLinksInput, item: EmailLinkInputItem) {
  const email = normalizeKeyValue(item.email);
  if (!email) return [];

  const origem = normalizeKeyValue(input.origem);
  const campanha = normalizeKeyValue(input.campanha);
  const processo = normalizeKeyValue(item.processo);
  const credor = normalizeKeyValue(item.credor_fantasia);

  const originColumn = getColumn(schema, 'origem', 'source');
  const campaignColumn = getColumn(schema, 'campanha', 'campaign');
  const processoColumn = getColumn(schema, 'processo');
  const emailColumn = getColumn(schema, 'email_destinatario', 'email');
  const credorColumns = getColumns(schema, 'credor_fantasia', 'credor');
  if (!emailColumn) return [];

  const originCondition = origem && originColumn ? normalizedEquals(originColumn, 'origem', origem) : undefined;
  const campaignCondition = campanha && campaignColumn ? normalizedEquals(campaignColumn, 'campanha', campanha) : undefined;
  const processoCondition = processo && processoColumn ? normalizedEquals(processoColumn, 'processo', processo) : undefined;
  const emailCondition = normalizedEquals(emailColumn, 'email', email);
  const credorCondition = credor && credorColumns.length ? normalizedAnyEquals(credorColumns, 'credor', credor) : undefined;
  const base = originCondition ? [originCondition] : [];
  const plans: MatchCondition[][] = [];

  if (campaignCondition && processoCondition && credorCondition) {
    plans.push([...base, campaignCondition, processoCondition, emailCondition, credorCondition]);
  }
  if (processoCondition && credorCondition) {
    plans.push([...base, processoCondition, emailCondition, credorCondition]);
  }
  if (credorCondition) {
    plans.push([...base, emailCondition, credorCondition]);
  }
  if (campaignCondition && processoCondition) {
    plans.push([...base, campaignCondition, processoCondition, emailCondition]);
  }
  if (processoCondition) {
    plans.push([...base, processoCondition, emailCondition]);
  }

  return plans;
}

function normalizedEquals(column: ColumnInfo, paramName: string, value: string): MatchCondition {
  return {
    sql: `${normalizedSql(column)} = @${paramName}`,
    paramName,
    value,
  };
}

function normalizedAnyEquals(columns: ColumnInfo[], paramName: string, value: string): MatchCondition {
  return {
    sql: `(${columns.map((column) => `${normalizedSql(column)} = @${paramName}`).join(' OR ')})`,
    paramName,
    value,
  };
}

function normalizedSql(column: ColumnInfo) {
  return `LOWER(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), ${columnRef(column)}))))`;
}

function buildLogicalUniqueKey(input: BulkGenerateEmailLinksInput, item: EmailLinkInputItem) {
  const origem = normalizeKeyValue(input.origem) ?? 'listmonk';
  const campanha = normalizeKeyValue(input.campanha);
  const processo = normalizeKeyValue(item.processo);
  const email = normalizeKeyValue(item.email);
  const credor = normalizeKeyValue(item.credor_fantasia);

  if (campanha && processo && email && credor) {
    return joinKeyParts({ origem, campanha, processo, email, credor });
  }
  if (processo && email && credor) {
    return joinKeyParts({ origem, processo, email, credor });
  }
  if (email && credor) {
    return joinKeyParts({ origem, email, credor });
  }
  if (campanha && processo && email) {
    return joinKeyParts({ origem, campanha, processo, email });
  }
  if (processo && email) {
    return joinKeyParts({ origem, processo, email });
  }

  return joinKeyParts({ origem, email: email ?? '' });
}

function resolveGrupo(item: EmailLinkInputItem) {
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : undefined;
  return cleanString(item.grupo)
    ?? cleanString(payload?.grupo)
    ?? cleanString(payload?.grupo_credor);
}

function joinKeyParts(parts: Record<string, string>) {
  return Object.entries(parts)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
}

function formatUniqueKeyForColumn(rawUniqueKey: string, column?: ColumnInfo) {
  if (!column || column.maxLength === null || column.maxLength === -1 || rawUniqueKey.length <= column.maxLength) {
    return rawUniqueKey;
  }

  const hash = crypto.createHash('sha256').update(rawUniqueKey).digest('hex');
  const hashed = `sha256:${hash}`;
  if (hashed.length <= column.maxLength) return hashed;

  if (column.maxLength < 32) {
    throw new EmailLinksPublicError('Campo unique_key existe, mas e curto demais para idempotencia segura.');
  }

  return hash.slice(0, column.maxLength);
}

function buildPayloadJson(input: BulkGenerateEmailLinksInput, item: EmailLinkInputItem, rawUniqueKey: string, now: Date) {
  const { payload, ...itemFields } = item;
  return JSON.stringify({
    origem: cleanString(input.origem) ?? 'listmonk',
    campanha: cleanString(input.campanha),
    unique_key: rawUniqueKey,
    item: itemFields,
    payload: payload ?? {},
    generated_by: 'email-links.bulk-generate',
    generated_at: now.toISOString(),
  });
}

function normalizeDestinationUrl(value?: string) {
  const raw = cleanString(value) ?? DEFAULT_DESTINATION_URL;
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new EmailLinksPublicError('url_destino invalida.', 400);
  }

  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'portaldoacordo.com.br') {
    throw new EmailLinksPublicError('url_destino deve usar https://portaldoacordo.com.br.', 400);
  }

  return url.toString();
}

function getPublicApiBaseUrl() {
  const raw = cleanString(process.env.PUBLIC_API_BASE_URL) ?? DEFAULT_PUBLIC_API_BASE_URL;

  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
  } catch {
    console.warn('PUBLIC_API_BASE_URL invalida. Usando URL publica padrao.');
    return DEFAULT_PUBLIC_API_BASE_URL;
  }
}

function buildTrackingLink(publicApiBaseUrl: string, token: string) {
  return `${publicApiBaseUrl}/r/${encodeURIComponent(token)}`;
}

function prefixForCredor(value: unknown) {
  const normalized = normalizeForPrefix(value);
  if (normalized.includes('SISTH')) return 'sisth';
  if (normalized.includes('CONSULTH')) return 'consulth';
  return 'portal';
}

function normalizeForPrefix(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeKeyValue(value: unknown) {
  const text = cleanString(value);
  return text ? text.toLowerCase() : undefined;
}

function cleanString(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function getClientSafeError(error: unknown) {
  if (error instanceof EmailLinksPublicError) return error.message;
  return 'Falha ao gerar link para o item.';
}

function setValue(values: Map<string, ColumnValue>, column: ColumnInfo | undefined, value: unknown) {
  if (!column || value === undefined) return;
  values.set(column.name.toLowerCase(), { column, value });
}

function getColumn(schema: EmailEnviosSchema, ...candidates: string[]) {
  for (const candidate of candidates) {
    const column = schema.columnsByName.get(candidate.toLowerCase());
    if (column) return column;
  }
  return undefined;
}

function getColumns(schema: EmailEnviosSchema, ...candidates: string[]) {
  const found = new Map<string, ColumnInfo>();
  candidates.forEach((candidate) => {
    const column = getColumn(schema, candidate);
    if (column) found.set(column.name.toLowerCase(), column);
  });
  return Array.from(found.values());
}

function requireColumn(schema: EmailEnviosSchema, ...candidates: string[]) {
  const column = getColumn(schema, ...candidates);
  if (!column) throw new EmailLinksPublicError(`Campo obrigatorio nao encontrado: ${candidates.join('/')}.`);
  return column;
}

function addTypedInput(request: sql.Request, paramName: string, column: ColumnInfo, value: unknown) {
  const type = column.dataType;

  if (type === 'bit') {
    request.input(paramName, sql.Bit, Boolean(value));
    return;
  }

  if (isDateType(type)) {
    request.input(paramName, sql.DateTime2, value instanceof Date ? value : new Date(String(value)));
    return;
  }

  const text = value === null || value === undefined ? null : String(value);
  if (text !== null && column.maxLength && column.maxLength > 0 && text.length > column.maxLength) {
    throw new EmailLinksPublicError(`Valor maior que o limite do campo ${column.name}.`);
  }

  request.input(paramName, stringSqlType(column), text);
}

function stringSqlType(column: ColumnInfo) {
  const maxLength = column.maxLength;
  if (!maxLength || maxLength === -1 || maxLength > 4000) return sql.NVarChar(sql.MAX);
  return sql.NVarChar(maxLength);
}

function isDateType(type: string) {
  return ['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'].includes(type);
}

function columnRef(column: ColumnInfo) {
  return quoteIdentifier(column.name);
}

function quoteIdentifier(identifier: string) {
  return `[${identifier.replace(/]/g, ']]')}]`;
}
