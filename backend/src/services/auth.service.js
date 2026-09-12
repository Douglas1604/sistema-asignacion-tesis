/**
 * @fileoverview Reglas de negocio de autenticación.
 * Emite y valida los JWT y aplica la política de credenciales.
 */

const jwt = require("jsonwebtoken");
const env = require("../config/env");
const AppError = require("../utils/AppError");
const logger = require("../config/logger");
const { verificarPassword } = require("../utils/password");
const UsuariosRepository = require("../repositories/usuarios.repository");
const { aUsuarioDTO } = require("../dtos/usuario.dto");

/**
 * Firma el token de acceso del usuario.
 * El payload lleva solo lo imprescindible para autorizar: nunca datos sensibles.
 * @param {object} usuario Fila de usuario con su rol.
 * @returns {string} JWT firmado.
 */
function firmarToken(usuario) {
  return jwt.sign(
    {
      sub: String(usuario.id),
      email: usuario.email,
      rol: usuario.rol_nombre || null,
      rol_id: usuario.rol_id,
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
    }
  );
}

/**
 * Verifica un token de acceso.
 * @param {string} token JWT recibido en la cabecera Authorization.
 * @returns {object} Payload decodificado.
 * @throws {AppError} 401 si está expirado, mal firmado o es de otro emisor.
 */
function verificarToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: env.JWT_ISSUER });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw AppError.unauthorized("La sesión ha expirado, inicia sesión de nuevo");
    }
    throw AppError.unauthorized("Token inválido");
  }
}

const AuthService = {
  /**
   * Valida credenciales y devuelve el token de acceso.
   *
   * Siempre responde con el mismo mensaje genérico tanto si el correo no
   * existe como si la contraseña es incorrecta, para no revelar qué cuentas
   * están dadas de alta (enumeración de usuarios).
   *
   * @param {{email: string, password: string}} credenciales
   * @param {{ip?: string, requestId?: string}} [contexto] Datos para la pista de auditoría.
   * @returns {Promise<{token: string, expiresIn: string, user: object}>}
   * @throws {AppError} 401 si las credenciales no son válidas.
   */
  async login({ email, password }, contexto = {}) {
    const usuario = await UsuariosRepository.buscarPorEmailConHash(email);

    const credencialesValidas =
      usuario !== null && (await verificarPassword(password, usuario.password_hash));

    if (!credencialesValidas) {
      logger.auditoria({
        accion: "LOGIN_FALLIDO",
        usuarioId: usuario ? usuario.id : null,
        recurso: "auth",
        detalles: { email },
        ...contexto,
      });
      throw AppError.unauthorized("Correo o contraseña incorrectos");
    }

    logger.auditoria({
      accion: "LOGIN_EXITOSO",
      usuarioId: usuario.id,
      recurso: "auth",
      detalles: { email: usuario.email, rol: usuario.rol_nombre },
      ...contexto,
    });

    return {
      token: firmarToken(usuario),
      expiresIn: env.JWT_EXPIRES_IN,
      user: aUsuarioDTO(usuario),
    };
  },

  /**
   * Devuelve el perfil del usuario autenticado, releyéndolo de la base de datos
   * para que un token emitido antes de un cambio de rol no conserve permisos viejos.
   * @param {number} usuarioId Identificador extraído del token.
   * @returns {Promise<object>} DTO de usuario.
   * @throws {AppError} 401 si la cuenta ya no existe.
   */
  async perfil(usuarioId) {
    const usuario = await UsuariosRepository.buscarPorId(usuarioId);
    if (!usuario) {
      throw AppError.unauthorized("La cuenta asociada al token ya no existe");
    }
    return aUsuarioDTO(usuario);
  },

  verificarToken,
};

module.exports = AuthService;
