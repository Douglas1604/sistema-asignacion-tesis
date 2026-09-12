/**
 * @fileoverview Ruta de salud. Es el único endpoint de datos público junto al login.
 * Informa si el proceso responde y si la base de datos está accesible, sin
 * revelar versiones, nombres de host ni credenciales.
 */

const express = require("express");
const { verificarConexion } = require("../config/db");

const router = express.Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Comprueba el estado del servicio
 *     description: Endpoint público de monitorización. Devuelve 200 si la API y la base de datos responden, y 503 si la base de datos no está disponible.
 *     tags: [Salud]
 *     security: []
 *     responses:
 *       200:
 *         description: El servicio está operativo.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     estado: { type: string, example: ok }
 *                     baseDatos: { type: string, example: conectada }
 *                     tiempoActivoSegundos: { type: number, example: 128.4 }
 *       503:
 *         description: La base de datos no responde.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/health", async (req, res) => {
  try {
    await verificarConexion();
    res.status(200).json({
      success: true,
      data: {
        estado: "ok",
        baseDatos: "conectada",
        tiempoActivoSegundos: Number(process.uptime().toFixed(1)),
      },
    });
  } catch (error) {
    // No propagamos el mensaje del driver: solo el hecho de que no hay conexión.
    res.status(503).json({
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "La base de datos no está disponible",
      },
    });
  }
});

module.exports = router;
