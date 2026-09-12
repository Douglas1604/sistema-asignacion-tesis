/**
 * @fileoverview Rutas del módulo de usuarios. Todas exigen rol de administrador:
 * el listado de cuentas es información sensible aunque no incluya contraseñas.
 */

const express = require("express");
const UsuariosController = require("../controllers/usuarios.controller");
const validate = require("../middlewares/validate");
const { requireAuth, requireRole, ROLES } = require("../middlewares/auth");
const {
  usuarioIdParamSchema,
  listarUsuariosQuerySchema,
} = require("../validators/usuarios.validators");

const router = express.Router();

// La autenticación y el rol se aplican a todo el router de una sola vez,
// de modo que una ruta nueva nace protegida por omisión.
router.use(requireAuth, requireRole(ROLES.ADMIN));

/**
 * @swagger
 * /usuarios:
 *   get:
 *     summary: Lista los usuarios del sistema
 *     description: Requiere rol administrador. La respuesta nunca incluye el campo password_hash.
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pagina
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limite
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 20 }
 *     responses:
 *       200:
 *         description: Lista paginada de usuarios.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Usuario'
 *                 meta:
 *                   $ref: '#/components/schemas/MetaPaginacion'
 *       401:
 *         $ref: '#/components/responses/NoAutenticado'
 *       403:
 *         $ref: '#/components/responses/SinPermisos'
 *       422:
 *         $ref: '#/components/responses/ErrorValidacion'
 */
router.get(
  "/",
  validate({ query: listarUsuariosQuerySchema }),
  UsuariosController.listar
);

/**
 * @swagger
 * /usuarios/{id}:
 *   get:
 *     summary: Obtiene un usuario por su identificador
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Datos del usuario.
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
 *       403:
 *         $ref: '#/components/responses/SinPermisos'
 *       404:
 *         $ref: '#/components/responses/NoEncontrado'
 */
router.get(
  "/:id",
  validate({ params: usuarioIdParamSchema }),
  UsuariosController.obtener
);

module.exports = router;
