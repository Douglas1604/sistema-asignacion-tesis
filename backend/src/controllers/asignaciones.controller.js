/**
 * @fileoverview Controladores del módulo de asignaciones.
 */

const asyncHandler = require("../utils/asyncHandler");
const AsignacionesService = require("../services/asignaciones.service");
const { ok } = require("../utils/respuesta");

/**
 * Reúne los datos de auditoría de la petición en curso.
 * @param {import("express").Request} req Petición autenticada.
 * @returns {{usuarioId: number|null, ip: string, requestId: string}}
 */
function contextoAuditoria(req) {
  return {
    usuarioId: req.user ? req.user.id : null,
    ip: req.ip,
    requestId: req.id,
  };
}

/**
 * Controladores HTTP del recurso `asignaciones`.
 * Cada método se limita a: (1) leer la entrada ya validada, (2) invocar el
 * servicio y (3) serializar la respuesta con la envoltura estándar y el código
 * HTTP semántico (200 lectura/borrado, 201 creación).
 */
const AsignacionesController = {
  /**
   * GET /asignaciones
   * @param {import("express").Request} req Usa `req.validatedQuery` ({pagina, limite}).
   * @param {import("express").Response} res Responde 200 con `data` y `meta` de paginación.
   * @returns {Promise<void>}
   */
  listar: asyncHandler(async (req, res) => {
    const { items, meta } = await AsignacionesService.listarHistorial(
      req.validatedQuery
    );
    res.status(200).json(ok(items, meta));
  }),

  /**
   * POST /asignaciones
   * @param {import("express").Request} req Cuerpo validado por la unión discriminada `es_tesis`.
   * @param {import("express").Response} res Responde 201 con `{registros, tipo_evento_id, modo}`.
   * @returns {Promise<void>}
   * @throws {AppError} 422 si la modalidad no existe o no se cumplen las reglas del sorteo.
   */
  crear: asyncHandler(async (req, res) => {
    const resultado = await AsignacionesService.registrar(
      req.body,
      contextoAuditoria(req)
    );
    res.status(201).json(ok(resultado));
  }),

  /**
   * DELETE /asignaciones/alumno/:carnet/:fecha
   * @param {import("express").Request} req `req.params` ya decodificados y validados.
   * @param {import("express").Response} res Responde 200 con `{eliminados}`.
   * @returns {Promise<void>}
   * @throws {AppError} 404 si no hay asignaciones para ese alumno y fecha.
   */
  eliminarAsignacionAlumno: asyncHandler(async (req, res) => {
    const resultado = await AsignacionesService.eliminarAsignacionAlumno(
      req.params,
      contextoAuditoria(req)
    );
    res.status(200).json(ok(resultado));
  }),

  /**
   * DELETE /asignaciones/lote?fecha=dd/mm/aaaa hh:mm
   * @param {import("express").Request} req Usa `req.validatedQuery.fecha`.
   * @param {import("express").Response} res Responde 200 con `{eliminados}`.
   * @returns {Promise<void>}
   * @throws {AppError} 404 si no existe un lote con esa marca de tiempo.
   */
  eliminarLote: asyncHandler(async (req, res) => {
    const resultado = await AsignacionesService.eliminarLote(
      req.validatedQuery.fecha,
      contextoAuditoria(req)
    );
    res.status(200).json(ok(resultado));
  }),
};

module.exports = AsignacionesController;
