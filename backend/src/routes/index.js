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

router.use("/auth", authRoutes);
router.use("/usuarios", usuariosRoutes);
router.use("/asignaciones", asignacionesRoutes);
router.use("/tipos-evento", tiposEventoRoutes);

module.exports = router;
