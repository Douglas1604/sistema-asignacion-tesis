/**
 * @fileoverview Reglas de negocio del catálogo de modalidades de evento.
 */

const TiposEventoRepository = require("../repositories/tiposEvento.repository");
const { aListaTiposEventoDTO } = require("../dtos/asignacion.dto");

const TiposEventoService = {
  /**
   * Devuelve el catálogo de modalidades (Privado, Seminario, Tesis).
   * @returns {Promise<object[]>} Lista de DTOs.
   */
  async listar() {
    const filas = await TiposEventoRepository.listar();
    return aListaTiposEventoDTO(filas);
  },
};

module.exports = TiposEventoService;
