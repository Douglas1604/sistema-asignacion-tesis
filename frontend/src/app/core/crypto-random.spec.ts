/**
 * @fileoverview Pruebas de la aleatoriedad criptográfica del sorteo.
 *
 * Cubren tres propiedades: (1) el resultado siempre respeta las cotas,
 * (2) la entropía procede de Web Crypto y no de Math.random, y (3) no hay sesgo
 * de módulo: el muestreo por rechazo se verifica de forma determinista con una
 * fuente simulada y la uniformidad global con una prueba chi-cuadrado.
 */

import { obtenerEnteroAleatorio, obtenerIndiceAleatorio } from './crypto-random';

/** 2^32: número de valores de un Uint32. */
const RANGO_UINT32 = 2 ** 32;

/**
 * Sustituye `crypto.getRandomValues` por una secuencia controlada de Uint32.
 * @param valores Valores que se entregarán, en orden.
 * @returns El espía, para consultar cuántas extracciones hubo.
 */
function simularFuente(valores: number[]) {
  const pendientes = [...valores];
  return vi
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView | null>(destino: T): T => {
      if (pendientes.length === 0) throw new Error('secuencia simulada agotada');
      (destino as unknown as Uint32Array)[0] = pendientes.shift()!;
      return destino;
    });
}

describe('obtenerEnteroAleatorio', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('respeta siempre las cotas, incluidas ambas', () => {
    const vistos = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const n = obtenerEnteroAleatorio(3, 7);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      vistos.add(n);
    }
    // Con 5000 extracciones sobre 5 valores, todos deben aparecer.
    expect([...vistos].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('admite intervalos con negativos y el intervalo de un solo valor', () => {
    for (let i = 0; i < 1000; i++) {
      const n = obtenerEnteroAleatorio(-2, 2);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(2);
    }
    expect(obtenerEnteroAleatorio(9, 9)).toBe(9);
  });

  it('las cotas extremas de la fuente se proyectan dentro del intervalo', () => {
    // 0 es aceptado siempre; 2^32 - 1 es aceptado cuando n divide a 2^32.
    simularFuente([0, RANGO_UINT32 - 1]);
    expect(obtenerEnteroAleatorio(10, 17)).toBe(10);
    expect(obtenerEnteroAleatorio(10, 17)).toBe(17);
  });

  it('obtiene la entropía de Web Crypto y no de Math.random', () => {
    const espiaCrypto = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const espiaMath = vi.spyOn(Math, 'random');

    obtenerEnteroAleatorio(0, 99);

    expect(espiaCrypto).toHaveBeenCalled();
    expect(espiaCrypto.mock.calls[0][0]).toBeInstanceOf(Uint32Array);
    expect(espiaMath).not.toHaveBeenCalled();
  });

  it('rechaza los valores de la zona sesgada (muestreo por rechazo)', () => {
    // n = 3: 2^32 mod 3 = 1, así que el límite es 2^32 - 1 y el único valor
    // sesgado es 2^32 - 1. Un módulo ingenuo lo convertiría en 0.
    const espia = simularFuente([RANGO_UINT32 - 1, 5]);

    const resultado = obtenerEnteroAleatorio(0, 2);

    expect(espia).toHaveBeenCalledTimes(2);
    expect(resultado).toBe(5 % 3);
  });

  it('rechaza toda la zona sesgada de un intervalo con residuo grande', () => {
    // n = 10: 2^32 mod 10 = 6 -> se rechazan los 6 valores superiores.
    const limite = RANGO_UINT32 - (RANGO_UINT32 % 10);
    const sesgados = [limite, limite + 1, limite + 5];
    const espia = simularFuente([...sesgados, limite - 1]);

    const resultado = obtenerEnteroAleatorio(1, 10);

    expect(espia).toHaveBeenCalledTimes(4);
    expect(resultado).toBe(1 + ((limite - 1) % 10));
  });

  it('distribuye uniformemente (chi-cuadrado)', () => {
    const categorias = 6;
    const extracciones = 60000;
    const frecuencias = new Array<number>(categorias).fill(0);

    for (let i = 0; i < extracciones; i++) {
      frecuencias[obtenerEnteroAleatorio(0, categorias - 1)]++;
    }

    const esperado = extracciones / categorias;
    const chiCuadrado = frecuencias.reduce(
      (suma, observado) => suma + (observado - esperado) ** 2 / esperado,
      0,
    );

    // 5 grados de libertad: P(chi2 > 40) ~ 1.5e-7. Un generador uniforme casi
    // nunca lo supera; uno sesgado (p. ej. siempre el mismo valor) da ~300000.
    expect(chiCuadrado).toBeLessThan(40);
    // Además ninguna categoría se aleja más de un 5 % de su frecuencia esperada.
    for (const observado of frecuencias) {
      expect(Math.abs(observado - esperado) / esperado).toBeLessThan(0.05);
    }
  });

  it('rechaza cotas inválidas', () => {
    expect(() => obtenerEnteroAleatorio(5, 1)).toThrow(RangeError);
    expect(() => obtenerEnteroAleatorio(0.5, 3)).toThrow(RangeError);
    expect(() => obtenerEnteroAleatorio(0, Number.NaN)).toThrow(RangeError);
    expect(() => obtenerEnteroAleatorio(0, RANGO_UINT32)).toThrow(RangeError);
  });

  it('falla de forma explícita si no hay Web Crypto, sin degradar a Math.random', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const espiaMath = vi.spyOn(Math, 'random');
    try {
      expect(() => obtenerEnteroAleatorio(0, 10)).toThrow(/Web Crypto/);
      expect(espiaMath).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('obtenerIndiceAleatorio', () => {
  it('devuelve índices válidos de la colección', () => {
    for (let i = 0; i < 2000; i++) {
      const indice = obtenerIndiceAleatorio(4);
      expect(indice).toBeGreaterThanOrEqual(0);
      expect(indice).toBeLessThan(4);
    }
    expect(obtenerIndiceAleatorio(1)).toBe(0);
  });

  it('rechaza colecciones vacías', () => {
    expect(() => obtenerIndiceAleatorio(0)).toThrow(RangeError);
  });
});
