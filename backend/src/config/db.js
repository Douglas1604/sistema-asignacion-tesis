/**
 * @fileoverview Pool de conexiones a MariaDB.
 * Toda la configuración viene de variables de entorno validadas; aquí no hay
 * credenciales literales. El pool se exporta para uso exclusivo de la capa
 * de repositorios: los servicios y controladores nunca lo importan directamente.
 */

const mysql = require("mysql2/promise");
const env = require("./env");

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  // Desactivamos la interpolación múltiple para cerrar la puerta a inyección
  // por apilamiento de sentencias (`; DROP TABLE ...`).
  multipleStatements: false,
  // Las fechas se manejan como string desde SQL (DATE_FORMAT) para que el
  // reporte no dependa de la zona horaria del proceso de Node.
  dateStrings: true,
});

/**
 * Comprueba que la base de datos responde. Se llama una vez al arrancar.
 * @returns {Promise<void>} Rechaza si no hay conexión.
 */
async function verificarConexion() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

/** Cierra el pool de forma ordenada durante el apagado del servidor. */
async function cerrarPool() {
  await pool.end();
}

module.exports = { pool, verificarConexion, cerrarPool };
