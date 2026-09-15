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
  crearTernaTesisSchema,
  eliminarLoteParamsSchema,
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
 *
 *       Todas las filas de la petición comparten un `lote_id` generado por el servidor y devuelto en la respuesta.
 *       Para adjuntar otra petición al mismo lote (p. ej. los demás alumnos de una terna de tesis) se reenvía ese `lote_id`.
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
 *                     lote_id: { type: string, format: uuid, example: "3f9c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f" }
 *                     registros: { type: integer, example: 3 }
 *                     tipo_evento_id: { type: integer, example: 3 }
 *                     modo: { type: string, enum: [tesis, terna], example: tesis }
 *       400:
 *         $ref: '#/components/responses/PeticionInvalida'
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 *       403:
 *         $ref: '#/components/responses/SinPermisos'
 *       404:
 *         $ref: '#/components/responses/NoEncontrado'
 *       409:
 *         description: El `lote_id` indicado pertenece a otra modalidad.
 *       413:
 *         $ref: '#/components/responses/CuerpoDemasiadoGrande'
 *       422:
 *         $ref: '#/components/responses/ErrorValidacion'
 */
// Cadena efectiva de POST /asignaciones:
//   apiLimiter (app.js) -> requireAuth (router.use) -> requireRole(admin)
//   -> validate(crearAsignacionSchema) -> AsignacionesController.crear
router.post(
  "/",
  requireRole(ROLES.ADMIN),
  validate({ body: crearAsignacionSchema }),
  AsignacionesController.crear
);

/**
 * @swagger
 * /asignaciones/terna:
 *   post:
 *     summary: Registra de forma atómica una terna de tesis completa
 *     description: |
 *       Recibe el jurado (exactamente 3 catedráticos, en orden Presidente, Vocal 1, Vocal 2)
 *       y todos los alumnos que examinará. Se insertan `alumnos × 3` filas en una única
 *       transacción MariaDB (`START TRANSACTION` … `COMMIT`) y bajo un único `lote_id`.
 *       Si cualquier inserción falla se ejecuta `ROLLBACK`: ningún alumno de la terna queda guardado.
 *       Requiere rol administrador.
 *     tags: [Asignaciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CrearTernaTesis'
 *     responses:
 *       201:
 *         description: Terna registrada completa.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     lote_id: { type: string, format: uuid, example: "3f9c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f" }
 *                     registros: { type: integer, example: 12 }
 *                     alumnos: { type: integer, example: 4 }
 *                     tipo_evento_id: { type: integer, example: 3 }
 *                     modo: { type: string, example: tesis }
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 *       403:
 *         $ref: '#/components/responses/SinPermisos'
 *       413:
 *         $ref: '#/components/responses/CuerpoDemasiadoGrande'
 *       422:
 *         $ref: '#/components/responses/ErrorValidacion'
 *       500:
 *         description: La transacción falló y se revirtió; no se guardó ninguna fila.
 */
router.post(
  "/terna",
  requireRole(ROLES.ADMIN),
  validate({ body: crearTernaTesisSchema }),
  AsignacionesController.crearTernaTesis
);

/**
 * @swagger
 * /asignaciones/lote/{lote_id}:
 *   delete:
 *     summary: Elimina un lote completo de asignaciones
 *     description: Borra todas las asignaciones que comparten el `lote_id` indicado. Un lote corresponde a un guardado del sorteo; otros lotes registrados en el mismo minuto no se ven afectados. Operación irreversible; requiere rol administrador y queda registrada en la pista de auditoría.
 *     tags: [Asignaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lote_id
 *         required: true
 *         description: Identificador del lote (UUID) devuelto al registrar y en el historial.
 *         schema: { type: string, format: uuid, example: "3f9c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f" }
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
// Las dos rutas de borrado no colisionan: difieren en número de segmentos
// (`/lote/:lote_id` frente a `/lote/:lote_id/alumno/:carnet`) y Express exige
// coincidencia completa de la ruta.
router.delete(
  "/lote/:lote_id",
  requireRole(ROLES.ADMIN),
  validate({ params: eliminarLoteParamsSchema }),
  AsignacionesController.eliminarLote
);

/**
 * @swagger
 * /asignaciones/lote/{lote_id}/alumno/{carnet}:
 *   delete:
 *     summary: Elimina la asignación de un alumno dentro de un lote
 *     description: Borra las filas de un alumno concreto en el lote indicado. En tesis, el alumno tiene una fila por cada miembro del jurado y se eliminan todas. Requiere rol administrador.
 *     tags: [Asignaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lote_id
 *         required: true
 *         schema: { type: string, format: uuid, example: "3f9c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f" }
 *       - in: path
 *         name: carnet
 *         required: true
 *         schema: { type: string, maxLength: 50, example: "1990-12-3456" }
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
  "/lote/:lote_id/alumno/:carnet",
  requireRole(ROLES.ADMIN),
  validate({ params: eliminarAsignacionAlumnoParamsSchema }),
  AsignacionesController.eliminarAsignacionAlumno
);

module.exports = router;
