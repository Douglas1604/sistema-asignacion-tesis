/**
 * @fileoverview Controladores del módulo de usuarios.
 */

const asyncHandler = require("../utils/asyncHandler");
const UsuariosService = require("../services/usuarios.service");
const { ok } = require("../utils/respuesta");

const UsuariosController = {
  /** GET /usuarios */
  listar: asyncHandler(async (req, res) => {
    const { items, meta } = await UsuariosService.listar(req.validatedQuery);
    res.status(200).json(ok(items, meta));
  }),

  /** GET /usuarios/:id */
  obtener: asyncHandler(async (req, res) => {
    const usuario = await UsuariosService.obtenerPorId(req.params.id);
    res.status(200).json(ok(usuario));
  }),
};

module.exports = UsuariosController;
