/**
 * @fileoverview Acceso a datos de la tabla `asignaciones`.
 *
 * IMPORTANTE: la forma de los INSERT reproduce exactamente la lógica original
 * del sorteo (roles Presidente/Vocal 1/Vocal 2 y el formato
 * "Nombre (Rol)" para tesis; un catedrático por lote de alumnos para
 * privado/seminario). El módulo de reportes agrupa por esas cadenas, así que
 * cualquier cambio de formato rompería las actas ya generadas.
 *
 * Cada fila lleva además `lote_id`: el identificador del guardado al que
 * pertenece. Lo genera la capa de servicio; este módulo solo lo persiste y
 * lo usa como criterio de búsqueda y borrado.
 */

const { pool } = require("../config/db");

// Nota sobre inyección SQL, aplicable a todo el módulo: ningún valor recibido
// se concatena en el texto de la sentencia. Cada `?` se sustituye por el driver
// mysql2, que escapa el valor según su tipo antes de enviarlo; así una entrada
// como `x' OR '1'='1` se almacena como texto literal y no altera la consulta.

/** Roles del jurado de tesis, en el orden en que salen de la ruleta. */
const ROLES_TESIS = ["Presidente", "Vocal 1", "Vocal 2"];

/** Nombre por defecto cuando el sorteo no aporta uno, igual que en la versión previa. */
const CATEDRATICO_POR_DEFECTO = "Catedrático";

/** Sentencia de inserción común a ambas modalidades. */
const SQL_INSERTAR_ASIGNACION = `
  INSERT INTO asignaciones
    (lote_id, profesor_nombre, alumno_carnet, alumno_nombre, tipo_evento_id)
  VALUES (?, ?, ?, ?, ?)
`;

