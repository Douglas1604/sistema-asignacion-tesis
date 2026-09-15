/**
 * @fileoverview Pruebas de la persistencia atómica de ternas de tesis
 * (POST /api/v1/asignaciones/terna).
 *
 * El pool de mysql2 se sustituye por un doble que EMULA la semántica
 * transaccional de InnoDB sin necesidad de MariaDB:
 *  - Los INSERT de una transacción quedan pendientes en su conexión.
 *  - COMMIT los publica en la "tabla"; ROLLBACK los descarta.
 * Así se puede provocar un fallo a mitad del bucle de inserción y comprobar que
 * no queda ninguna fila huérfana.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { app, instalarDobles, obtenerToken, PROFESOR } = require("./helpers/entorno");
const { pool } = require("../src/config/db");
const AsignacionesRepository = require("../src/repositories/asignaciones.repository");

/** Filas confirmadas (visibles tras COMMIT). */
let tabla = [];
/** Registro de operaciones transaccionales, en orden. */
let operaciones = [];
/** Si es un número k, el k-ésimo INSERT (1-based) lanza un error de BD. */
let fallarEnInsert = null;

/**
 * Crea una conexión simulada con transacción propia.
 * @returns {object} Conexión compatible con la API promise de mysql2.
 */
function crearConexionSimulada() {
  let pendientes = null;
  let inserts = 0;

  return {
    async beginTransaction() {
      operaciones.push("START TRANSACTION");
      pendientes = [];
    },
    async query(sql, params) {
      if (!/^\s*INSERT/i.test(sql)) return [[]];
      inserts++;
      if (fallarEnInsert !== null && inserts === fallarEnInsert) {
        operaciones.push(`INSERT#${inserts} (falla)`);
        const error = new Error("ER_DATA_TOO_LONG: Data too long for column 'alumno_nombre'");
        error.code = "ER_DATA_TOO_LONG";
        throw error;
      }
      operaciones.push(`INSERT#${inserts}`);
      const [lote_id, profesor_nombre, alumno_carnet, alumno_nombre, tipo_evento_id] = params;
      const fila = { lote_id, profesor_nombre, alumno_carnet, alumno_nombre, tipo_evento_id };
      // Fuera de transacción se confirmaría al instante (autocommit).
      if (pendientes) pendientes.push(fila);
      else tabla.push(fila);
      return [{ affectedRows: 1 }];
    },
    async commit() {
      operaciones.push("COMMIT");
      tabla.push(...pendientes);
      pendientes = null;
    },
    async rollback() {
      operaciones.push("ROLLBACK");
      pendientes = null;
    },
    release() {
      operaciones.push("RELEASE");
    },
  };
}

test.before(async () => {
  await instalarDobles();
  // `instalarDobles` no sustituye `crearTernaTesis`: se prueba el repositorio
  // REAL contra el pool simulado.
  pool.getConnection = async () => crearConexionSimulada();
});

test.beforeEach(() => {
  tabla = [];
  operaciones = [];
  fallarEnInsert = null;
});

/** Terna de prueba: 3 catedráticos y `n` alumnos. */
function terna(n = 4) {
  return {
    profesores: [
      { nombre_completo: "Ing. A" },
      { nombre_completo: "Ing. B" },
      { nombre_completo: "Ing. C" },
    ],
    alumnos: Array.from({ length: n }, (_, i) => ({
      carnet: `1990-12-${1000 + i}`,
      nombre_completo: `Tesista ${i + 1}`,
    })),
    tipo_evento_id: 3,
  };
}

/**
 * Envía una terna autenticado como administrador.
 * @param {object} cuerpo Carga a enviar.
 * @returns {Promise<import("supertest").Response>}
 */
async function enviarTerna(cuerpo) {
  const token = await obtenerToken(request(app()));
  return request(app())
    .post("/api/v1/asignaciones/terna")
    .set("Authorization", `Bearer ${token}`)
    .send(cuerpo);
}

// ---------------------------------------------------------------------------
// Repositorio: transacción real sobre la conexión
// ---------------------------------------------------------------------------

test("el repositorio confirma la terna completa en una sola transacción", async () => {
  const registros = await AsignacionesRepository.crearTernaTesis({
    loteId: "44444444-4444-4444-8444-444444444444",
    alumnos: terna(2).alumnos,
    profesores: terna(2).profesores,
    tipoEventoId: 3,
  });

  assert.equal(registros, 6);
  assert.deepEqual(operaciones, [
    "START TRANSACTION",
    "INSERT#1", "INSERT#2", "INSERT#3", "INSERT#4", "INSERT#5", "INSERT#6",
    "COMMIT",
    "RELEASE",
  ]);
  assert.equal(tabla.length, 6);
  assert.ok(tabla.every((f) => f.lote_id === "44444444-4444-4444-8444-444444444444"));
});

