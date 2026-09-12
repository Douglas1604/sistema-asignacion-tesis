/**
 * @fileoverview Constructores del formato de respuesta único de la API.
 * Todo endpoint responde con la misma envoltura para que el frontend pueda
 * tratar éxitos y errores de forma homogénea.
 */

/**
 * Respuesta exitosa.
 * @param {*} data Carga útil ya convertida a DTO (nunca filas crudas de la BD).
 * @param {object} [meta] Metadatos opcionales (total, paginación...).
 * @returns {{success: true, data: *, meta?: object}} Envoltura de éxito.
 */
function ok(data, meta) {
  const cuerpo = { success: true, data };
  if (meta !== undefined) cuerpo.meta = meta;
  return cuerpo;
}

/**
 * Respuesta de error.
 * @param {string} code Código de negocio estable.
 * @param {string} message Mensaje seguro para el cliente.
 * @param {object} [details] Detalles de validación seguros.
 * @param {string} [requestId] Identificador de la petición, para cruzar con los logs.
 * @returns {{success: false, error: {code: string, message: string, details?: object, requestId?: string}}}
 * Envoltura de error.
 */
function fail(code, message, details, requestId) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  if (requestId !== undefined) error.requestId = requestId;
  return { success: false, error };
}

module.exports = { ok, fail };
