import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validação de entrada falhou', issues: err.format() });
  }

  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}



