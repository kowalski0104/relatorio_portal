"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const activeBaseService_1 = require("./services/activeBaseService");
const prismaClients_1 = require("./db/prismaClients");
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const app = (0, app_1.createApp)();
if ((0, prismaClients_1.hasDatabaseConfig)()) {
    (0, activeBaseService_1.startActiveBaseCacheScheduler)();
}
else {
    console.warn('Cache da Base Ativa não iniciado: DATABASE_URL_401 ou DATABASE_URL_1007 não configurada.');
}
app.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Portal do Acordo API rodando em http://${displayHost}:${port}`);
});
//# sourceMappingURL=server.js.map