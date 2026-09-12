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
    // Excluye el propio constructor de la traza, de modo que el stack apunte
    // a la línea de negocio que originó el error y no a esta clase.
    Error.captureStackTrace(this, AppError);
  }

  // Los métodos estáticos siguientes son fábricas con nombre semántico: el
  // código de negocio expresa la intención (`AppError.notFound(...)`) y no
  // necesita memorizar ni repetir la pareja código HTTP / código de negocio.

  /**
   * @param {string} message Mensaje seguro para el cliente.
   * @param {object} [details] Detalles adicionales.
   * @returns {AppError} Error 400 BAD_REQUEST: petición sintácticamente incorrecta.
   */
  static badRequest(message, details) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  /**
   * @param {string} [message] Mensaje seguro para el cliente.
   * @returns {AppError} Error 401 UNAUTHORIZED: credencial ausente o inválida.
   */
  static unauthorized(message = "No autenticado") {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  /**
   * @param {string} [message] Mensaje seguro para el cliente.
   * @returns {AppError} Error 403 FORBIDDEN: identidad conocida pero sin permiso.
   */
  static forbidden(message = "No tienes permisos para esta operación") {
    return new AppError(403, "FORBIDDEN", message);
  }

  /**
   * @param {string} [message] Mensaje seguro para el cliente.
   * @returns {AppError} Error 404 NOT_FOUND: el recurso solicitado no existe.
   */
  static notFound(message = "Recurso no encontrado") {
    return new AppError(404, "NOT_FOUND", message);
  }

  /**
   * @param {string} message Mensaje seguro para el cliente.
   * @returns {AppError} Error 409 CONFLICT: colisión con el estado actual (clave única).
   */
  static conflict(message) {
    return new AppError(409, "CONFLICT", message);
  }

  /**
   * @param {string} [message] Mensaje seguro para el cliente.
   * @returns {AppError} Error 413 PAYLOAD_TOO_LARGE: cuerpo por encima del límite.
   */
  static payloadTooLarge(message = "El cuerpo de la petición excede el límite permitido") {
    return new AppError(413, "PAYLOAD_TOO_LARGE", message);
  }

  /**
   * @param {string} message Mensaje seguro para el cliente.
   * @param {Array<{campo: string, mensaje: string}>} [details] Problemas por campo.
   * @returns {AppError} Error 422 VALIDATION_ERROR: forma correcta, contenido inválido.
   */
  static unprocessable(message, details) {
    return new AppError(422, "VALIDATION_ERROR", message, details);
  }

  /**
   * @param {string} [message] Mensaje genérico; nunca debe incluir el error real.
   * @returns {AppError} Error 500 INTERNAL_ERROR.
   */
  static internal(message = "Error interno del servidor") {
    return new AppError(500, "INTERNAL_ERROR", message);
  }
}

module.exports = AppError;
