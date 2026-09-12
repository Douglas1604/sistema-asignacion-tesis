/**
 * @fileoverview Controladores del catálogo de modalidades de evento.
 */

const asyncHandler = require("../utils/asyncHandler");
const TiposEventoService = require("../services/tiposEvento.service");
const { ok } = require("../utils/respuesta");

const TiposEventoController = {
  /**
   * GET /tipos-evento
   * @param {import("express").Request} req Petición autenticada.
   * @param {import("express").Response} res Responde 200 con el catálogo de modalidades.
   * @returns {Promise<void>}
   */
  listar: asyncHandler(async (req, res) => {
    const tipos = await TiposEventoService.listar();
    res.status(200).json(ok(tipos));
  }),
};

module.exports = TiposEventoController;
