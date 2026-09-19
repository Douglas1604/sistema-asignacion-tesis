/**
 * @fileoverview Pruebas funcionales del módulo de asignaciones y del catálogo.
 *
 * Verifican que la API sigue aceptando exactamente las dos formas de carga que
 * emite el sorteo y que el historial conserva el formato que consume el
 * generador de actas.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { app, instalarDobles, obtenerToken } = require("./helpers/entorno");
const AsignacionesRepository = require("../src/repositories/asignaciones.repository");

/** UUID con formato válido que nunca se inserta: sirve para los casos "no existe". */
const LOTE_ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

/** Tabla `asignaciones` simulada, igual que en tests/lotes.test.js. */
let tabla = [];

/**
 * Sustituye las operaciones de creación/borrado por lote por una tabla en
 * memoria, para poder crear un registro real y luego borrarlo por su
 * `lote_id` (el identificador ya no es una fecha, ver issue #1).
 */
function instalarTablaDeAsignaciones() {
  const insertar = (loteId, carnet, tipoEventoId) =>
    tabla.push({ lote_id: loteId, alumno_carnet: carnet, tipo_evento_id: tipoEventoId });

  AsignacionesRepository.crearAsignacionesTesis = async ({
    loteId,
    alumno,
    profesores,
    tipoEventoId,
  }) => {
    profesores.forEach(() => insertar(loteId, alumno.carnet, tipoEventoId));
    return profesores.length;
  };

  AsignacionesRepository.crearAsignacionesTerna = async ({
    loteId,
    alumnos,
    tipoEventoId,
  }) => {
    alumnos.forEach((alumno) => insertar(loteId, alumno.carnet, tipoEventoId));
    return alumnos.length;
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
}

test.before(async () => {
  await instalarDobles();
  instalarTablaDeAsignaciones();
});

test("registra una terna de privado o seminario", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: false,
      profesor_nombre: "Grupo 1 de Administración de Sistemas - Ing. Juan Pérez",
      alumnos: [
        { id: 1, carnet: "1990-12-3456", nombre_completo: "Ana López" },
        { id: 2, carnet: "1990-12-3457", nombre_completo: "Luis Gómez" },
      ],
      tipo_evento_id: 1,
    });

  assert.equal(respuesta.status, 201);
  assert.equal(respuesta.body.success, true);
  assert.equal(respuesta.body.data.registros, 2);
  assert.equal(respuesta.body.data.modo, "terna");
  assert.equal(respuesta.body.data.tipo_evento_id, 1);
});

test("registra un jurado de tesis de tres catedráticos", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: true,
      alumno: { id: 5, carnet: "1990-12-9999", nombre_completo: "Marta Ruiz" },
      profesores: [
        { id: 1, nombre_completo: "Ing. A", area: "" },
        { id: 2, nombre_completo: "Ing. B", area: "" },
        { id: 3, nombre_completo: "Ing. C", area: "" },
      ],
      tipo_evento_id: 3,
    });

  assert.equal(respuesta.status, 201);
  assert.equal(respuesta.body.data.registros, 3);
  assert.equal(respuesta.body.data.modo, "tesis");
});

test("sin tipo_evento_id se aplica la modalidad por defecto de cada modo", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  // Tesis sin modalidad explícita: 3.
  const tesis = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: true,
      alumno: { carnet: "1990-1", nombre_completo: "Ana" },
      profesores: [
        { nombre_completo: "A" },
        { nombre_completo: "B" },
        { nombre_completo: "C" },
      ],
    });

  assert.equal(tesis.status, 201);
  assert.equal(tesis.body.data.tipo_evento_id, 3);

  // Terna sin modalidad explícita: 1.
  const terna = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: false,
      profesor_nombre: "Terna #1",
      alumnos: [{ carnet: "1990-2", nombre_completo: "Luis" }],
    });

  assert.equal(terna.status, 201);
  assert.equal(terna.body.data.tipo_evento_id, 1);
});

test("una modalidad inexistente se rechaza", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: false,
      profesor_nombre: "Terna #1",
      alumnos: [{ carnet: "1990-2", nombre_completo: "Luis" }],
      tipo_evento_id: 999,
    });

  assert.equal(respuesta.status, 422);
});

test("el historial conserva el formato que consume el generador de actas", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .get("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 200);
  const fila = respuesta.body.data[0];
  assert.deepEqual(Object.keys(fila).sort(), [
    "alumno_info",
    "fecha",
    "modalidad",
    "profesor_nombre",
  ]);
  assert.match(fila.fecha, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  assert.ok(respuesta.body.meta.total >= 0);
});

test("elimina un lote existente", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const creado = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: false,
      profesor_nombre: "Terna a borrar",
      alumnos: [{ carnet: "9999-1", nombre_completo: "Uno" }],
      tipo_evento_id: 1,
    });
  const loteId = creado.body.data.lote_id;

  const respuesta = await request(app())
    .delete(`/api/v1/asignaciones/lote/${loteId}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.data.eliminados, 1);
});

test("borrar un lote inexistente responde 404", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .delete(`/api/v1/asignaciones/lote/${LOTE_ID_INEXISTENTE}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 404);
  assert.equal(respuesta.body.error.code, "NOT_FOUND");
});

test("el catálogo de modalidades exige autenticación", async () => {
  const sinToken = await request(app()).get("/api/v1/tipos-evento");
  assert.equal(sinToken.status, 401);

  const peticion = request(app());
  const token = await obtenerToken(peticion);
  const conToken = await request(app())
    .get("/api/v1/tipos-evento")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(conToken.status, 200);
  assert.ok(Array.isArray(conToken.body.data));
  assert.equal(conToken.body.data[0].nombre, "Privado");
});

test("el chequeo de salud es público", async () => {
  const respuesta = await request(app()).get("/api/v1/health");
  // 200 con base de datos disponible, 503 si no lo está: en ningún caso 401.
  assert.ok([200, 503].includes(respuesta.status));
});

test("elimina la asignación de un alumno dentro de un lote", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const creado = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: true,
      alumno: { carnet: "1990-12-3456", nombre_completo: "Ana López" },
      profesores: [
        { nombre_completo: "Ing. A" },
        { nombre_completo: "Ing. B" },
        { nombre_completo: "Ing. C" },
      ],
      tipo_evento_id: 3,
    });
  const loteId = creado.body.data.lote_id;

  const respuesta = await request(app())
    .delete(`/api/v1/asignaciones/lote/${loteId}/alumno/1990-12-3456`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.data.eliminados, 3);
});

test("borrar la asignación de un alumno inexistente responde 404", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .delete(`/api/v1/asignaciones/lote/${LOTE_ID_INEXISTENTE}/alumno/0000-00-0000`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 404);
});

test("borrar la asignación de un alumno exige autenticación", async () => {
  const respuesta = await request(app()).delete(
    `/api/v1/asignaciones/lote/${LOTE_ID_INEXISTENTE}/alumno/1990-12-3456`
  );

  assert.equal(respuesta.status, 401);
});
