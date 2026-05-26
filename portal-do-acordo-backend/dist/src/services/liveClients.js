import { PrismaClient } from '@prisma/client';
import { getSistemaIds } from './shared';
const clientsByEmpresa = {
    401: new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_401 } } }),
    1007: new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_1007 } } }),
};
export function getLiveClients(sistema) {
    return getSistemaIds(sistema).map((empresaId) => ({
        empresaId,
        prisma: clientsByEmpresa[empresaId],
    }));
}
//# sourceMappingURL=liveClients.js.map