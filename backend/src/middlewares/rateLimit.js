/**
 * @fileoverview Limitadores de tasa.
 *
 * Se aplican dos niveles: uno general que amortigua el abuso de la API y otro
 * mucho más estricto sobre el login, que es el objetivo natural de un ataque
 * de fuerza bruta sobre contraseñas.
 */

const rateLimit = require("express-rate-limit");
const env = require("../config/env");
const { fail } = require("../utils/respuesta");
const logger = require("../config/logger");

/**
 * Respuesta unificada al superar un límite, en el mismo formato que el resto
 * de errores de la API.
 * @param {string} accionAuditoria Etiqueta del evento para la pista de auditoría.
 * @returns {import("express").RequestHandler}
 */
function manejarExceso(accionAuditoria) {
  return (req, res) => {
    logger.auditoria({
      accion: accionAuditoria,
      recurso: req.originalUrl,
      requestId: req.id,
      ip: req.ip,
    });
    res
      .status(429)
      .json(
        fail(
          "RATE_LIMIT_EXCEEDED",
          "Demasiadas peticiones. Intenta de nuevo más tarde.",
          undefined,
          req.id
        )
      );
  };
}

/** Limitador general de toda la API. */
const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // En los tests el límite estorbaría a las aserciones funcionales.
  skip: () => env.isTest,
  handler: manejarExceso("RATE_LIMIT_API"),
});

/** Limitador estricto para el inicio de sesión. */
const loginLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Un login correcto no debe consumir el cupo de intentos fallidos.
  skipSuccessfulRequests: true,
  skip: () => env.isTest,
  handler: manejarExceso("RATE_LIMIT_LOGIN"),
});

module.exports = { apiLimiter, loginLimiter };
