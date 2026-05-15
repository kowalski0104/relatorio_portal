import { NextFunction, Request, Response } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Middleware de autenticação preparado para futura validação.
  // Hoje apenas passa adiante, mas aqui podemos inserir checagem de token,
  // header de API key ou sessão quando necessário.
  next();
}



