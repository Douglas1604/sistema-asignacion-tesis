/**
 * @fileoverview Esquemas de validación del módulo de usuarios.
 */

const { z } = require("zod");
const { idParam, paginacionQuery } = require("./comunes");

/**
 * Parámetro :id de las rutas de usuario.
 * Un valor como "1 OR 1=1" o "abc" no supera la coerción a entero y la
 * petición se rechaza con 422 antes de alcanzar el repositorio.
 */
const usuarioIdParamSchema = z.object({ id: idParam }).strict();

/** Filtros de listado de usuarios. */
const listarUsuariosQuerySchema = paginacionQuery;

module.exports = { usuarioIdParamSchema, listarUsuariosQuerySchema };
