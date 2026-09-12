/**
 * @fileoverview Asigna un identificador único a cada petición.
 * Ese identificador viaja en los logs de auditoría y en las respuestas de
 * error, de modo que un usuario puede reportar un fallo con su código y el
 * administrador localiza la traza exacta sin exponer detalles internos.
 */

const { randomUUID } = require("crypto");

/** @type {import("express").RequestHandler} */
function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = requestId;
