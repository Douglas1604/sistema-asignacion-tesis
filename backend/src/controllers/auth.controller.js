/**
 * @fileoverview Controladores de autenticación.
 * Solo traducen HTTP a llamadas de servicio y de vuelta: nada de reglas de
 * negocio ni de SQL en esta capa.
 */

const asyncHandler = require("../utils/asyncHandler");
const AuthService = require("../services/auth.service");
const { ok } = require("../utils/respuesta");

const AuthController = {
  /**
   * POST /auth/login
   *
   * @description Recibe credenciales ya validadas y normalizadas por
   * `validate(loginSchema)` y delega la autenticación en el servicio. La IP y
   * el `requestId` se pasan como contexto de auditoría, no como datos de negocio.
   *
   * @param {import("express").Request} req Cuerpo `{email, password}` saneado.
   * @param {import("express").Response} res Responde 200 con `{token, expiresIn, user}`.
   * @returns {Promise<void>}
   * @throws {AppError} 401 si las credenciales son incorrectas (capturado por asyncHandler).
   */
  login: asyncHandler(async (req, res) => {
    const resultado = await AuthService.login(req.body, {
      ip: req.ip,
      requestId: req.id,
    });
    res.status(200).json(ok(resultado));
  }),

  /**
   * GET /auth/me
   *
   * @param {import("express").Request} req Petición con `req.user` poblado por `requireAuth`.
   * @param {import("express").Response} res Responde 200 con el perfil actual.
   * @returns {Promise<void>}
   * @throws {AppError} 401 si la cuenta del token ya no existe.
   */
  me: asyncHandler(async (req, res) => {
    const usuario = await AuthService.perfil(req.user.id);
    res.status(200).json(ok(usuario));
  }),
};

module.exports = AuthController;
