/**
 * @fileoverview Acceso a datos del catálogo `tipos_evento`
 * (las modalidades: Privado, Seminario, Tesis).
 */

const { pool } = require("../config/db");

/**
 * Repositorio del catálogo de modalidades.
 * Encapsula el SQL para que las capas superiores dependan de operaciones con
 * significado de negocio (`listar`, `existe`) y no de la estructura de la tabla.
 */
const TiposEventoRepository = {
  /**
   * Devuelve el catálogo completo de modalidades.
   * @returns {Promise<object[]>}
   */
  async listar() {
    const sql = `
      SELECT id, nombre, descripcion
      FROM tipos_evento
      ORDER BY id ASC
    `;
    const [filas] = await pool.query(sql);
    return filas;
  },

  /**
   * Comprueba la existencia de una modalidad antes de asignar contra ella.
   * @param {number} id Identificador de la modalidad.
   * @returns {Promise<boolean>}
   */
  async existe(id) {
    const [filas] = await pool.query(
      "SELECT id FROM tipos_evento WHERE id = ? LIMIT 1",
      [id]
    );
    return filas.length > 0;
  },
};

module.exports = TiposEventoRepository;
