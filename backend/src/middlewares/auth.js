/**
 * @fileoverview Autenticación y autorización basadas en JWT.
 *
 * `requireAuth` protege todo endpoint que no sea explícitamente público.
 * `requireRole` añade la comprobación de rol para las operaciones de gestión.
 */

const AppError = require("../utils/AppError");
const AuthService = require("../services/auth.service");
const logger = require("../config/logger");

/** Roles reconocidos por el sistema, según la tabla `roles`. */
const ROLES = Object.freeze({
  ADMIN: "admin",
  PROFESOR: "profesor",
  ALUMNO: "alumno",
});

/**
 * Extrae el token de la cabecera Authorization con esquema Bearer.
 * @param {import("express").Request} req Petición entrante.
 * @returns {string|null} El token, o null si la cabecera falta o está mal formada.
 */
function extraerToken(req) {
  const cabecera = req.headers.authorization;
  if (!cabecera || typeof cabecera !== "string") return null;

  // Formato esperado (RFC 6750): "Bearer <jwt>". Cualquier otro esquema
  // (Basic, Digest) o una cabecera sin token se trata como ausencia de credencial.
  const [esquema, token] = cabecera.split(" ");
  if (!token || esquema.toLowerCase() !== "bearer") return null;

  return token.trim() || null;
}

/**
 * Exige un token válido y que la cuenta siga existiendo en la base de datos.
 * Deja en `req.user` la identidad autenticada, con el rol VIGENTE de la BD.
 *
 * @description Flujo de validación del token en cada petición protegida:
 *  1. Se extrae el JWT de la cabecera `Authorization`.
 *  2. `AuthService.verificarToken` recalcula la firma HMAC con el secreto del
 *     servidor y comprueba expiración (`exp`) y emisor (`iss`).
 *  3. Con la firma ya verificada, se relee la cuenta en la base de datos: un
 *     JWT es válido hasta que expira, así que sin este paso una cuenta
 *     eliminada o con el rol cambiado conservaría el acceso que tenía al
 *     emitirse el token durante toda su vida (hasta `JWT_EXPIRES_IN`).
 *     `req.user.rol` siempre refleja la base de datos, nunca el claim del
 *     token.
 * Si la base de datos falla, el error se propaga y la petición NO continúa
 * (falla cerrado).
 *
 * @param {import("express").Request} req Petición entrante.
 * @param {import("express").Response} res Respuesta (no se utiliza).
 * @param {import("express").NextFunction} next Continuación de la cadena.
 * @returns {Promise<void>}
 * @throws {AppError} 401, entregado vía `next`, si el token falta, expiró,
 * fue alterado, o la cuenta asociada ya no existe.
 */
async function requireAuth(req, res, next) {
  const token = extraerToken(req);

  if (!token) {
    return next(AppError.unauthorized("Se requiere un token de acceso"));
  }

  try {
    // `sub` es una cadena por definición del estándar JWT (RFC 7519); se
    // convierte a número para que coincida con la clave primaria de `usuarios`.
    const payload = AuthService.verificarToken(token);
    const usuarioId = Number(payload.sub);
    const usuario = await AuthService.obtenerUsuarioVigente(usuarioId);

    if (!usuario) {
      logger.auditoria({
        accion: "ACCESO_DENEGADO_CUENTA_INEXISTENTE",
        usuarioId,
        recurso: req.originalUrl,
        detalles: { rolToken: payload.rol },
        requestId: req.id,
        ip: req.ip,
      });
      return next(
        AppError.unauthorized("La cuenta asociada al token ya no existe")
      );
    }

    req.user = {
      id: usuario.id,
      email: usuario.email,
      rol: usuario.rol_nombre,
      rol_id: usuario.rol_id,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Registra un acceso denegado en la pista de auditoría.
 * @param {import("express").Request} req Petición autenticada.
 * @param {string} accion Código del evento de auditoría.
 * @param {object} detalles Información adicional del rechazo.
 */
function auditarDenegacion(req, accion, detalles) {
  logger.auditoria({
    accion,
    usuarioId: req.user.id,
    recurso: req.originalUrl,
    detalles,
    requestId: req.id,
    ip: req.ip,
  });
}

/**
 * Exige que el usuario autenticado tenga uno de los roles indicados.
 * Se coloca siempre DESPUÉS de `requireAuth`, que ya revalida la cuenta y el
 * rol contra la base de datos en cada petición: aquí solo se compara ese rol
 * ya vigente contra los permitidos, sin una segunda consulta.
 *
 * Se implementa como fábrica (función de orden superior): recibe la
 * configuración y devuelve el middleware, lo que permite declarar la política
 * de acceso de forma legible en la definición de cada ruta.
 *
 * @param {...string} rolesPermitidos Roles que pueden acceder.
 * @returns {import("express").RequestHandler}
 * @throws {AppError} 403 si el rol vigente no está entre los permitidos.
 */
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized("Se requiere un token de acceso"));
    }

    if (!rolesPermitidos.includes(req.user.rol)) {
      // Registramos el intento: un 403 es una señal de auditoría relevante.
      auditarDenegacion(req, "ACCESO_DENEGADO", {
        rolRequerido: rolesPermitidos,
        rolActual: req.user.rol,
      });
      return next(AppError.forbidden("No tienes permisos para esta operación"));
    }

    return next();
  };
}

module.exports = { requireAuth, requireRole, ROLES };
