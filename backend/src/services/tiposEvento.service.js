/**
 * @fileoverview Reglas de negocio del catálogo de modalidades de evento.
 *
 * Aunque hoy se limita a delegar en el repositorio y proyectar a DTO, la capa
 * se mantiene para respetar la arquitectura: el controlador nunca habla con el
 * repositorio, y cualquier regla futura (caché, filtrado) tiene un lugar definido.
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
