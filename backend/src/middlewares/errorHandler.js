/**
 * @fileoverview Manejo centralizado de errores.
 *
 * Es el único punto que convierte una excepción en respuesta HTTP. Su regla
 * principal: los errores previstos (AppError) muestran su mensaje; todo lo
 * demás se registra completo en el servidor y se responde con un 500 genérico.
 * Así nunca llegan al cliente sentencias SQL, nombres de columnas ni stacks.
 */

const AppError = require("../utils/AppError");
const { fail } = require("../utils/respuesta");
const logger = require("../config/logger");
const env = require("../config/env");

/** Prefijo de los códigos de error que emite el driver de MySQL. */
const PREFIJOS_ERROR_SQL = ["ER_", "PROTOCOL_", "ECONN"];

/**
 * Indica si el error proviene de la capa de base de datos.
 * @param {Error & {code?: string}} error Error capturado.
 * @returns {boolean}
 */
function esErrorDeBaseDeDatos(error) {
  return (
    typeof error.code === "string" &&
    PREFIJOS_ERROR_SQL.some((prefijo) => error.code.startsWith(prefijo))
  );
}

/**
 * Traduce un error cualquiera al AppError que se devolverá al cliente.
 * @param {Error & {code?: string, status?: number, type?: string}} error Error capturado.
 * @returns {AppError}
 */
function normalizar(error) {
  // El orden de las comprobaciones va de lo más específico a lo más genérico:
  // la última rama actúa como red de seguridad para cualquier caso no previsto.
  if (error instanceof AppError) return error;

  // Cuerpo que supera el límite configurado en express.json().
  if (error.type === "entity.too.large") {
    return AppError.payloadTooLarge();
  }

  // JSON sintácticamente inválido.
  if (error.type === "entity.parse.failed" || error instanceof SyntaxError) {
    return AppError.badRequest("El cuerpo de la petición no es JSON válido");
  }

  // Origen bloqueado por la lista blanca de CORS.
  if (error.code === "CORS_NOT_ALLOWED") {
    return AppError.forbidden("Origen no permitido por la política CORS");
  }

  // Violación de clave única, p. ej. un alumno duplicado.
  if (error.code === "ER_DUP_ENTRY") {
    return AppError.conflict("El registro ya existe");
  }

  // Cualquier otro fallo de base de datos se oculta tras un mensaje neutro:
  // el detalle queda en el log del servidor, no en la respuesta.
  if (esErrorDeBaseDeDatos(error)) {
    return AppError.internal("Error al procesar la solicitud");
  }

  return AppError.internal();
}

/**
 * Middleware final de la cadena de Express.
 *
 * @description Aplica una política de divulgación en dos niveles: el cliente
 * recibe solo código y mensaje seguros junto al `requestId`; el log del servidor
 * conserva el mensaje original y el stack. El `requestId` es el enlace entre
 * ambos mundos cuando un usuario reporta una incidencia.
 *
 * @param {Error} error Excepción propagada con `next(error)` o lanzada en un handler.
 * @param {import("express").Request} req Petición que originó el error.
 * @param {import("express").Response} res Respuesta a emitir.
 * @param {import("express").NextFunction} next No se usa, pero su presencia es obligatoria.
 * @returns {void}
 * @type {import("express").ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars -- Express identifica el manejador de errores por sus 4 parámetros.
function errorHandler(error, req, res, next) {
  const appError = normalizar(error);

  const contexto = {
    requestId: req.id,
    metodo: req.method,
    ruta: req.originalUrl,
    estado: appError.statusCode,
    codigo: appError.code,
    usuarioId: req.user ? req.user.id : null,
    ip: req.ip,
  };

  if (appError.statusCode >= 500) {
    // Solo en el log del servidor guardamos el detalle real y el stack.
    logger.error("error_no_controlado", {
      ...contexto,
      mensajeOriginal: error.message,
      codigoOriginal: error.code,
      stack: env.isProduction ? undefined : error.stack,
    });
  } else {
    logger.warn("error_de_peticion", { ...contexto, mensaje: appError.message });
  }

  res
    .status(appError.statusCode)
    .json(fail(appError.code, appError.message, appError.details, req.id));
}

/**
 * Captura las rutas no registradas y las encamina como 404 al manejador central.
 * @type {import("express").RequestHandler}
 */
function notFoundHandler(req, res, next) {
  next(AppError.notFound("La ruta solicitada no existe"));
}

module.exports = { errorHandler, notFoundHandler };
