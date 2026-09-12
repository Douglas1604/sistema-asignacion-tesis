/**
 * @fileoverview Migración de contraseñas heredadas a bcrypt.
 *
 * CONTEXTO: la versión anterior de la API comparaba la contraseña escrita por
 * el usuario directamente contra la columna `password_hash`, que en la práctica
 * guardaba texto plano. La API nueva solo acepta hashes bcrypt, así que esas
 * cuentas no podrían iniciar sesión hasta ejecutar este script.
 *
 * Qué hace: por cada usuario cuyo `password_hash` NO tenga formato bcrypt, toma
 * el valor actual como si fuera la contraseña en claro y lo sustituye por su
 * hash. Los usuarios conservan su contraseña; solo cambia cómo se almacena.
 *
 * Uso:
 *   node scripts/migrate-passwords.js            (simulación, no escribe nada)
 *   node scripts/migrate-passwords.js --aplicar  (aplica los cambios)
 *
 * Tras migrar, pide a los usuarios que cambien su contraseña: los valores
 * heredados eran débiles y han estado guardados en claro.
 */

const { pool, cerrarPool } = require("../src/config/db");
const { hashPassword, esHashBcrypt } = require("../src/utils/password");

/** Sin esta bandera el script solo informa de lo que haría. */
const APLICAR = process.argv.includes("--aplicar");

/**
 * Detecta las cuentas con contraseña heredada y, en modo aplicación, las
 * convierte a bcrypt dentro de una única transacción (todo o nada).
 *
 * @returns {Promise<void>}
 * @throws {Error} Si falla la consulta o alguna actualización; en ese caso se
 * revierte la transacción y ninguna cuenta queda a medio migrar.
 */
async function main() {
  const [usuarios] = await pool.query(
    "SELECT id, username, email, password_hash FROM usuarios"
  );

  const pendientes = usuarios.filter(
    (usuario) => !esHashBcrypt(usuario.password_hash)
  );

  console.log(`Usuarios totales:            ${usuarios.length}`);
  console.log(`Ya migrados (bcrypt):        ${usuarios.length - pendientes.length}`);
  console.log(`Pendientes de migrar:        ${pendientes.length}`);

  if (pendientes.length === 0) {
    console.log("\nNo hay nada que migrar.");
    return;
  }

  // Nunca imprimimos el valor de la columna: es la contraseña real del usuario.
  console.log("\nCuentas afectadas:");
  for (const usuario of pendientes) {
    console.log(`  - id=${usuario.id} ${usuario.email || usuario.username}`);
  }

  if (!APLICAR) {
    console.log(
      "\n[SIMULACIÓN] No se ha modificado nada." +
        "\nVuelve a ejecutar con --aplicar para escribir los cambios."
    );
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const usuario of pendientes) {
      const hash = await hashPassword(usuario.password_hash);
      await connection.query(
        "UPDATE usuarios SET password_hash = ? WHERE id = ?",
        [hash, usuario.id]
      );
    }

    await connection.commit();
    console.log(`\nListo: ${pendientes.length} contraseña(s) migradas a bcrypt.`);
    console.log(
      "Recomendación: solicita a estos usuarios que cambien su contraseña."
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

main()
  .catch((error) => {
    console.error("La migración falló:", error.message);
    process.exitCode = 1;
  })
  .finally(cerrarPool);
