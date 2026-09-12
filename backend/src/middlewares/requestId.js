/**
 * @fileoverview Asigna un identificador único a cada petición.
 * Ese identificador viaja en los logs de auditoría y en las respuestas de
 * error, de modo que un usuario puede reportar un fallo con su código y el
 * administrador localiza la traza exacta sin exponer detalles internos.
 */

const { randomUUID } = require("crypto");

/**
 * Genera un UUID v4 criptográficamente aleatorio y lo publica en `req.id` y en
 * la cabecera `X-Request-Id` de la respuesta.
 *
 * @param {import("express").Request} req Petición entrante; recibe la propiedad `id`.
 * @param {import("express").Response} res Respuesta; recibe la cabecera de correlación.
 * @param {import("express").NextFunction} next Continuación de la cadena.
 * @returns {void}
 * @type {import("express").RequestHandler}
 */
function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = requestId;
