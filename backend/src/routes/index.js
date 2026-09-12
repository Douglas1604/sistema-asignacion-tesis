/**
 * @fileoverview Router de la versión 1 de la API.
 * Monta cada recurso bajo su nombre en plural, siguiendo convenciones REST.
 */

const express = require("express");

const authRoutes = require("./auth.routes");
const usuariosRoutes = require("./usuarios.routes");
const asignacionesRoutes = require("./asignaciones.routes");
const tiposEventoRoutes = require("./tiposEvento.routes");

const router = express.Router();

// Este router se monta en `app.js` bajo BASE_PATH (/api/v1). El prefijo de
// versión permite publicar en el futuro una /api/v2 incompatible sin romper
// a los clientes que siguen consumiendo la versión actual.
//
// Dentro de cada módulo, las rutas encadenan middlewares siempre en el mismo
// orden: autenticación -> rol -> validación -> controlador. Así se rechaza a
// un usuario no autorizado antes de invertir trabajo en validar su petición.
router.use("/auth", authRoutes);
router.use("/usuarios", usuariosRoutes);
router.use("/asignaciones", asignacionesRoutes);
router.use("/tipos-evento", tiposEventoRoutes);

module.exports = router;
