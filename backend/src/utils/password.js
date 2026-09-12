/**
 * @fileoverview Manejo de contraseñas con bcrypt.
 * Regla inquebrantable: la contraseña en claro nunca se compara con `=` contra
 * lo almacenado; siempre se verifica con bcrypt.compare, que además es de
 * tiempo constante frente a ataques de temporización.
 */

const bcrypt = require("bcryptjs");
const env = require("../config/env");

/** Prefijos válidos de un hash bcrypt. */
const PREFIJOS_BCRYPT = ["$2a$", "$2b$", "$2y$"];

/**
 * Indica si el valor almacenado tiene realmente formato de hash bcrypt.
 * Sirve para detectar contraseñas heredadas en texto plano sin exponerlas.
 * @param {string} valor Contenido de la columna password_hash.
 * @returns {boolean}
 */
function esHashBcrypt(valor) {
  return (
    typeof valor === "string" &&
    valor.length === 60 &&
    PREFIJOS_BCRYPT.some((prefijo) => valor.startsWith(prefijo))
  );
}

/**
 * Genera el hash de una contraseña nueva.
 *
 * @description bcrypt genera internamente una sal aleatoria de 128 bits y la
 * incrusta en el resultado junto al factor de coste, con el formato
 * `$2b$<coste>$<sal 22 car.><hash 31 car.>` (60 caracteres). El coste es
 * logarítmico: `BCRYPT_ROUNDS = 12` implica 2^12 = 4096 iteraciones de la
 * expansión de clave, y cada unidad adicional duplica el tiempo de cálculo.
 *
 * @param {string} plano Contraseña en claro.
 * @returns {Promise<string>} Hash bcrypt.
 */
async function hashPassword(plano) {
  return bcrypt.hash(plano, env.BCRYPT_ROUNDS);
}

/**
 * Verifica una contraseña contra el hash almacenado.
 *
 * Si el valor guardado NO es un hash bcrypt (registro heredado en texto plano),
 * devolvemos `false` sin compararlo: aceptarlo reintroduciría exactamente la
 * vulnerabilidad que estamos corrigiendo. Esos usuarios deben migrarse con
 * `npm run migrate:passwords`.
 *
 * @param {string} plano Contraseña enviada por el usuario.
 * @param {string} hashAlmacenado Valor de la columna password_hash.
 * @returns {Promise<boolean>} true solo si la contraseña es correcta.
 */
async function verificarPassword(plano, hashAlmacenado) {
  if (!esHashBcrypt(hashAlmacenado)) {
    return false;
  }
  // `compare` no "descifra" nada: extrae la sal y el coste del hash almacenado,
  // vuelve a calcular el hash de la contraseña recibida con esos mismos
  // parámetros y compara ambos resultados.
  return bcrypt.compare(plano, hashAlmacenado);
}

module.exports = { hashPassword, verificarPassword, esHashBcrypt };
