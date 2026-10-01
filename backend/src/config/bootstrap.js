/**
 * @fileoverview Preparación idempotente de la base de datos al arrancar.
 *
 * CONTEXTO: el despliegue de producción no expone la consola de MariaDB, así
 * que ni las migraciones ni el alta del administrador pueden ejecutarse a
 * mano. Este módulo hace ambas cosas desde el propio arranque del servidor y
 * de forma IDEMPOTENTE: ejecutarlo mil veces deja el mismo resultado que
 * ejecutarlo una.
 *
 * Qué hace, en orden:
 *   1. Detecta qué columnas existen ya (información que publica en
 *      `schema-state.js` para que los repositorios adapten su SQL).
 *   2. Añade las columnas que falten: `usuarios.active`, `asignaciones.active`
 *      y `asignaciones.lote_id` (esta última con relleno de históricos).
 *   3. Siembra los catálogos obligatorios (`roles`, `tipos_evento`).
 *   4. Siembra o reactiva la cuenta administradora (`seedAdminUser`).
 *
 * Política de fallos: ninguna de estas tareas aborta el arranque. Si el
 * usuario de base de datos no tiene permiso de ALTER, se registra el motivo y
 * el servidor sigue funcionando con las capacidades que sí detectó.
 */

const { randomBytes, randomUUID } = require("crypto");

const { pool } = require("./db");
const env = require("./env");
const logger = require("./logger");
const estadoEsquema = require("./schema-state");
const { hashPassword, esHashBcrypt } = require("../utils/password");

/** Filas que se actualizan por sentencia al rellenar `lote_id` en históricos. */
const TAMANO_LOTE_BACKFILL = 500;

/**
 * Comprueba si una columna existe en la base de datos en uso.
 *
 * Se consulta `information_schema` en lugar de intentar el ALTER y capturar el
 * error: así se distingue "ya existe" de "no tengo permisos", que son dos
 * situaciones muy distintas de cara al diagnóstico.
 *
 * @param {string} tabla Nombre de la tabla.
 * @param {string} columna Nombre de la columna.
 * @returns {Promise<boolean>}
 */
async function columnaExiste(tabla, columna) {
  const [filas] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [tabla, columna]
  );
  return Number(filas[0].total) > 0;
}

/**
 * Comprueba si una tabla existe en la base de datos en uso.
 * @param {string} tabla Nombre de la tabla.
 * @returns {Promise<boolean>}
 */
async function tablaExiste(tabla) {
  const [filas] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tabla]
  );
  return Number(filas[0].total) > 0;
}

/**
 * Añade una columna si falta y devuelve si, al terminar, está disponible.
 *
 * El nombre de la tabla, el de la columna y la definición son literales del
 * código fuente, nunca entrada del usuario: por eso pueden interpolarse en la
 * sentencia (un ALTER no admite marcadores `?` para identificadores).
 *
 * @param {string} tabla Tabla a modificar.
 * @param {string} columna Columna a añadir.
 * @param {string} definicion Definición SQL de la columna.
 * @returns {Promise<boolean>} true si la columna existe tras la llamada.
 */
async function asegurarColumna(tabla, columna, definicion) {
  if (await columnaExiste(tabla, columna)) return true;

  try {
    await pool.query(
      `ALTER TABLE \`${tabla}\` ADD COLUMN \`${columna}\` ${definicion}`
    );
    logger.info("esquema_columna_creada", { tabla, columna });
    return true;
  } catch (error) {
    // Carrera entre dos instancias arrancando a la vez: la otra ya la creó.
    if (error.code === "ER_DUP_FIELDNAME") return true;

    logger.warn("esquema_columna_no_creada", {
      tabla,
      columna,
      motivo: error.message,
    });
    return false;
  }
}

/**
 * Crea un índice si no existe. Un índice ausente no impide funcionar, solo
 * hace más lento el listado y el borrado por lote, así que el fallo se
 * registra y se continúa.
 *
 * @param {string} tabla Tabla sobre la que se indexa.
 * @param {string} nombre Nombre del índice.
 * @param {string} columnas Lista de columnas entre paréntesis.
 * @returns {Promise<void>}
 */
