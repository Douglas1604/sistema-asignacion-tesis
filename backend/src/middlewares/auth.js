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
 * Roles cuyo acceso se considera crítico: una ruta que los exige revalida el
 * rol contra la base de datos en cada petición en lugar de fiarse del JWT.
 */
const ROLES_ADMINISTRATIVOS = new Set([ROLES.ADMIN]);

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
 * Se coloca siempre DESPUÉS de `requireAuth`.
 *
 * Se implementa como fábrica (función de orden superior): recibe la
 * configuración y devuelve el middleware, lo que permite declarar la política
 * de acceso de forma legible en la definición de cada ruta.
 *
 * @description Dos niveles de comprobación:
 *  1. Rápido y sin estado: el rol del JWT debe estar entre los permitidos. Si
 *     no lo está se responde 403 sin tocar la base de datos.
 *  2. Solo si la ruta exige un rol administrativo: se relee el usuario en la
 *     base de datos y se exige que siga existiendo (401) y que su rol VIGENTE
 *     siga estando permitido (403). Un JWT es válido hasta que expira, así que
 *     sin este paso un administrador degradado o eliminado conservaría sus
 *     privilegios durante toda la vida del token (hasta `JWT_EXPIRES_IN`).
 * Las rutas no críticas (sin rol administrativo) mantienen solo el nivel 1.
 * Si la base de datos falla, el error se propaga y la petición NO continúa
 * (falla cerrado).
 *
 * @param {...string} rolesPermitidos Roles que pueden acceder.
 * @returns {import("express").RequestHandler}
 * @throws {AppError} Vía `next`: 403 si el rol no está autorizado o fue revocado;
 * 401 si la cuenta ya no existe.
 */
function requireRole(...rolesPermitidos) {
  // Se decide una sola vez, al declarar la ruta, y no en cada petición.
  const exigeRevalidacion = rolesPermitidos.some((rol) =>
    ROLES_ADMINISTRATIVOS.has(rol)
  );

  return async (req, res, next) => {
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

    if (!exigeRevalidacion) {
      return next();
    }

    try {
      const usuario = await AuthService.obtenerUsuarioVigente(req.user.id);

      if (!usuario) {
        auditarDenegacion(req, "ACCESO_DENEGADO_CUENTA_INEXISTENTE", {
          rolToken: req.user.rol,
        });
        return next(
          AppError.unauthorized("La cuenta asociada al token ya no existe")
        );
      }

      if (!rolesPermitidos.includes(usuario.rol_nombre)) {
        auditarDenegacion(req, "ACCESO_DENEGADO_ROL_REVOCADO", {
          rolRequerido: rolesPermitidos,
          rolToken: req.user.rol,
          rolVigente: usuario.rol_nombre || null,
        });
        return next(AppError.forbidden("No tienes permisos para esta operación"));
      }

      // Las capas siguientes trabajan con el rol confirmado, no con el del token.
      req.user.rol = usuario.rol_nombre;
      req.user.rol_id = usuario.rol_id;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requireAuth, requireRole, ROLES };
