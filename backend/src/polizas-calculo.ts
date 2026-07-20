/** Prorrateo de una póliza de importación (función pura, en centavos enteros).
 *  El costo puesto en bodega de cada producto = su FOB + su parte de los gastos
 *  no recuperables. El IVA de importación se acumula aparte (acreditable). */

export interface LineaCalc {
  cantidad: number;
  fobUnitario: number; // en la moneda de la póliza
  peso: number;        // peso total de la línea
}

export interface GastoCalc {
  montoCent: number;   // en NIO (centavos)
  base: 'valor' | 'peso' | 'unidades';
  esIva: boolean;
}

export interface ResultadoProrrateo {
  fobCent: number;                       // FOB total en NIO
  gastosCent: number;                    // gastos NO IVA (van al costo)
  ivaCent: number;                       // IVA acreditable
  totalInventarioCent: number;           // FOB + gastos no-IVA
  porLinea: Array<{ fobCent: number; prorrateoCent: number; totalCent: number }>;
}

/** Reparte `montoCent` entre líneas según `pesos`, con centavos exactos:
 *  piso proporcional + el sobrante va a las líneas de mayor resto. */
function repartir(montoCent: number, pesos: number[]): number[] {
  const n = pesos.length;
  const sumaPesos = pesos.reduce((s, p) => s + p, 0);
  if (n === 0 || montoCent === 0) return new Array(n).fill(0);
  // Sin base (todos los pesos en cero) → reparto parejo
  const base = sumaPesos > 0 ? pesos : new Array(n).fill(1);
  const suma = sumaPesos > 0 ? sumaPesos : n;
  const exactos = base.map((p) => (montoCent * p) / suma);
  const pisos = exactos.map(Math.floor);
  let restante = montoCent - pisos.reduce((s, v) => s + v, 0);
  const orden = exactos
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto);
  const res = [...pisos];
  for (let k = 0; k < restante; k++) res[orden[k % n]!.i]! += 1;
  return res;
}

export function prorratear(
  lineas: LineaCalc[],
  gastos: GastoCalc[],
  tipoCambio: number
): ResultadoProrrateo {
  const fobLinea = lineas.map((l) => Math.round(l.cantidad * l.fobUnitario * tipoCambio * 100));
  const prorrateoLinea = new Array(lineas.length).fill(0);
  let ivaCent = 0;
  let gastosCent = 0;

  for (const g of gastos) {
    if (g.esIva) {
      ivaCent += g.montoCent;
      continue;
    }
    gastosCent += g.montoCent;
    const pesos = lineas.map((l, i) =>
      g.base === 'peso' ? l.peso : g.base === 'unidades' ? l.cantidad : fobLinea[i]! / 100
    );
    const reparto = repartir(g.montoCent, pesos);
    for (let i = 0; i < lineas.length; i++) prorrateoLinea[i] += reparto[i]!;
  }

  const porLinea = lineas.map((_, i) => ({
    fobCent: fobLinea[i]!,
    prorrateoCent: prorrateoLinea[i]!,
    totalCent: fobLinea[i]! + prorrateoLinea[i]!,
  }));

  return {
    fobCent: fobLinea.reduce((s, v) => s + v, 0),
    gastosCent,
    ivaCent,
    totalInventarioCent: porLinea.reduce((s, l) => s + l.totalCent, 0),
    porLinea,
  };
}
