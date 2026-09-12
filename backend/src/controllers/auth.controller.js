/**
 * @fileoverview Controladores de autenticación.
 * Solo traducen HTTP a llamadas de servicio y de vuelta: nada de reglas de
 * negocio ni de SQL en esta capa.
 */

const asyncHandler = require("../utils/asyncHandler");
const AuthService = require("../services/auth.service");
const { ok } = require("../utils/respuesta");

const AuthController = {
  /** POST /auth/login */
  login: asyncHandler(async (req, res) => {
    const resultado = await AuthService.login(req.body, {
      ip: req.ip,
      requestId: req.id,
    });
    res.status(200).json(ok(resultado));
  }),

  /** GET /auth/me */
  me: asyncHandler(async (req, res) => {
    const usuario = await AuthService.perfil(req.user.id);
    res.status(200).json(ok(usuario));
  }),
};

module.exports = AuthController;
