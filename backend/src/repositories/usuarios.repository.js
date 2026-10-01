/**
 * @fileoverview Acceso a datos de la tabla `usuarios`.
 * Única capa autorizada a escribir SQL. Reglas:
 *  - Nunca `SELECT *`: se enumeran las columnas necesarias.
 *  - Todo valor variable viaja como marcador `?` (consulta parametrizada).
 *  - `password_hash` solo se selecciona en la consulta de autenticación.
 */

const { pool } = require("../config/db");
const estadoEsquema = require("../config/schema-state");

/** Columnas públicas de usuario. Excluye deliberadamente `password_hash`. */
const COLUMNAS_PUBLICAS = `
  u.id,
  u.username,
  u.email,
  u.rol_id,
  r.nombre AS rol_nombre,
  u.creado_en
`;

/**
 * Fragmento que restringe a cuentas habilitadas.
 *
 * La columna `active` la añade el arranque (`config/bootstrap.js`) cuando la
 * base aún no la tiene. Si no está disponible, el filtro se omite en lugar de
 * provocar un error de columna desconocida en cada login.
 *
 * @returns {string} Cláusula a concatenar, o cadena vacía.
 */
function filtroActivo() {
  return estadoEsquema.usuariosActive ? "AND u.active = 1" : "";
}

const UsuariosRepository = {
  /**
   * Busca un usuario por correo O por nombre de usuario, incluyendo su hash.
   * Solo la usa el login.
   *
   * @description El mismo campo del formulario sirve para ambas cosas: el
   * administrador puede entrar como `admin` o como `admin@…`, sin que el
   * cliente tenga que saber cuál de los dos guarda la base de datos. Ambos
   * valores viajan como marcadores `?` independientes: no se concatena nada.
   *
   * @param {string} identificador Correo en minúsculas o nombre de usuario.
   * @returns {Promise<object|null>} Fila con hash, o null si no existe.
   */
  async buscarPorEmailConHash(identificador) {
    // El JOIN con `roles` resuelve en la misma consulta el nombre del rol que
    // viajará como claim en el JWT. `LIMIT 1` refuerza la unicidad.
    const sql = `
      SELECT u.id, u.username, u.email, u.password_hash, u.rol_id, r.nombre AS rol_nombre
      FROM usuarios u
      LEFT JOIN roles r ON r.id = u.rol_id
      WHERE (u.email = ? OR u.username = ?)
        ${filtroActivo()}
      LIMIT 1
    `;
    // mysql2 devuelve la tupla [filas, metadatosDeColumnas]; solo interesan las filas.
    const [filas] = await pool.query(sql, [identificador, identificador]);
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
        ${filtroActivo()}
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
