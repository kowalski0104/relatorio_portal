"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
function authMiddleware(req, res, next) {
    // Middleware de autenticação preparado para futura validação.
    // Hoje apenas passa adiante, mas aqui podemos inserir checagem de token,
    // header de API key ou sessão quando necessário.
    next();
}
//# sourceMappingURL=auth.js.map