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

const AsignacionesController = {
  /** GET /asignaciones */
  listar: asyncHandler(async (req, res) => {
    const { items, meta } = await AsignacionesService.listarHistorial(
      req.validatedQuery
    );
    res.status(200).json(ok(items, meta));
  }),

  /** POST /asignaciones */
  crear: asyncHandler(async (req, res) => {
    const resultado = await AsignacionesService.registrar(
      req.body,
      contextoAuditoria(req)
    );
    res.status(201).json(ok(resultado));
  }),

  /** DELETE /asignaciones/alumno/:carnet/:fecha */
  eliminarAsignacionAlumno: asyncHandler(async (req, res) => {
    const resultado = await AsignacionesService.eliminarAsignacionAlumno(
      req.params,
      contextoAuditoria(req)
    );
    res.status(200).json(ok(resultado));
  }),

  /** DELETE /asignaciones/lote */
  eliminarLote: asyncHandler(async (req, res) => {
    const resultado = await AsignacionesService.eliminarLote(
      req.validatedQuery.fecha,
      contextoAuditoria(req)
    );
    res.status(200).json(ok(resultado));
  }),
};

module.exports = AsignacionesController;
