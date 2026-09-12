/**
 * @fileoverview Esquemas de validación del módulo de usuarios.
 */

const { z } = require("zod");
const { idParam, paginacionQuery } = require("./comunes");

/** Parámetro :id de las rutas de usuario. */
const usuarioIdParamSchema = z.object({ id: idParam }).strict();

/** Filtros de listado de usuarios. */
const listarUsuariosQuerySchema = paginacionQuery;

module.exports = { usuarioIdParamSchema, listarUsuariosQuerySchema };
