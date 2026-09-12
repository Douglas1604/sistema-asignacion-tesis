/**
 * @fileoverview Rutas del módulo de asignaciones (resultados del sorteo).
 *
 * Lectura: cualquier usuario autenticado (la pantalla de reportes).
 * Escritura y borrado: solo administradores, que son quienes ejecutan la ruleta.
 */

const express = require("express");
const AsignacionesController = require("../controllers/asignaciones.controller");
const validate = require("../middlewares/validate");
const { requireAuth, requireRole, ROLES } = require("../middlewares/auth");
const {
  crearAsignacionSchema,
  eliminarLoteQuerySchema,
  eliminarAsignacionAlumnoParamsSchema,
  listarAsignacionesQuerySchema,
} = require("../validators/asignaciones.validators");

const router = express.Router();

// Ninguna ruta de este módulo es pública.
router.use(requireAuth);

/**
 * @swagger
 * /asignaciones:
 *   get:
 *     summary: Lista el historial de asignaciones
 *     description: Devuelve las asignaciones ya formateadas para las actas (modalidad, catedrático, alumno y fecha). Accesible a cualquier usuario autenticado.
 *     tags: [Asignaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pagina
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limite
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 500 }
 *     responses:
 *       200:
 *         description: Historial de asignaciones.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AsignacionReporte'
 *                 meta:
 *                   $ref: '#/components/schemas/MetaPaginacion'
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 */
router.get(
  "/",
  validate({ query: listarAsignacionesQuerySchema }),
  AsignacionesController.listar
);

/**
 * @swagger
 * /asignaciones:
 *   post:
 *     summary: Registra el resultado de un sorteo
 *     description: |
 *       Acepta dos formas excluyentes, determinadas por el campo `es_tesis`:
 *
 *       * `es_tesis: true` — un alumno y su jurado de exactamente 3 catedráticos.
 *         Se crea una fila por catedrático, con su rol (Presidente, Vocal 1, Vocal 2).
 *       * `es_tesis: false` — un catedrático y su grupo de alumnos.
 *         Se crea una fila por alumno.
 *
 *       Cada registro se escribe dentro de una transacción: o se guarda el lote completo o no se guarda nada.
 *       Requiere rol administrador.
 *     tags: [Asignaciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/CrearAsignacionTesis'
 *               - $ref: '#/components/schemas/CrearAsignacionTerna'
 *             discriminator:
 *               propertyName: es_tesis
 *     responses:
 *       201:
 *         description: Asignaciones registradas.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     registros: { type: integer, example: 3 }
 *                     tipo_evento_id: { type: integer, example: 3 }
 *                     modo: { type: string, enum: [tesis, terna], example: tesis }
 *       400:
 *         $ref: '#/components/responses/PeticionInvalida'
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 *       403:
 *         $ref: '#/components/responses/SinPermisos'
 *       413:
 *         $ref: '#/components/responses/CuerpoDemasiadoGrande'
 *       422:
 *         $ref: '#/components/responses/ErrorValidacion'
 */
router.post(
  "/",
  requireRole(ROLES.ADMIN),
  validate({ body: crearAsignacionSchema }),
  AsignacionesController.crear
);

/**
 * @swagger
 * /asignaciones/lote:
 *   delete:
 *     summary: Elimina un lote completo de asignaciones
 *     description: Borra todas las asignaciones que comparten la marca de tiempo indicada, que es como el módulo de reportes identifica un lote de sorteo. Operación irreversible; requiere rol administrador y queda registrada en la pista de auditoría.
 *     tags: [Asignaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: fecha
 *         required: true
 *         description: Marca de tiempo del lote, en formato dd/mm/aaaa hh:mm.
 *         schema: { type: string, example: "12/09/2026 10:30" }
 *     responses:
 *       200:
 *         description: Lote eliminado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     eliminados: { type: integer, example: 5 }
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 *       403:
 *         $ref: '#/components/responses/SinPermisos'
 *       404:
 *         $ref: '#/components/responses/NoEncontrado'
 *       422:
 *         $ref: '#/components/responses/ErrorValidacion'
 */
router.delete(
  "/lote",
  requireRole(ROLES.ADMIN),
  validate({ query: eliminarLoteQuerySchema }),
  AsignacionesController.eliminarLote
);

/**
 * @swagger
 * /asignaciones/alumno/{carnet}/{fecha}:
 *   delete:
 *     summary: Elimina la asignación de un alumno dentro de un lote
 *     description: Borra las filas de un alumno concreto en el sorteo indicado. En tesis, el alumno tiene una fila por cada miembro del jurado y se eliminan todas. Requiere rol administrador.
 *     tags: [Asignaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: carnet
 *         required: true
 *         schema: { type: string, maxLength: 50, example: "1990-12-3456" }
 *       - in: path
 *         name: fecha
 *         required: true
 *         description: Marca de tiempo del sorteo, en formato dd/mm/aaaa hh:mm (codificada en la URL).
 *         schema: { type: string, example: "12/09/2026 10:30" }
 *     responses:
 *       200:
 *         description: Asignación eliminada.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     eliminados: { type: integer, example: 3 }
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 *       403:
 *         $ref: '#/components/responses/SinPermisos'
 *       404:
 *         $ref: '#/components/responses/NoEncontrado'
 *       422:
 *         $ref: '#/components/responses/ErrorValidacion'
 */
router.delete(
  "/alumno/:carnet/:fecha",
  requireRole(ROLES.ADMIN),
  validate({ params: eliminarAsignacionAlumnoParamsSchema }),
  AsignacionesController.eliminarAsignacionAlumno
);

module.exports = router;
