/**
 * @fileoverview Aleatoriedad criptográficamente segura para decisiones del sorteo.
 *
 * `Math.random()` NO es apto para decidir un resultado oficial: su generador
 * (xorshift128+ en V8) no es criptográfico, su estado interno puede
 * reconstruirse a partir de unas pocas salidas observadas y la especificación
 * no garantiza su calidad. Toda decisión que asigne a una persona (catedrático
 * o alumno) debe salir de la Web Crypto API, que obtiene la entropía del
 * generador seguro del sistema operativo (CSPRNG).
 *
 * Este módulo no conoce Angular ni el DOM: es lógica pura y testeable.
 */

/** Número de valores distintos que produce un `Uint32`: 2^32. */
const RANGO_UINT32 = 0x1_0000_0000;

/**
 * Devuelve la implementación de Web Crypto disponible.
 *
 * @description Se usa `globalThis.crypto` (equivalente a `window.crypto` en el
 * navegador) para que funcione igual en la aplicación y en las pruebas.
 * `getRandomValues` está disponible también fuera de contextos seguros (a
 * diferencia de `crypto.subtle` o `randomUUID`).
 *
 * @returns Objeto `Crypto` del entorno.
 * @throws {Error} Si el entorno no ofrece Web Crypto. No se recurre a
 *   `Math.random()` como alternativa: un sorteo oficial debe fallar de forma
 *   visible antes que decidirse con un generador inseguro.
 */
function obtenerCrypto(): Crypto {
  const cryptoGlobal = globalThis.crypto;
  if (!cryptoGlobal || typeof cryptoGlobal.getRandomValues !== 'function') {
    throw new Error('Web Crypto API no disponible: no es posible realizar un sorteo seguro.');
  }
  return cryptoGlobal;
}

/**
 * Obtiene un entero uniforme en el intervalo cerrado [min, max] usando
 * `crypto.getRandomValues(new Uint32Array(1))`.
 *
 * @description Sesgo de módulo y muestreo por rechazo. Un `Uint32` toma 2^32
 * valores equiprobables. Reducirlo con `valor % n` solo es uniforme si n
 * divide exactamente a 2^32; en caso contrario los primeros `2^32 mod n`
 * resultados aparecen una vez más que el resto. Ejemplo con n = 3:
 * 2^32 = 3·1431655765 + 1, así que el 0 tendría 1431655766 casos y el 1 y el 2
 * solo 1431655765.
 *
 * Para eliminarlo se calcula `limite = 2^32 − (2^32 mod n)`, el mayor múltiplo
 * de n que cabe en 32 bits, y se descarta (se vuelve a extraer) cualquier valor
 * `>= limite`. Los valores aceptados, en [0, limite), se reparten en bloques
 * completos de tamaño n, de modo que `valor % n` es exactamente uniforme.
 * La probabilidad de rechazo es `(2^32 mod n) / 2^32 < n / 2^32`: para una
 * ruleta de cientos de participantes, prácticamente nula; el número esperado
 * de extracciones es siempre menor que 2.
 *
 * @param min Cota inferior, incluida. Entero seguro.
 * @param max Cota superior, incluida. Entero seguro, `max >= min`.
 * @returns Entero en [min, max] con probabilidad 1 / (max − min + 1) cada uno.
 * @throws {RangeError} Si las cotas no son enteros seguros, `min > max` o el
 *   intervalo tiene más de 2^32 valores.
 * @throws {Error} Si el entorno no ofrece Web Crypto.
 */
export function obtenerEnteroAleatorio(min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new RangeError('Las cotas del sorteo deben ser enteros.');
  }
  if (min > max) {
    throw new RangeError('La cota mínima no puede superar a la máxima.');
  }

  const cantidad = max - min + 1;
  if (cantidad > RANGO_UINT32) {
    throw new RangeError('El intervalo supera los 2^32 valores admitidos.');
  }

  // Un único valor posible: no hay nada que sortear ni entropía que consumir.
  if (cantidad === 1) {
    return min;
  }

  const cryptoSeguro = obtenerCrypto();
  const limite = RANGO_UINT32 - (RANGO_UINT32 % cantidad);
  const muestra = new Uint32Array(1);

  // Bucle de rechazo: termina con probabilidad 1 (cada vuelta acepta con
  // probabilidad > 1/2).
  for (;;) {
    cryptoSeguro.getRandomValues(muestra);
    const valor = muestra[0];
    if (valor < limite) {
      return min + (valor % cantidad);
    }
  }
}

/**
 * Elige de forma segura un índice válido de una colección de `total` elementos.
 *
 * @param total Número de elementos (entero >= 1).
 * @returns Índice uniforme en [0, total − 1].
 * @throws {RangeError} Si `total` no es un entero positivo.
 */
export function obtenerIndiceAleatorio(total: number): number {
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new RangeError('No se puede sortear sobre una colección vacía.');
  }
  return obtenerEnteroAleatorio(0, total - 1);
}