async function asegurarIndice(tabla, nombre, columnas) {
  try {
    const [filas] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?`,
      [tabla, nombre]
    );
    if (Number(filas[0].total) > 0) return;

    await pool.query(
      `CREATE INDEX \`${nombre}\` ON \`${tabla}\` ${columnas}`
    );
    logger.info("esquema_indice_creado", { tabla, indice: nombre });
  } catch (error) {
    if (error.code === "ER_DUP_KEYNAME") return;
    logger.warn("esquema_indice_no_creado", {
      tabla,
      indice: nombre,
      motivo: error.message,
    });
  }
}

/**
 * Rellena `lote_id` en las filas históricas que se guardaron antes de que la
 * columna existiera.
 *
 * Reproduce el criterio de la migración 001: un lote es el conjunto de filas
 * de la misma modalidad guardadas en el mismo minuto, que es exactamente como
 * el módulo de reportes las agrupaba entonces. Así las actas ya emitidas
 * conservan su agrupamiento.
 *
 * @returns {Promise<number>} Número de filas actualizadas.
 */
async function rellenarLotesHistoricos() {
  const [pendientes] = await pool.query(
    `SELECT id,
            tipo_evento_id,
            DATE_FORMAT(fecha_asignacion, '%Y-%m-%d %H:%i') AS minuto
       FROM asignaciones
      WHERE lote_id IS NULL OR lote_id = ''`
  );

  if (pendientes.length === 0) return 0;

  // Agrupamos en memoria (modalidad + minuto) y asignamos un UUID por grupo.
  const grupos = new Map();
  for (const fila of pendientes) {
    const clave = `${fila.tipo_evento_id}|${fila.minuto}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila.id);
  }

  let actualizadas = 0;
  for (const ids of grupos.values()) {
    const loteId = randomUUID();

    // Se trocea el UPDATE: una lista IN con decenas de miles de elementos
    // superaría `max_allowed_packet`.
    for (let i = 0; i < ids.length; i += TAMANO_LOTE_BACKFILL) {
      const trozo = ids.slice(i, i + TAMANO_LOTE_BACKFILL);
      const marcadores = trozo.map(() => "?").join(", ");
      const [resultado] = await pool.query(
        `UPDATE asignaciones
            SET lote_id = ?
          WHERE id IN (${marcadores})
            AND (lote_id IS NULL OR lote_id = '')`,
        [loteId, ...trozo]
      );
      actualizadas += resultado.affectedRows;
    }
  }

  logger.info("esquema_lotes_historicos_rellenados", {
    filas: actualizadas,
    lotes: grupos.size,
  });
  return actualizadas;
}

/**
 * Inserta los catálogos sin los que la aplicación no puede operar.
 * `INSERT IGNORE` se apoya en el índice UNIQUE de `nombre`: si la fila ya
 * está, la sentencia no hace nada en lugar de fallar.
 *
 * @returns {Promise<void>}
 */
async function asegurarCatalogos() {
  try {
    await pool.query(
      `INSERT IGNORE INTO roles (nombre, descripcion) VALUES
         ('admin', 'Administrador del sistema'),
         ('profesor', 'Docente evaluador'),
         ('alumno', 'Estudiante')`
    );
    await pool.query(
      `INSERT IGNORE INTO tipos_evento (nombre, descripcion) VALUES
         ('Privado', 'Examen privado'),
         ('Seminario', 'Asignación general'),
         ('Tesis', 'Trabajo de graduación')`
    );
  } catch (error) {
    logger.warn("esquema_catalogos_no_sembrados", { motivo: error.message });
  }
}

/**
 * Resuelve el identificador del rol administrador.
 * Se busca por nombre porque el autoincremento de `roles` puede diferir entre
 * entornos; solo si no aparece se recurre al valor configurado.
 *
 * @returns {Promise<number>}
 */
async function obtenerRolAdminId() {
  try {
    const [filas] = await pool.query(
      "SELECT id FROM roles WHERE nombre = 'admin' LIMIT 1"
    );
    if (filas[0]) return Number(filas[0].id);
  } catch {
    // Se cae al valor por defecto.
  }
  return 1;
}

/**
 * Decide qué hash debe llevar la cuenta administradora.
 *
 * Orden de precedencia:
 *  1. `SEED_ADMIN_PASSWORD_HASH`: hash bcrypt ya calculado (lo preferimos
 *     porque evita que la contraseña en claro viaje por el entorno).
 *  2. `SEED_ADMIN_PASSWORD`: contraseña en claro, que se hashea aquí.
 *  3. Nada configurado: si la cuenta aún no existe se genera una contraseña
 *     aleatoria fuerte y se imprime UNA sola vez en el log del servidor, que
 *     es el único canal disponible cuando no hay acceso a la base de datos.
 *     Si la cuenta ya existe, no se toca su contraseña.
 *
 * @param {boolean} cuentaExiste Si ya hay una fila para el administrador.
 * @returns {Promise<{hash: string|null, passwordGenerada: string|null}>}
 */
async function resolverHashAdmin(cuentaExiste) {
  if (esHashBcrypt(env.SEED_ADMIN_PASSWORD_HASH)) {
    return { hash: env.SEED_ADMIN_PASSWORD_HASH, passwordGenerada: null };
  }

  if (env.SEED_ADMIN_PASSWORD.length > 0) {
    return {
      hash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      passwordGenerada: null,
    };
  }

  if (cuentaExiste) {
    return { hash: null, passwordGenerada: null };
  }

  // 24 caracteres en base64url: entropía de sobra y sin caracteres que se
  // pierdan al copiarlos desde una consola.
  const passwordGenerada = randomBytes(18).toString("base64url");
  return {
    hash: await hashPassword(passwordGenerada),
    passwordGenerada,
  };
}

/**
 * Crea o repara la cuenta administradora del sistema.
 *
 * @description Idempotente por diseño:
 *  - Si no existe ninguna cuenta con el correo ni con el nombre de usuario
 *    configurados, la INSERTA con rol administrador y habilitada.
 *  - Si ya existe, la ACTUALIZA: repone el hash (cuando hay contraseña
 *    configurada), asegura el rol administrador, rellena el correo o el
 *    nombre de usuario si estaban vacíos y la deja con `active = 1`.
 * Nunca escribe la contraseña en claro en el log salvo la generada
 * automáticamente, que es la única forma de conocerla.
 *
 * @returns {Promise<void>}
 */
async function seedAdminUser() {
  if (!env.SEED_ADMIN_ENABLED) {
    logger.info("seed_admin_omitido", { motivo: "SEED_ADMIN_ENABLED=false" });
    return;
  }

  const email = env.SEED_ADMIN_EMAIL;
  const username = env.SEED_ADMIN_USERNAME;

  // La búsqueda acepta cualquiera de los dos identificadores porque la cuenta
  // puede haberse creado a mano con solo uno de ellos.
  const [filas] = await pool.query(
    `SELECT id, username, email, password_hash, rol_id
       FROM usuarios
      WHERE email = ? OR username = ?
      LIMIT 1`,
    [email, username]
  );

  const existente = filas[0] || null;
  const rolAdminId = await obtenerRolAdminId();
  const { hash, passwordGenerada } = await resolverHashAdmin(existente !== null);

  const columnaActive = estadoEsquema.usuariosActive;

  if (!existente) {
    if (!hash) {
      logger.warn("seed_admin_sin_credencial", {
        motivo: "no hay SEED_ADMIN_PASSWORD ni SEED_ADMIN_PASSWORD_HASH",
      });
      return;
    }

    const columnas = ["username", "password_hash", "email", "rol_id"];
    const valores = [username, hash, email, rolAdminId];
    if (columnaActive) {
      columnas.push("active");
      valores.push(1);
    }

    await pool.query(
      `INSERT INTO usuarios (${columnas.join(", ")})
       VALUES (${columnas.map(() => "?").join(", ")})`,
      valores
    );

    logger.info("seed_admin_creado", { email, username, rol_id: rolAdminId });
  } else {
    // Se reparan solo los campos que pueden dejar la cuenta inutilizable:
    // el hash, el rol y (si existe la columna) el estado de habilitación.
    const asignaciones = ["rol_id = ?"];
    const valores = [rolAdminId];

    if (hash) {
      asignaciones.push("password_hash = ?");
      valores.push(hash);
    }
    if (!existente.email) {
      asignaciones.push("email = ?");
      valores.push(email);
    }
    if (!existente.username) {
      asignaciones.push("username = ?");
      valores.push(username);
    }
    if (columnaActive) {
      asignaciones.push("active = 1");
    }

    valores.push(existente.id);
    await pool.query(
      `UPDATE usuarios SET ${asignaciones.join(", ")} WHERE id = ?`,
      valores
    );

    logger.info("seed_admin_actualizado", {
      id: existente.id,
      email: existente.email || email,
      username: existente.username || username,
      passwordRepuesta: Boolean(hash),
    });
  }

  if (passwordGenerada) {
    // Única excepción a "nunca registrar credenciales": sin esto la cuenta
    // recién creada sería inaccesible. Debe cambiarse tras el primer acceso.
    logger.warn("seed_admin_password_generada", {
      email,
      username,
      password: passwordGenerada,
      aviso:
        "Contraseña generada automáticamente. Defina SEED_ADMIN_PASSWORD y cámbiela cuanto antes.",
    });
  }
}

/**
 * Detecta las capacidades del esquema y las publica en `schema-state`.
 * Se ejecuta siempre, incluso con `DB_AUTO_MIGRATE=false`, porque los
 * repositorios necesitan saber con qué columnas cuentan.
 *
 * @returns {Promise<void>}
 */
async function detectarEsquema() {
  estadoEsquema.usuariosActive = await columnaExiste("usuarios", "active");
  estadoEsquema.asignacionesActive = await columnaExiste(
    "asignaciones",
    "active"
  );
  estadoEsquema.asignacionesLoteId = await columnaExiste(
    "asignaciones",
    "lote_id"
  );
}

/**
 * Aplica las migraciones idempotentes que la aplicación necesita.
 * @returns {Promise<void>}
 */
async function aplicarMigraciones() {
  if (await tablaExiste("usuarios")) {
    estadoEsquema.usuariosActive = await asegurarColumna(
      "usuarios",
      "active",
      "TINYINT(1) NOT NULL DEFAULT 1"
    );
  }

  if (await tablaExiste("asignaciones")) {
    // `lote_id` se añade NULLABLE y se rellena después: convertirla en NOT NULL
    // con filas históricas sin valor haría fallar el ALTER. La aplicación
    // siempre escribe un lote, así que la nulabilidad solo afecta al pasado.
    const teniaLoteId = estadoEsquema.asignacionesLoteId;
    estadoEsquema.asignacionesLoteId = await asegurarColumna(
      "asignaciones",
      "lote_id",
      "CHAR(36) CHARACTER SET ascii NULL"
    );

    if (estadoEsquema.asignacionesLoteId) {
      try {
        await rellenarLotesHistoricos();
      } catch (error) {
        logger.warn("esquema_lotes_historicos_no_rellenados", {
          motivo: error.message,
        });
      }
      if (!teniaLoteId) {
        await asegurarIndice("asignaciones", "idx_asignaciones_lote", "(lote_id)");
      }
    }

    // Borrado lógico: un acta nunca se elimina físicamente, se anula. Así el
    // histórico queda auditable y ninguna fila dependiente se queda huérfana.
    const teniaActive = estadoEsquema.asignacionesActive;
    estadoEsquema.asignacionesActive = await asegurarColumna(
      "asignaciones",
      "active",
      "TINYINT(1) NOT NULL DEFAULT 1"
    );
    if (estadoEsquema.asignacionesActive && !teniaActive) {
      await asegurarIndice(
        "asignaciones",
        "idx_asignaciones_active",
        "(active)"
      );
    }
  }
}

/**
 * Punto de entrada llamado por `server.js` justo después de comprobar la
 * conexión y antes de abrir el puerto.
 *
 * @returns {Promise<void>} No rechaza nunca: los fallos se registran para que
 * un problema de permisos no impida arrancar la API.
 */
async function prepararBaseDeDatos() {
  try {
    await detectarEsquema();

    if (env.DB_AUTO_MIGRATE) {
      await aplicarMigraciones();
      await asegurarCatalogos();
    }

    await seedAdminUser();

    logger.info("bd_preparada", {
      autoMigrate: env.DB_AUTO_MIGRATE,
      usuariosActive: estadoEsquema.usuariosActive,
      asignacionesActive: estadoEsquema.asignacionesActive,
      asignacionesLoteId: estadoEsquema.asignacionesLoteId,
    });
  } catch (error) {
    // Arrancar con el esquema a medias es preferible a no arrancar: la API
    // seguirá sirviendo lo que sí funcione y el motivo queda en el log.
    logger.error("bd_preparacion_fallida", { motivo: error.message });
  }
}

module.exports = { prepararBaseDeDatos, seedAdminUser };
