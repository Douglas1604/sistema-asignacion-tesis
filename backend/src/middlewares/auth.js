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

  const [esquema, token] = cabecera.split(" ");
  if (!token || esquema.toLowerCase() !== "bearer") return null;

  return token.trim() || null;
}

/**
 * Exige un token válido. Deja en `req.user` la identidad autenticada.
 * @type {import("express").RequestHandler}
 */
function requireAuth(req, res, next) {
  const token = extraerToken(req);

  if (!token) {
    return next(AppError.unauthorized("Se requiere un token de acceso"));
  }

  try {
    const payload = AuthService.verificarToken(token);
    req.user = {
      id: Number(payload.sub),
      email: payload.email,
      rol: payload.rol,
      rol_id: payload.rol_id,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Exige que el usuario autenticado tenga uno de los roles indicados.
 * Se coloca siempre DESPUÉS de `requireAuth`.
 *
 * @param {...string} rolesPermitidos Roles que pueden acceder.
 * @returns {import("express").RequestHandler}
 */
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized("Se requiere un token de acceso"));
    }

    if (!rolesPermitidos.includes(req.user.rol)) {
      // Registramos el intento: un 403 es una señal de auditoría relevante.
      logger.auditoria({
        accion: "ACCESO_DENEGADO",
        usuarioId: req.user.id,
        recurso: req.originalUrl,
        detalles: { rolRequerido: rolesPermitidos, rolActual: req.user.rol },
        requestId: req.id,
        ip: req.ip,
      });
      return next(AppError.forbidden("No tienes permisos para esta operación"));
    }

    return next();
  };
}

module.exports = { requireAuth, requireRole, ROLES };
