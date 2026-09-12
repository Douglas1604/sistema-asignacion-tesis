/**
 * @fileoverview Rutas del catálogo de modalidades de evento.
 * Es un catálogo de lectura, pero queda tras autenticación: solo los usuarios
 * del sistema necesitan conocer la configuración de sorteos.
 */

const express = require("express");
const TiposEventoController = require("../controllers/tiposEvento.controller");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

/**
 * @swagger
 * /tipos-evento:
 *   get:
 *     summary: Lista las modalidades de evento disponibles
 *     description: Devuelve el catálogo de modalidades (Privado, Seminario, Tesis) que alimenta la pantalla de sorteo.
 *     tags: [Tipos de evento]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Catálogo de modalidades.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TipoEvento'
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 */
router.get("/", requireAuth, TiposEventoController.listar);

module.exports = router;
