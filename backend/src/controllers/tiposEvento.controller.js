/**
 * @fileoverview Controladores del catálogo de modalidades de evento.
 */

const asyncHandler = require("../utils/asyncHandler");
const TiposEventoService = require("../services/tiposEvento.service");
const { ok } = require("../utils/respuesta");

const TiposEventoController = {
  /** GET /tipos-evento */
  listar: asyncHandler(async (req, res) => {
    const tipos = await TiposEventoService.listar();
    res.status(200).json(ok(tipos));
  }),
};

module.exports = TiposEventoController;