test("un fallo a mitad de la inserción ejecuta ROLLBACK y no deja filas huérfanas", async () => {
  // 4 alumnos x 3 jurados = 12 INSERT; falla el 7.º (primer jurado del 3.er alumno).
  fallarEnInsert = 7;

  await assert.rejects(
    AsignacionesRepository.crearTernaTesis({
      loteId: "55555555-5555-4555-8555-555555555555",
      alumnos: terna(4).alumnos,
      profesores: terna(4).profesores,
      tipoEventoId: 3,
    }),
    { code: "ER_DATA_TOO_LONG" }
  );

  assert.deepEqual(operaciones, [
    "START TRANSACTION",
    "INSERT#1", "INSERT#2", "INSERT#3", "INSERT#4", "INSERT#5", "INSERT#6",
    "INSERT#7 (falla)",
    "ROLLBACK",
    "RELEASE",
  ]);
  assert.ok(!operaciones.includes("COMMIT"), "nunca debe confirmarse");
  assert.equal(tabla.length, 0, "los 6 INSERT previos al fallo no deben persistir");
});

test("la conexión vuelve al pool también cuando falla el primer INSERT", async () => {
  fallarEnInsert = 1;

  await assert.rejects(
    AsignacionesRepository.crearTernaTesis({
      loteId: "66666666-6666-4666-8666-666666666666",
      alumnos: terna(1).alumnos,
      profesores: terna(1).profesores,
      tipoEventoId: 3,
    })
  );

  assert.deepEqual(operaciones, ["START TRANSACTION", "INSERT#1 (falla)", "ROLLBACK", "RELEASE"]);
  assert.equal(tabla.length, 0);
});

// ---------------------------------------------------------------------------
// Endpoint POST /asignaciones/terna
// ---------------------------------------------------------------------------

test("POST /asignaciones/terna guarda jurado y alumnos bajo un único lote", async () => {
  const respuesta = await enviarTerna(terna(4));

  assert.equal(respuesta.status, 201);
  assert.equal(respuesta.body.data.registros, 12);
  assert.equal(respuesta.body.data.alumnos, 4);
  assert.equal(respuesta.body.data.modo, "tesis");
  assert.match(respuesta.body.data.lote_id, /^[0-9a-f-]{36}$/);

  assert.equal(tabla.length, 12);
  assert.ok(tabla.every((f) => f.lote_id === respuesta.body.data.lote_id));
  // Roles en orden de sorteo para cada alumno: formato que consumen las actas.
  assert.deepEqual(
    tabla.filter((f) => f.alumno_carnet === "1990-12-1000").map((f) => f.profesor_nombre),
    ["Ing. A (Presidente)", "Ing. B (Vocal 1)", "Ing. C (Vocal 2)"]
  );
  assert.equal(operaciones.filter((o) => o === "START TRANSACTION").length, 1);
  assert.equal(operaciones.filter((o) => o === "COMMIT").length, 1);
});

test("si la transacción falla a mitad, la API responde 500 y no guarda ningún alumno", async () => {
  fallarEnInsert = 10;

  const respuesta = await enviarTerna(terna(4));

  assert.equal(respuesta.status, 500);
  assert.equal(respuesta.body.success, false);
  // No se filtran detalles del motor al cliente.
  assert.ok(!JSON.stringify(respuesta.body).includes("ER_DATA_TOO_LONG"));

  assert.equal(tabla.length, 0, "ninguna fila de la terna debe persistir");
  assert.ok(operaciones.includes("ROLLBACK"));
  assert.ok(!operaciones.includes("COMMIT"));
});

test("una terna con un carnet repetido se rechaza sin abrir transacción", async () => {
  const cuerpo = terna(3);
  cuerpo.alumnos[2].carnet = cuerpo.alumnos[0].carnet;

  const respuesta = await enviarTerna(cuerpo);

  assert.equal(respuesta.status, 422);
  assert.ok(
    respuesta.body.error.details.some((d) => d.campo === "body.alumnos.2.carnet")
  );
  assert.equal(operaciones.length, 0);
});

test("una terna sin jurado completo o sin alumnos se rechaza", async () => {
  const sinJurado = terna(2);
  sinJurado.profesores.pop();
  assert.equal((await enviarTerna(sinJurado)).status, 422);

  const sinAlumnos = terna(0);
  assert.equal((await enviarTerna(sinAlumnos)).status, 422);

  const conLote = { ...terna(1), lote_id: "44444444-4444-4444-8444-444444444444" };
  assert.equal((await enviarTerna(conLote)).status, 422, "no admite lote_id externo");

  assert.equal(operaciones.length, 0);
});

test("registrar una terna exige autenticación y rol administrador", async () => {
  const sinToken = await request(app()).post("/api/v1/asignaciones/terna").send(terna(1));
  assert.equal(sinToken.status, 401);

  const tokenProfesor = await obtenerToken(request(app()), PROFESOR.email);
  const comoProfesor = await request(app())
    .post("/api/v1/asignaciones/terna")
    .set("Authorization", `Bearer ${tokenProfesor}`)
    .send(terna(1));
  assert.equal(comoProfesor.status, 403);

  assert.equal(tabla.length, 0);
});
