/**
 * @fileoverview Rutas de autenticación.
 */

const express = require("express");
const AuthController = require("../controllers/auth.controller");
const validate = require("../middlewares/validate");
const { loginSchema } = require("../validators/auth.validators");
const { loginLimiter } = require("../middlewares/rateLimit");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Inicia sesión y obtiene un token de acceso
 *     description: Endpoint público. Verifica las credenciales con bcrypt y devuelve un JWT. Está protegido por un limitador de intentos más estricto que el resto de la API.
 *     tags: [Autenticación]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Autenticación correcta.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 *       422:
 *         $ref: '#/components/responses/ErrorValidacion'
 *       429:
 *         $ref: '#/components/responses/DemasiadasPeticiones'
 *       413:
 *         $ref: '#/components/responses/CuerpoDemasiadoGrande'
 */
router.post(
  "/login",
  loginLimiter,
  validate({ body: loginSchema }),
  AuthController.login
);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Devuelve el perfil del usuario autenticado
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil del usuario en sesión.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   $ref: '#/components/schemas/Usuario'
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 */
router.get("/me", requireAuth, AuthController.me);

module.exports = router;
