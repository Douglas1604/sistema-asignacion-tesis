/**
 * @fileoverview Pruebas del identificador real de lote (`lote_id`).
 *
 * Reproducen el defecto original: dos sorteos guardados dentro del MISMO minuto
 * compartían la marca de tiempo truncada que servía de identificador y se
 * listaban y borraban juntos. Aquí el repositorio se sustituye por una tabla
 * en memoria en la que todas las filas reciben exactamente la misma fecha,
 * de modo que la única forma de distinguir los lotes es `lote_id`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { app, instalarDobles, obtenerToken } = require("./helpers/entorno");
const AsignacionesRepository = require("../src/repositories/asignaciones.repository");

/** Todas las filas se registran en este mismo minuto. */
const MISMO_MINUTO = "14/09/2026 10:30";

/** Tabla `asignaciones` simulada. */
let tabla = [];

/**
 * Sustituye el repositorio de asignaciones por una tabla en memoria que imita
 * la semántica de las consultas reales (filtrado por `lote_id`).
 */
function instalarTablaEnMemoria() {
  const nombreModalidad = { 1: "Privado", 2: "Seminario", 3: "Tesis" };

  const insertar = (loteId, profesorNombre, alumno, tipoEventoId) =>
    tabla.push({
      lote_id: loteId,
      profesor_nombre: profesorNombre,
      alumno_carnet: alumno.carnet,
      alumno_nombre: alumno.nombre_completo,
      tipo_evento_id: tipoEventoId,
      fecha: MISMO_MINUTO,
    });

  AsignacionesRepository.crearAsignacionesTerna = async ({
    loteId,
    profesorNombre,
    alumnos,
    tipoEventoId,
  }) => {
    alumnos.forEach((alumno) => insertar(loteId, profesorNombre, alumno, tipoEventoId));
    return alumnos.length;
  };

  AsignacionesRepository.crearAsignacionesTesis = async ({
    loteId,
    alumno,
    profesores,
    tipoEventoId,
  }) => {
    profesores.forEach((p) => insertar(loteId, p.nombre_completo, alumno, tipoEventoId));
    return profesores.length;
  };

  AsignacionesRepository.obtenerTipoEventoDeLote = async (loteId) => {
    const fila = tabla.find((f) => f.lote_id === loteId);
    return fila ? fila.tipo_evento_id : null;
  };

  AsignacionesRepository.contarPorLote = async (loteId) =>
    tabla.filter((f) => f.lote_id === loteId).length;

  AsignacionesRepository.eliminarLote = async (loteId) => {
    const antes = tabla.length;
    tabla = tabla.filter((f) => f.lote_id !== loteId);
    return antes - tabla.length;
  };

  AsignacionesRepository.contarPorLoteYAlumno = async (loteId, carnet) =>
    tabla.filter((f) => f.lote_id === loteId && f.alumno_carnet === carnet).length;

  AsignacionesRepository.eliminarPorLoteYAlumno = async (loteId, carnet) => {
    const antes = tabla.length;
    tabla = tabla.filter((f) => !(f.lote_id === loteId && f.alumno_carnet === carnet));
    return antes - tabla.length;
  };

  AsignacionesRepository.listarParaReporte = async () =>
    tabla.map((f) => ({
      lote_id: f.lote_id,
      modalidad: nombreModalidad[f.tipo_evento_id],
      profesor_nombre: f.profesor_nombre,
      alumno_info: `${f.alumno_carnet} - ${f.alumno_nombre}`,
      fecha: f.fecha,
    }));

  AsignacionesRepository.contar = async () => tabla.length;
}

test.before(async () => {
  await instalarDobles();
  instalarTablaEnMemoria();
});

test.beforeEach(() => {
  tabla = [];
});

/**
 * Registra una terna de privado mediante la API.
 * @param {string} token JWT de administrador.
 * @param {string} profesor Nombre del catedrático.
 * @param {string[]} carnets Carnets de los alumnos del grupo.
 * @returns {Promise<import("supertest").Response>}
 */
function guardarTerna(token, profesor, carnets) {
  return request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: false,
      profesor_nombre: profesor,
      alumnos: carnets.map((carnet) => ({ carnet, nombre_completo: `Alumno ${carnet}` })),
      tipo_evento_id: 1,
    });
}

/**
 * Registra un alumno de tesis con su jurado mediante la API.
 * @param {string} token JWT de administrador.
 * @param {string} carnet Carnet del alumno.
 * @param {string} [loteId] Lote al que adjuntarse, si ya existe.
 * @returns {Promise<import("supertest").Response>}
 */
