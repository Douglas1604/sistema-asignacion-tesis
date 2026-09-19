/**
 * @fileoverview Reglas de negocio de autenticación.
 * Emite y valida los JWT y aplica la política de credenciales.
 */

const { randomBytes } = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const AppError = require("../utils/AppError");
const logger = require("../config/logger");
const { verificarPassword, esHashBcrypt } = require("../utils/password");
const UsuariosRepository = require("../repositories/usuarios.repository");
const { aUsuarioDTO } = require("../dtos/usuario.dto");

/**
 * Hash bcrypt de relleno, calculado una sola vez al cargar el servicio.
 *
 * @description Defensa frente al canal lateral de temporización en el login.
 * bcrypt es deliberadamente lento (con coste 12, cientos de milisegundos): si
 * solo se ejecutara cuando la cuenta existe, un correo inexistente respondería
 * casi al instante y el tiempo de respuesta delataría qué correos están dados
 * de alta, aunque el mensaje de error sea idéntico.
 *
 * Por eso, cuando no hay hash real contra el que comparar, se compara contra
 * este. Se genera con el MISMO factor de coste que las contraseñas reales
 * (`BCRYPT_ROUNDS`), que es lo que determina la duración de `compare`. Parte
 * de 32 bytes aleatorios que no se guardan en ningún sitio: ninguna contraseña
 * puede coincidir con él de forma práctica, y aun así el resultado se descarta.
 *
 * `hashSync` bloquea el arranque una única vez; no afecta a las peticiones.
 */
const HASH_DUMMY = bcrypt.hashSync(
  randomBytes(32).toString("hex"),
  env.BCRYPT_ROUNDS
);

/**
 * Firma el token de acceso del usuario.
 * El payload lleva solo lo imprescindible para autorizar: nunca datos sensibles.
 *
 * @description Estructura del token resultante (`header.payload.firma`, en Base64URL):
 *  - Claims registrados: `sub` (id del usuario), `iss` (emisor), y los que añade
 *    la librería automáticamente: `iat` (emitido en) y `exp` (expira en).
 *  - Claims privados: `email`, `rol`, `rol_id`, usados para autorizar sin ir a la BD.
 * La firma es simétrica (HMAC-SHA256, algoritmo HS256 por defecto): el mismo
 * `JWT_SECRET` firma y verifica. El payload está CODIFICADO, no cifrado; por eso
 * no se incluye ningún dato que no pueda ser leído por el portador del token.
 *
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
  // `jwt.verify` recalcula la firma sobre header+payload y la compara con la
  // recibida; cualquier alteración de un solo carácter del payload (p. ej.
  // cambiar "rol":"profesor" por "admin") invalida la firma. Los errores de la
  // librería se traducen a AppError para no exponer detalles de la causa.
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
    // Paso 1 (capa de datos): recuperar la cuenta, incluyendo el hash, por correo.
    const usuario = await UsuariosRepository.buscarPorEmailConHash(email);

    // Paso 2 (verificación en tiempo constante): se ejecuta SIEMPRE exactamente
    // un `bcrypt.compare` con el mismo coste, exista o no la cuenta.
    //  - Cuenta con hash bcrypt válido: se compara contra su hash real.
    //  - Cuenta inexistente, o con contraseña heredada en texto plano (que
    //    `verificarPassword` rechazaría sin invocar bcrypt): se compara contra
    //    HASH_DUMMY y el resultado se descarta.
    // Ambos casos de fallo desembocan en la misma rama, con el mismo mensaje
    // hacia el cliente y un tiempo de respuesta equivalente.
    let credencialesValidas = false;
    if (usuario !== null && esHashBcrypt(usuario.password_hash)) {
      credencialesValidas = await verificarPassword(password, usuario.password_hash);
    } else {
      await bcrypt.compare(password, HASH_DUMMY);
    }

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

    // Paso 3 (emisión): se firma el token y el usuario se proyecta a DTO, lo que
    // garantiza que `password_hash` nunca abandone el servidor.
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

  /**
   * Relee de la base de datos la identidad y el rol vigentes de un usuario.
   * La usa el middleware de autorización para no confiar en el rol que viaja
   * en el JWT cuando la operación es administrativa: el token puede haberse
   * emitido antes de que el rol se revocara o la cuenta se eliminara.
   *
   * @param {number} usuarioId Identificador extraído del token.
   * @returns {Promise<object|null>} Fila con `rol_nombre`, o null si la cuenta ya no existe.
   */
  async obtenerUsuarioVigente(usuarioId) {
    return UsuariosRepository.buscarPorId(usuarioId);
  },

  verificarToken,
};

module.exports = AuthService;
