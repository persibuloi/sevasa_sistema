const formateador = new Intl.NumberFormat('es-NI', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function monto(valor: string | number | null | undefined): string {
  const n = Number(valor ?? 0);
  return n === 0 ? '—' : formateador.format(n);
}

export function montoSiempre(valor: string | number | null | undefined): string {
  return formateador.format(Number(valor ?? 0));
}
