"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
function errorHandler(err, req, res, next) {
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({ error: 'Validação de entrada falhou', issues: err.format() });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno do servidor' });
}
//# sourceMappingURL=errorHandler.js.map