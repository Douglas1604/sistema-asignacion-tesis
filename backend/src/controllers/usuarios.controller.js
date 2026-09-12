/**
 * @fileoverview Controladores del módulo de usuarios.
 */

const asyncHandler = require("../utils/asyncHandler");
const UsuariosService = require("../services/usuarios.service");
const { ok } = require("../utils/respuesta");

const UsuariosController = {
  /**
   * GET /usuarios
   * @param {import("express").Request} req Usa `req.validatedQuery` ({pagina, limite}).
   * @param {import("express").Response} res Responde 200 con la lista paginada de DTOs.
   * @returns {Promise<void>}
   */
  listar: asyncHandler(async (req, res) => {
    const { items, meta } = await UsuariosService.listar(req.validatedQuery);
    res.status(200).json(ok(items, meta));
  }),

  /**
   * GET /usuarios/:id
   * @param {import("express").Request} req `req.params.id` ya convertido a entero positivo por Zod.
   * @param {import("express").Response} res Responde 200 con el DTO del usuario.
   * @returns {Promise<void>}
   * @throws {AppError} 404 si el usuario no existe.
   */
  obtener: asyncHandler(async (req, res) => {
    const usuario = await UsuariosService.obtenerPorId(req.params.id);
    res.status(200).json(ok(usuario));
  }),
};

module.exports = UsuariosController;
