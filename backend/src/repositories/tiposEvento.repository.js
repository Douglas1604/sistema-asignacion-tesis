/**
 * @fileoverview Acceso a datos del catálogo `tipos_evento`
 * (las modalidades: Privado, Seminario, Tesis).
 */

const { pool } = require("../config/db");

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
