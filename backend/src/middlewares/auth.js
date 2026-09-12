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
 * Exige un token válido. Deja en `req.user` la identidad autenticada.
 *
 * @description Flujo de validación del token en cada petición protegida:
 *  1. Se extrae el JWT de la cabecera `Authorization`.
 *  2. `AuthService.verificarToken` recalcula la firma HMAC con el secreto del
 *     servidor y comprueba expiración (`exp`) y emisor (`iss`).
 *  3. Con la firma ya verificada, los claims se consideran confiables y se
 *     publican en `req.user` para las capas siguientes.
 * La verificación es local y sin estado (stateless): no requiere consultar la BD.
 *
 * @param {import("express").Request} req Petición entrante.
 * @param {import("express").Response} res Respuesta (no se utiliza).
 * @param {import("express").NextFunction} next Continuación de la cadena.
 * @returns {void}
 * @throws {AppError} 401, entregado vía `next`, si el token falta, expiró o fue alterado.
 */
function requireAuth(req, res, next) {
  const token = extraerToken(req);

  if (!token) {
    return next(AppError.unauthorized("Se requiere un token de acceso"));
  }

  try {
    const payload = AuthService.verificarToken(token);
    // `sub` es una cadena por definición del estándar JWT (RFC 7519); se
    // convierte a número para que coincida con la clave primaria de `usuarios`.
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
 * Se implementa como fábrica (función de orden superior): recibe la
 * configuración y devuelve el middleware, lo que permite declarar la política
 * de acceso de forma legible en la definición de cada ruta.
 *
 * @param {...string} rolesPermitidos Roles que pueden acceder.
 * @returns {import("express").RequestHandler}
 * @throws {AppError} 403, entregado vía `next`, si el rol no está autorizado.
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
