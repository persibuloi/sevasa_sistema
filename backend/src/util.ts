import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Envuelve un handler async para que sus errores lleguen al middleware de errores. */
export function envolver(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Convierte un monto a centavos enteros (evita errores de flotantes al sumar). */
export function aCentavos(monto: unknown): number {
  const n = Number(monto ?? 0);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}
