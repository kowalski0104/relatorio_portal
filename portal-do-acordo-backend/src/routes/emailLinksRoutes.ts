import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import {
  bulkGenerateEmailLinks,
  DEFAULT_DESTINATION_URL,
  EmailLinksPublicError,
} from '../services/emailLinksService';

const router = Router();
const MAX_ITEMS_PER_REQUEST = 1000;

const optionalTextSchema = z.union([z.string(), z.number(), z.boolean()])
  .optional()
  .nullable()
  .transform((value) => {
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text || undefined;
  });

const payloadItemSchema = z.object({
  processo: optionalTextSchema,
  email: z.string().trim().email('email invalido'),
  grupo: optionalTextSchema,
  devedor_razao: optionalTextSchema,
  devedor_cnpj: optionalTextSchema,
  credor_fantasia: optionalTextSchema,
  titulos_aberto_total: optionalTextSchema,
  campanha: optionalTextSchema,
  template: optionalTextSchema,
  payload: z.record(z.unknown()).optional(),
}).passthrough();

const bulkGenerateSchema = z.object({
  origem: optionalTextSchema.default('listmonk'),
  campanha: optionalTextSchema,
  url_destino: optionalTextSchema.default(DEFAULT_DESTINATION_URL),
  items: z.array(payloadItemSchema)
    .min(1, 'items deve conter pelo menos um item')
    .max(MAX_ITEMS_PER_REQUEST, `items deve conter no maximo ${MAX_ITEMS_PER_REQUEST} itens`),
});

router.post('/bulk-generate', async (req: Request, res: Response) => {
  const authResult = validateApiKey(req);
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error });
  }

  const parseResult = bulkGenerateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      error: 'Payload invalido.',
      issues: parseResult.error.format(),
    });
  }

  try {
    const result = await bulkGenerateEmailLinks({
      origem: parseResult.data.origem ?? 'listmonk',
      campanha: parseResult.data.campanha,
      url_destino: parseResult.data.url_destino,
      items: parseResult.data.items,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof EmailLinksPublicError) {
      if (error.statusCode >= 500) {
        console.error('Erro no endpoint email-links/bulk-generate', { message: error.message });
      }
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }

    console.error('Erro no endpoint email-links/bulk-generate', {
      message: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({ success: false, error: 'Erro ao gerar links de rastreamento.' });
  }
});

function validateApiKey(req: Request) {
  const expectedKey = process.env.EMAIL_LINKS_API_KEY;

  if (!expectedKey) {
    if (isLocalRequest(req)) return { ok: true as const };
    return {
      ok: false as const,
      status: 503,
      error: 'EMAIL_LINKS_API_KEY nao configurada para chamadas remotas.',
    };
  }

  const providedKey = req.get('x-api-key') ?? '';
  if (!constantTimeEquals(providedKey, expectedKey)) {
    return { ok: false as const, status: 401, error: 'Nao autorizado.' };
  }

  return { ok: true as const };
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isLocalRequest(req: Request) {
  const candidates = [
    req.ip,
    req.socket.remoteAddress,
    req.headers.host,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  return candidates.some((value) =>
    value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1'
    || value.startsWith('localhost')
    || value.startsWith('127.0.0.1:')
  );
}

export default router;