function guardarTesis(token, carnet, loteId) {
  return request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: true,
      alumno: { carnet, nombre_completo: `Tesista ${carnet}` },
      profesores: [
        { nombre_completo: "Ing. A" },
        { nombre_completo: "Ing. B" },
        { nombre_completo: "Ing. C" },
      ],
      tipo_evento_id: 3,
      ...(loteId ? { lote_id: loteId } : {}),
    });
}

test("dos sorteos guardados en el mismo minuto reciben lotes independientes", async () => {
  const token = await obtenerToken(request(app()));

  const sorteoA = await guardarTerna(token, "Terna #1 - Ing. Pérez", ["A-1", "A-2"]);
  const sorteoB = await guardarTerna(token, "Terna #1 - Ing. Gómez", ["B-1", "B-2", "B-3"]);

  assert.equal(sorteoA.status, 201);
  assert.equal(sorteoB.status, 201);
  assert.notEqual(sorteoA.body.data.lote_id, sorteoB.body.data.lote_id);

  // El historial muestra la misma fecha para todo, pero `lote_id` los separa.
  const historial = await request(app())
    .get("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(historial.status, 200);
  const filas = historial.body.data;
  assert.equal(new Set(filas.map((f) => f.fecha)).size, 1, "todas comparten el minuto");

  const filasA = filas.filter((f) => f.lote_id === sorteoA.body.data.lote_id);
  const filasB = filas.filter((f) => f.lote_id === sorteoB.body.data.lote_id);
  assert.deepEqual(
    filasA.map((f) => f.alumno_info.split(" - ")[0]).sort(),
    ["A-1", "A-2"]
  );
  assert.deepEqual(
    filasB.map((f) => f.alumno_info.split(" - ")[0]).sort(),
    ["B-1", "B-2", "B-3"]
  );
});

test("borrar un lote no arrastra a otro guardado en el mismo minuto", async () => {
  const token = await obtenerToken(request(app()));

  const sorteoA = await guardarTerna(token, "Terna #1 - Ing. Pérez", ["A-1", "A-2"]);
  const sorteoB = await guardarTerna(token, "Terna #1 - Ing. Gómez", ["B-1", "B-2", "B-3"]);

  const borrado = await request(app())
    .delete(`/api/v1/asignaciones/lote/${sorteoA.body.data.lote_id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(borrado.status, 200);
  assert.equal(borrado.body.data.eliminados, 2, "solo las filas del lote A");

  // Con el criterio anterior (fecha truncada) se habrían borrado las 5 filas.
  assert.equal(tabla.length, 3);
  assert.ok(tabla.every((f) => f.lote_id === sorteoB.body.data.lote_id));

  // El lote borrado ya no existe; el otro sigue intacto.
  const otraVez = await request(app())
    .delete(`/api/v1/asignaciones/lote/${sorteoA.body.data.lote_id}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(otraVez.status, 404);
});

test("los alumnos de una misma terna de tesis comparten lote sin mezclarse con otra", async () => {
  const token = await obtenerToken(request(app()));

  // Terna 1: el primer alumno crea el lote; los demás se adjuntan a él.
  const primero = await guardarTesis(token, "T1-1");
  const loteTerna1 = primero.body.data.lote_id;
  const resto = await Promise.all([
    guardarTesis(token, "T1-2", loteTerna1),
    guardarTesis(token, "T1-3", loteTerna1),
  ]);

  // Terna 2, en el mismo minuto: lote propio.
  const terna2 = await guardarTesis(token, "T2-1");

  assert.equal(primero.status, 201);
  resto.forEach((r) => {
    assert.equal(r.status, 201);
    assert.equal(r.body.data.lote_id, loteTerna1);
  });
  assert.notEqual(terna2.body.data.lote_id, loteTerna1);

  assert.equal(tabla.filter((f) => f.lote_id === loteTerna1).length, 9, "3 alumnos x 3 jurados");
  assert.equal(tabla.filter((f) => f.lote_id === terna2.body.data.lote_id).length, 3);
});

test("borrar un alumno solo afecta a su lote aunque se repita el carnet en el mismo minuto", async () => {
  const token = await obtenerToken(request(app()));

  const loteA = (await guardarTesis(token, "REP-1")).body.data.lote_id;
  const loteB = (await guardarTesis(token, "REP-1")).body.data.lote_id;
  assert.notEqual(loteA, loteB);

  const respuesta = await request(app())
    .delete(`/api/v1/asignaciones/lote/${loteA}/alumno/REP-1`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.data.eliminados, 3);
  assert.equal(tabla.length, 3);
  assert.ok(tabla.every((f) => f.lote_id === loteB));
});
