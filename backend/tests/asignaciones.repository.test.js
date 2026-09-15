/**
 * @fileoverview Pruebas unitarias del repositorio de asignaciones.
 *
 * Sustituyen el pool de mysql2 por un doble que registra cada sentencia, para
 * comprobar sin MariaDB que: (1) todas las filas de un guardado se insertan
 * con el mismo `lote_id`, (2) dos guardados reciben lotes distintos aunque
 * ocurran en el mismo instante y (3) listar/borrar filtran por `lote_id` y ya
 * no por la fecha truncada al minuto.
 */

// Fija el entorno de pruebas antes de cargar la configuración.
require("./helpers/entorno");

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../src/config/db");
const AsignacionesRepository = require("../src/repositories/asignaciones.repository");
const AsignacionesService = require("../src/services/asignaciones.service");
const TiposEventoRepository = require("../src/repositories/tiposEvento.repository");

/** Sentencias capturadas: `{ sql, params }`. */
let sentencias = [];

test.before(() => {
  const registrar = async (sql, params) => {
    sentencias.push({ sql, params });
    if (/^\s*DELETE/i.test(sql)) return [{ affectedRows: 2 }];
    if (/COUNT\(\*\)/i.test(sql)) return [[{ total: 2 }]];
    if (/SELECT\s+tipo_evento_id/i.test(sql)) return [[]];
    return [[]];
  };

  pool.query = registrar;
  pool.getConnection = async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: registrar,
  });

  TiposEventoRepository.existe = async () => true;
});

test.beforeEach(() => {
  sentencias = [];
});

/** Filtra las sentencias INSERT capturadas. */
const inserts = () => sentencias.filter((s) => /^\s*INSERT/i.test(s.sql));

test("una terna inserta todas sus filas con el mismo lote_id", async () => {
  await AsignacionesRepository.crearAsignacionesTerna({
    loteId: "11111111-1111-4111-8111-111111111111",
    profesorNombre: "Terna #1 - Ing. Pérez",
    alumnos: [
      { carnet: "1", nombre_completo: "Uno" },
      { carnet: "2", nombre_completo: "Dos" },
      { carnet: "3", nombre_completo: "Tres" },
    ],
    tipoEventoId: 1,
  });

  assert.equal(inserts().length, 3);
  for (const { sql, params } of inserts()) {
    assert.match(sql, /\(lote_id, profesor_nombre, alumno_carnet, alumno_nombre, tipo_evento_id\)/);
    assert.equal(params[0], "11111111-1111-4111-8111-111111111111");
  }
});

test("un jurado de tesis conserva roles y comparte lote_id", async () => {
  await AsignacionesRepository.crearAsignacionesTesis({
    loteId: "22222222-2222-4222-8222-222222222222",
    alumno: { carnet: "9", nombre_completo: "Nueve" },
    profesores: [
      { nombre_completo: "Ing. A" },
      { nombre_completo: "Ing. B" },
      { nombre_completo: "Ing. C" },
    ],
    tipoEventoId: 3,
  });

  // El formato "Nombre (Rol)" que consumen las actas no cambia.
  assert.deepEqual(
    inserts().map((s) => s.params[1]),
    ["Ing. A (Presidente)", "Ing. B (Vocal 1)", "Ing. C (Vocal 2)"]
  );
  assert.ok(inserts().every((s) => s.params[0] === "22222222-2222-4222-8222-222222222222"));
});

test("dos sorteos persistidos en el mismo instante no comparten lote_id", async () => {
  const payload = {
    es_tesis: false,
    profesor_nombre: "Terna #1",
    alumnos: [
      { carnet: "1", nombre_completo: "Uno" },
      { carnet: "2", nombre_completo: "Dos" },
    ],
    tipo_evento_id: 1,
  };

  // Lanzados en paralelo: comparten reloj, no identificador.
  const [a, b] = await Promise.all([
    AsignacionesService.registrar(payload),
    AsignacionesService.registrar(payload),
  ]);

  assert.notEqual(a.lote_id, b.lote_id);

  const lotesInsertados = inserts().map((s) => s.params[0]);
  assert.equal(lotesInsertados.filter((l) => l === a.lote_id).length, 2);
  assert.equal(lotesInsertados.filter((l) => l === b.lote_id).length, 2);
});

test("borrar y contar un lote filtran por lote_id, no por la fecha", async () => {
  const loteId = "33333333-3333-4333-8333-333333333333";

  await AsignacionesRepository.contarPorLote(loteId);
  await AsignacionesRepository.eliminarLote(loteId);
  await AsignacionesRepository.contarPorLoteYAlumno(loteId, "1990-1");
  await AsignacionesRepository.eliminarPorLoteYAlumno(loteId, "1990-1");

  assert.equal(sentencias.length, 4);
  for (const { sql, params } of sentencias) {
    assert.match(sql, /WHERE lote_id = \?/);
    assert.doesNotMatch(sql, /DATE_FORMAT/);
    assert.equal(params[0], loteId);
  }
});

test("el historial devuelve el lote_id de cada fila", async () => {
  await AsignacionesRepository.listarParaReporte({ limite: 10, desplazamiento: 0 });

  assert.match(sentencias[0].sql, /a\.lote_id/);
});
