/**
 * @fileoverview Pruebas de la preparación automática de la base de datos.
 *
 * Cubren lo que resuelve el 401 en producción sin acceso a MariaDB: que el
 * arranque cree la cuenta administradora si falta, que la repare y reactive si
 * ya está, y que sea idempotente (ejecutarlo dos veces no duplica nada).
 *
 * El pool de mysql2 se sustituye por un doble que registra cada sentencia, de
 * modo que no hace falta una base de datos real.
 */

// La semilla se configura ANTES de cargar `config/env`, que valida y congela
// la configuración al importarse.
process.env.SEED_ADMIN_ENABLED = "true";
process.env.SEED_ADMIN_USERNAME = "admin";
process.env.SEED_ADMIN_EMAIL = "dpinedah3@miumg.edu.gt";
process.env.SEED_ADMIN_PASSWORD = "ClaveDeArranque123";
process.env.DB_AUTO_MIGRATE = "true";

// Fija el entorno de pruebas antes de cargar la configuración.
require("./helpers/entorno");

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../src/config/db");
const estadoEsquema = require("../src/config/schema-state");
const { seedAdminUser } = require("../src/config/bootstrap");
const { esHashBcrypt } = require("../src/utils/password");

/** Sentencias capturadas: `{ sql, params }`. */
let sentencias = [];

/** Filas que devolverá el doble para la búsqueda del administrador. */
let filasUsuario = [];

test.before(() => {
  pool.query = async (sql, params = []) => {
    sentencias.push({ sql, params });

    if (/FROM roles WHERE nombre = 'admin'/i.test(sql)) {
      return [[{ id: 7 }]];
    }
    if (/FROM usuarios/i.test(sql)) {
      return [filasUsuario];
    }
    return [{ affectedRows: 1 }];
  };
});

test.beforeEach(() => {
  sentencias = [];
  filasUsuario = [];
  estadoEsquema.usuariosActive = true;
});

/** Devuelve la primera sentencia que coincide con el patrón. */
const buscar = (patron) => sentencias.find((s) => patron.test(s.sql));

test("crea la cuenta administradora cuando la base remota no la tiene", async () => {
  await seedAdminUser();

  const insert = buscar(/^\s*INSERT INTO usuarios/i);
  assert.ok(insert, "debe insertar el usuario administrador");

  // Orden declarado en la sentencia: username, password_hash, email, rol_id, active.
  const [username, hash, email, rolId, active] = insert.params;
  assert.equal(username, "admin");
  assert.equal(email, "dpinedah3@miumg.edu.gt");
  // El rol se resuelve por NOMBRE, no por un 1 fijo: el autoincremento de
  // `roles` puede diferir entre entornos.
  assert.equal(rolId, 7);
  assert.equal(active, 1);

  // La contraseña nunca se guarda en claro.
  assert.ok(esHashBcrypt(hash), "el password_hash debe ser bcrypt");
  assert.notEqual(hash, process.env.SEED_ADMIN_PASSWORD);
});

test("la búsqueda de la cuenta acepta el correo y el nombre de usuario", async () => {
  await seedAdminUser();

  const select = buscar(/SELECT id, username, email, password_hash, rol_id/i);
  assert.ok(select);
  assert.match(select.sql, /WHERE email = \? OR username = \?/);
  assert.deepEqual(select.params, ["dpinedah3@miumg.edu.gt", "admin"]);
});

test("si la cuenta ya existe la repara en vez de duplicarla", async () => {
  filasUsuario = [
    {
      id: 42,
      username: "admin",
      email: "dpinedah3@miumg.edu.gt",
      password_hash: "texto-plano-heredado",
      rol_id: 2,
    },
  ];

  await seedAdminUser();

  assert.equal(buscar(/^\s*INSERT INTO usuarios/i), undefined, "no debe insertar");

  const update = buscar(/^\s*UPDATE usuarios SET/i);
  assert.ok(update, "debe actualizar la cuenta existente");
  // Repone el hash, restituye el rol de administrador y la reactiva.
  assert.match(update.sql, /password_hash = \?/);
  assert.match(update.sql, /rol_id = \?/);
  assert.match(update.sql, /active = 1/);
  assert.equal(update.params[update.params.length - 1], 42);
});

test("rellena el correo si la cuenta se creó solo con nombre de usuario", async () => {
  filasUsuario = [
    { id: 8, username: "admin", email: null, password_hash: "x", rol_id: 1 },
  ];

  await seedAdminUser();

  const update = buscar(/^\s*UPDATE usuarios SET/i);
  assert.match(update.sql, /email = \?/);
  assert.ok(update.params.includes("dpinedah3@miumg.edu.gt"));
});

test("es idempotente: la segunda ejecución no crea una cuenta nueva", async () => {
  // Primera ejecución sobre una base vacía: inserta.
  await seedAdminUser();
  assert.ok(buscar(/^\s*INSERT INTO usuarios/i));

  // Segunda ejecución con la cuenta ya presente: solo actualiza.
  sentencias = [];
  filasUsuario = [
    {
      id: 1,
      username: "admin",
      email: "dpinedah3@miumg.edu.gt",
      password_hash: "$2b$12$" + "a".repeat(53),
      rol_id: 7,
    },
  ];

  await seedAdminUser();

  assert.equal(buscar(/^\s*INSERT INTO usuarios/i), undefined);
  assert.ok(buscar(/^\s*UPDATE usuarios SET/i));
});

test("omite la columna `active` si el esquema todavía no la tiene", async () => {
  // Escenario de una base a la que no se le pudo aplicar el ALTER: la semilla
  // debe seguir funcionando en lugar de fallar con "columna desconocida".
  estadoEsquema.usuariosActive = false;

  await seedAdminUser();

  const insert = buscar(/^\s*INSERT INTO usuarios/i);
  assert.ok(insert);
  assert.doesNotMatch(insert.sql, /active/);
  assert.equal(insert.params.length, 4);
});
