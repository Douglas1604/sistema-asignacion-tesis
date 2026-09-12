/**
 * @fileoverview Acceso a datos de la tabla `asignaciones`.
 *
 * IMPORTANTE: la forma de los INSERT reproduce exactamente la lógica original
 * del sorteo (roles Presidente/Vocal 1/Vocal 2 y el formato
 * "Nombre (Rol)" para tesis; un catedrático por lote de alumnos para
 * privado/seminario). El módulo de reportes agrupa por esas cadenas, así que
 * cualquier cambio de formato rompería las actas ya generadas.
 */

const { pool } = require("../config/db");

/** Roles del jurado de tesis, en el orden en que salen de la ruleta. */
const ROLES_TESIS = ["Presidente", "Vocal 1", "Vocal 2"];

/** Nombre por defecto cuando el sorteo no aporta uno, igual que en la versión previa. */
const CATEDRATICO_POR_DEFECTO = "Catedrático";

const AsignacionesRepository = {
  /**
   * Inserta el jurado de tesis de un alumno dentro de una transacción.
   * Se crea una fila por cada catedrático, con su rol incrustado en el nombre.
   *
   * @param {object} datos
   * @param {{carnet: string, nombre_completo: string}} datos.alumno Alumno sorteado.
   * @param {Array<{nombre_completo?: string}>} datos.profesores Jurado, en orden de sorteo.
   * @param {number} datos.tipoEventoId Modalidad a registrar.
   * @returns {Promise<number>} Número de filas insertadas.
   */
  async crearAsignacionesTesis({ alumno, profesores, tipoEventoId }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (let i = 0; i < profesores.length; i++) {
        const nombreConRol = `${
          profesores[i].nombre_completo || CATEDRATICO_POR_DEFECTO
        } (${ROLES_TESIS[i]})`;

        await connection.query(
          `INSERT INTO asignaciones
             (profesor_nombre, alumno_carnet, alumno_nombre, tipo_evento_id)
           VALUES (?, ?, ?, ?)`,
          [nombreConRol, alumno.carnet, alumno.nombre_completo, tipoEventoId]
        );
      }

      await connection.commit();
      return profesores.length;
    } catch (error) {
      // Si una fila falla, ninguna queda escrita: el jurado es todo o nada.
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Inserta la terna de un catedrático (privado o seminario) en una transacción:
   * una fila por alumno asignado a ese catedrático.
   *
   * @param {object} datos
   * @param {string} datos.profesorNombre Nombre ya formateado por el sorteo.
   * @param {Array<{carnet: string, nombre_completo: string}>} datos.alumnos Alumnos del grupo.
   * @param {number} datos.tipoEventoId Modalidad a registrar.
   * @returns {Promise<number>} Número de filas insertadas.
   */
  async crearAsignacionesTerna({ profesorNombre, alumnos, tipoEventoId }) {
    const nombreLimpio = profesorNombre || CATEDRATICO_POR_DEFECTO;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const alumno of alumnos) {
        await connection.query(
          `INSERT INTO asignaciones
             (profesor_nombre, alumno_carnet, alumno_nombre, tipo_evento_id)
           VALUES (?, ?, ?, ?)`,
          [nombreLimpio, alumno.carnet, alumno.nombre_completo, tipoEventoId]
        );
      }

      await connection.commit();
      return alumnos.length;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Devuelve el historial de sorteos con el formato que consume el módulo de
   * reportes: modalidad, catedrático, "carnet - nombre" y fecha legible.
   *
   * @param {{limite: number, desplazamiento: number}} opciones Paginación acotada por el servicio.
   * @returns {Promise<object[]>}
   */
  async listarParaReporte({ limite, desplazamiento }) {
    const sql = `
      SELECT
        COALESCE(te.nombre, 'Tesis') AS modalidad,
        a.profesor_nombre,
        CONCAT(a.alumno_carnet, ' - ', a.alumno_nombre) AS alumno_info,
        DATE_FORMAT(a.fecha_asignacion, '%d/%m/%Y %H:%i') AS fecha
      FROM asignaciones a
      LEFT JOIN tipos_evento te ON a.tipo_evento_id = te.id
      ORDER BY a.fecha_asignacion DESC
      LIMIT ? OFFSET ?
    `;
    const [filas] = await pool.query(sql, [limite, desplazamiento]);
    return filas;
  },

  /**
   * Cuenta el total de asignaciones registradas.
   * @returns {Promise<number>}
   */
  async contar() {
    const [filas] = await pool.query("SELECT COUNT(*) AS total FROM asignaciones");
    return Number(filas[0].total);
  },

  /**
   * Cuenta cuántas asignaciones pertenecen a un lote (una marca de tiempo
   * concreta). Permite responder 404 antes de borrar algo que no existe.
   *
   * @param {string} fecha Marca de tiempo en formato 'dd/mm/aaaa hh:mm'.
   * @returns {Promise<number>}
   */
  async contarPorFechaLote(fecha) {
    const sql = `
      SELECT COUNT(*) AS total
      FROM asignaciones
      WHERE DATE_FORMAT(fecha_asignacion, '%d/%m/%Y %H:%i') = ?
    `;
    const [filas] = await pool.query(sql, [fecha]);
    return Number(filas[0].total);
  },

  /**
   * Cuenta las asignaciones de un alumno concreto dentro de un lote.
   * @param {string} carnet Carnet del alumno.
   * @param {string} fecha Marca de tiempo en formato 'dd/mm/aaaa hh:mm'.
   * @returns {Promise<number>}
   */
  async contarPorAlumnoYFecha(carnet, fecha) {
    const sql = `
      SELECT COUNT(*) AS total
      FROM asignaciones
      WHERE alumno_carnet = ?
        AND DATE_FORMAT(fecha_asignacion, '%d/%m/%Y %H:%i') = ?
    `;
    const [filas] = await pool.query(sql, [carnet, fecha]);
    return Number(filas[0].total);
  },

  /**
   * Elimina las asignaciones de un alumno concreto dentro de un lote.
   * En tesis, un alumno tiene tres filas (una por miembro del jurado); las
   * borra todas para no dejar un jurado incompleto.
   *
   * @param {string} carnet Carnet del alumno.
   * @param {string} fecha Marca de tiempo en formato 'dd/mm/aaaa hh:mm'.
   * @returns {Promise<number>} Filas eliminadas.
   */
  async eliminarPorAlumnoYFecha(carnet, fecha) {
    const sql = `
      DELETE FROM asignaciones
      WHERE alumno_carnet = ?
        AND DATE_FORMAT(fecha_asignacion, '%d/%m/%Y %H:%i') = ?
    `;
    const [resultado] = await pool.query(sql, [carnet, fecha]);
    return resultado.affectedRows;
  },

  /**
   * Elimina un lote completo de asignaciones por su marca de tiempo.
   * @param {string} fecha Marca de tiempo en formato 'dd/mm/aaaa hh:mm'.
   * @returns {Promise<number>} Filas eliminadas.
   */
  async eliminarLotePorFecha(fecha) {
    const sql = `
      DELETE FROM asignaciones
      WHERE DATE_FORMAT(fecha_asignacion, '%d/%m/%Y %H:%i') = ?
    `;
    const [resultado] = await pool.query(sql, [fecha]);
    return resultado.affectedRows;
  },
};

module.exports = AsignacionesRepository;
