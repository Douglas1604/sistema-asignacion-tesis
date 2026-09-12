/**
 * @fileoverview Envoltura para controladores asíncronos.
 * Captura cualquier promesa rechazada y la deriva al manejador central de
 * errores, evitando repetir try/catch en cada controlador.
 */

/**
 * @param {Function} fn Controlador async (req, res, next).
 * @returns {Function} Middleware de Express con el rechazo ya encaminado a next().
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
