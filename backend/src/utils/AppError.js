/**
 * @fileoverview Error de aplicación con código HTTP y código de negocio.
 * Solo los errores creados con esta clase exponen su mensaje al cliente;
 * cualquier otro error se traduce a un 500 genérico para no filtrar detalles
 * internos (SQL, rutas de archivos, stack traces).
 */

class AppError extends Error {
  /**
   * @param {number} statusCode Código HTTP a devolver.
   * @param {string} code Código de negocio estable, en MAYÚSCULAS_CON_GUION_BAJO.
   * @param {string} message Mensaje seguro para mostrar al cliente.
   * @param {object} [details] Detalles adicionales seguros (p. ej. errores de validación).
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Marca que permite al manejador central distinguir errores previstos.
    this.isOperational = true;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(message, details) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "No autenticado") {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "No tienes permisos para esta operación") {
    return new AppError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Recurso no encontrado") {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message) {
    return new AppError(409, "CONFLICT", message);
  }

  static payloadTooLarge(message = "El cuerpo de la petición excede el límite permitido") {
    return new AppError(413, "PAYLOAD_TOO_LARGE", message);
  }

  static unprocessable(message, details) {
    return new AppError(422, "VALIDATION_ERROR", message, details);
  }

  static internal(message = "Error interno del servidor") {
    return new AppError(500, "INTERNAL_ERROR", message);
  }
}

module.exports = AppError;
