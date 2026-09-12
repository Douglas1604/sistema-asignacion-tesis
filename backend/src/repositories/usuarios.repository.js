/**
 * @fileoverview Acceso a datos de la tabla `usuarios`.
 * Única capa autorizada a escribir SQL. Reglas:
 *  - Nunca `SELECT *`: se enumeran las columnas necesarias.
 *  - Todo valor variable viaja como marcador `?` (consulta parametrizada).
 *  - `password_hash` solo se selecciona en la consulta de autenticación.
 */

const { pool } = require("../config/db");

/** Columnas públicas de usuario. Excluye deliberadamente `password_hash`. */
const COLUMNAS_PUBLICAS = `
  u.id,
  u.username,
  u.email,
  u.rol_id,
  r.nombre AS rol_nombre,
  u.creado_en
`;

const UsuariosRepository = {
  /**
   * Busca un usuario por email incluyendo su hash, solo para el login.
   * @param {string} email Correo normalizado en minúsculas.
   * @returns {Promise<object|null>} Fila con hash, o null si no existe.
   */
  async buscarPorEmailConHash(email) {
    const sql = `
      SELECT u.id, u.username, u.email, u.password_hash, u.rol_id, r.nombre AS rol_nombre
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      WHERE u.email = ?
      LIMIT 1
    `;
    const [filas] = await pool.query(sql, [email]);
    return filas[0] || null;
  },

  /**
   * Obtiene un usuario por su identificador, sin datos sensibles.
   * @param {number} id Identificador del usuario.
   * @returns {Promise<object|null>}
   */
  async buscarPorId(id) {
    const sql = `
      SELECT ${COLUMNAS_PUBLICAS}
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      WHERE u.id = ?
      LIMIT 1
    `;
    const [filas] = await pool.query(sql, [id]);
    return filas[0] || null;
  },

  /**
   * Lista usuarios de forma paginada, sin datos sensibles.
   * LIMIT y OFFSET van parametrizados y además el servicio los acota.
   * @param {{limite: number, desplazamiento: number}} opciones
   * @returns {Promise<object[]>}
   */
  async listar({ limite, desplazamiento }) {
    const sql = `
      SELECT ${COLUMNAS_PUBLICAS}
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      ORDER BY u.id ASC
      LIMIT ? OFFSET ?
    `;
    const [filas] = await pool.query(sql, [limite, desplazamiento]);
    return filas;
  },

  /**
   * Cuenta el total de usuarios, para los metadatos de paginación.
   * @returns {Promise<number>}
   */
  async contar() {
    const [filas] = await pool.query("SELECT COUNT(*) AS total FROM usuarios");
    return Number(filas[0].total);
  },
};

module.exports = UsuariosRepository;