const AsignacionesRepository = {
  /**
   * Inserta el jurado de tesis de un alumno dentro de una transacción.
   * Se crea una fila por cada catedrático, con su rol incrustado en el nombre.
   *
   * @param {object} datos
   * @param {string} datos.loteId Identificador del lote al que pertenecen las filas.
   * @param {{carnet: string, nombre_completo: string}} datos.alumno Alumno sorteado.
   * @param {Array<{nombre_completo?: string}>} datos.profesores Jurado, en orden de sorteo.
   * @param {number} datos.tipoEventoId Modalidad a registrar.
   * @returns {Promise<number>} Número de filas insertadas.
   */
  async crearAsignacionesTesis({ loteId, alumno, profesores, tipoEventoId }) {
    // Una transacción exige que todas las sentencias usen la MISMA conexión;
    // por eso se reserva una conexión dedicada en lugar de usar `pool.query`,
    // que podría repartir cada INSERT en una conexión distinta.
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // El índice `i` vincula la posición de sorteo con el rol del jurado:
      // el primer catedrático extraído es Presidente, el segundo Vocal 1 y el
      // tercero Vocal 2.
      for (let i = 0; i < profesores.length; i++) {
        const nombreConRol = `${
          profesores[i].nombre_completo || CATEDRATICO_POR_DEFECTO
        } (${ROLES_TESIS[i]})`;

        await connection.query(SQL_INSERTAR_ASIGNACION, [
          loteId,
          nombreConRol,
          alumno.carnet,
          alumno.nombre_completo,
          tipoEventoId,
        ]);
      }

      await connection.commit();
      return profesores.length;
    } catch (error) {
      // Si una fila falla, ninguna queda escrita: el jurado es todo o nada.
      // El error se relanza para que el manejador central decida la respuesta.
      await connection.rollback();
      throw error;
    } finally {
      // Se ejecuta tanto en éxito como en fallo: devolver la conexión al pool
      // evita fugas que, acumuladas, bloquearían al resto de peticiones.
      connection.release();
    }
  },

  /**
   * Inserta la terna de un catedrático (privado o seminario) en una transacción:
   * una fila por alumno asignado a ese catedrático.
   *
   * @param {object} datos
   * @param {string} datos.loteId Identificador del lote al que pertenecen las filas.
   * @param {string} datos.profesorNombre Nombre ya formateado por el sorteo.
   * @param {Array<{carnet: string, nombre_completo: string}>} datos.alumnos Alumnos del grupo.
   * @param {number} datos.tipoEventoId Modalidad a registrar.
   * @returns {Promise<number>} Número de filas insertadas.
   */
  async crearAsignacionesTerna({ loteId, profesorNombre, alumnos, tipoEventoId }) {
    const nombreLimpio = profesorNombre || CATEDRATICO_POR_DEFECTO;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const alumno of alumnos) {
        await connection.query(SQL_INSERTAR_ASIGNACION, [
          loteId,
          nombreLimpio,
          alumno.carnet,
          alumno.nombre_completo,
          tipoEventoId,
        ]);
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
   * Inserta una terna de tesis COMPLETA (jurado + todos sus alumnos) en una
   * única transacción MariaDB y bajo un único `lote_id`.
   *
   * @description Secuencia en una conexión dedicada del pool:
   *  1. `beginTransaction()`: mysql2 envía `START TRANSACTION`. Desde aquí
   *     InnoDB mantiene los INSERT sin confirmar, invisibles para otras
   *     conexiones.
   *  2. Bucle de inserción: una fila por cada par (alumno, catedrático), con
   *     el rol incrustado ("Nombre (Presidente)") y el mismo `lote_id`.
   *  3. `commit()` (`COMMIT`) solo si TODAS las filas se insertaron.
   *  4. Ante cualquier error (restricción, desconexión, fallo en la fila k):
   *     `rollback()` (`ROLLBACK`) descarta también las filas 1..k−1, de modo que
   *     ningún alumno de la terna queda en la base de datos. El error se
   *     relanza para que el manejador central responda.
   * Requiere motor transaccional (InnoDB, el predeterminado de MariaDB).
   *
   * @param {object} datos
   * @param {string} datos.loteId Identificador del lote de la terna.
   * @param {Array<{carnet: string, nombre_completo: string}>} datos.alumnos Alumnos de la terna.
   * @param {Array<{nombre_completo?: string}>} datos.profesores Jurado, en orden de sorteo.
   * @param {number} datos.tipoEventoId Modalidad a registrar.
   * @returns {Promise<number>} Número de filas insertadas (alumnos × 3).
   */
  async crearTernaTesis({ loteId, alumnos, profesores, tipoEventoId }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let insertadas = 0;
      for (const alumno of alumnos) {
        for (let i = 0; i < profesores.length; i++) {
          const nombreConRol = `${
            profesores[i].nombre_completo || CATEDRATICO_POR_DEFECTO
          } (${ROLES_TESIS[i]})`;

          await connection.query(SQL_INSERTAR_ASIGNACION, [
            loteId,
            nombreConRol,
            alumno.carnet,
            alumno.nombre_completo,
            tipoEventoId,
          ]);
          insertadas++;
        }
      }

      await connection.commit();
      return insertadas;
    } catch (error) {
      // Todo o nada: la terna no puede quedar a medias en el acta.
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Devuelve el historial de sorteos con el formato que consume el módulo de
   * reportes: lote, modalidad, catedrático, "carnet - nombre" y fecha legible.
   *
   * @param {{limite: number, desplazamiento: number}} opciones Paginación acotada por el servicio.
   * @returns {Promise<object[]>}
   */
  async listarParaReporte({ limite, desplazamiento }) {
    // LEFT JOIN (y no INNER JOIN) conserva la asignación aunque su modalidad
    // no se encuentre en el catálogo; COALESCE le da entonces un nombre visible.
    // La fecha ya es solo informativa: el agrupamiento se hace por `lote_id`.
    // `a.id` desempata filas con la misma marca de tiempo para que el orden
    // sea estable entre páginas.
    const sql = `
      SELECT
        a.lote_id,
        COALESCE(te.nombre, 'Tesis') AS modalidad,
        a.profesor_nombre,
        CONCAT(a.alumno_carnet, ' - ', a.alumno_nombre) AS alumno_info,
        DATE_FORMAT(a.fecha_asignacion, '%d/%m/%Y %H:%i') AS fecha
      FROM asignaciones a
      LEFT JOIN tipos_evento te ON a.tipo_evento_id = te.id
      ORDER BY a.fecha_asignacion DESC, a.id DESC
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
   * Obtiene la modalidad registrada en un lote existente. Permite comprobar,
   * antes de adjuntar filas, que el lote existe y es de la misma modalidad.
   *
   * @param {string} loteId Identificador del lote.
   * @returns {Promise<number|null>} `tipo_evento_id` del lote, o null si no existe.
   */
  async obtenerTipoEventoDeLote(loteId) {
    const sql = `
      SELECT tipo_evento_id
      FROM asignaciones
      WHERE lote_id = ?
      LIMIT 1
    `;
    const [filas] = await pool.query(sql, [loteId]);
    return filas[0] ? Number(filas[0].tipo_evento_id) : null;
  },

  /**
   * Cuenta cuántas asignaciones pertenecen a un lote. Permite responder 404
   * antes de borrar algo que no existe.
   *
   * @param {string} loteId Identificador del lote.
   * @returns {Promise<number>}
   */
  async contarPorLote(loteId) {
    const sql = `
      SELECT COUNT(*) AS total
      FROM asignaciones
      WHERE lote_id = ?
    `;
    const [filas] = await pool.query(sql, [loteId]);
    return Number(filas[0].total);
  },

  /**
   * Cuenta las asignaciones de un alumno concreto dentro de un lote.
   * @param {string} loteId Identificador del lote.
   * @param {string} carnet Carnet del alumno.
   * @returns {Promise<number>}
   */
  async contarPorLoteYAlumno(loteId, carnet) {
    const sql = `
      SELECT COUNT(*) AS total
      FROM asignaciones
      WHERE lote_id = ?
        AND alumno_carnet = ?
    `;
    const [filas] = await pool.query(sql, [loteId, carnet]);
    return Number(filas[0].total);
  },

  /**
   * Elimina las asignaciones de un alumno concreto dentro de un lote.
   * En tesis, un alumno tiene tres filas (una por miembro del jurado); las
   * borra todas para no dejar un jurado incompleto.
   *
   * @param {string} loteId Identificador del lote.
   * @param {string} carnet Carnet del alumno.
   * @returns {Promise<number>} Filas eliminadas.
   */
  async eliminarPorLoteYAlumno(loteId, carnet) {
    const sql = `
      DELETE FROM asignaciones
      WHERE lote_id = ?
        AND alumno_carnet = ?
    `;
    const [resultado] = await pool.query(sql, [loteId, carnet]);
    return resultado.affectedRows;
  },

  /**
   * Elimina un lote completo de asignaciones por su identificador.
   * Solo afecta a las filas de ese lote, aunque otro sorteo se haya guardado
   * en el mismo minuto.
   *
   * @param {string} loteId Identificador del lote.
   * @returns {Promise<number>} Filas eliminadas.
   */
  async eliminarLote(loteId) {
    const sql = `
      DELETE FROM asignaciones
      WHERE lote_id = ?
    `;
    const [resultado] = await pool.query(sql, [loteId]);
    return resultado.affectedRows;
  },
};

module.exports = AsignacionesRepository;
