/**
 * @fileoverview Envoltura para controladores asíncronos.
 * Captura cualquier promesa rechazada y la deriva al manejador central de
 * errores, evitando repetir try/catch en cada controlador.
 */

/**
 * @description `Promise.resolve` normaliza el resultado del controlador: si
 * devuelve una promesa rechazada o lanza dentro de una función async, el
 * `.catch(next)` entrega la excepción al manejador central de errores.
 * Express 5 ya propaga por sí mismo los rechazos de promesas; el envoltorio se
 * conserva para dejar el contrato explícito e independiente de la versión.
 *
 * @param {Function} fn Controlador async (req, res, next).
 * @returns {Function} Middleware de Express con el rechazo ya encaminado a next().
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
