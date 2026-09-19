/**
 * @fileoverview Pruebas de la revalidación de roles administrativos.
 *
 * Un JWT sigue siendo válido hasta que expira. Estas pruebas emiten el token
 * mientras el usuario es administrador y, ANTES de usarlo, cambian lo que
 * devuelve la base de datos (rol revocado, cuenta eliminada, caída de la BD)
 * para comprobar que las rutas administrativas no se fían del rol del token.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { app, instalarDobles, obtenerToken, ADMIN } = require("./helpers/entorno");
const UsuariosRepository = require("../src/repositories/usuarios.repository");

/** Búsqueda por id original de los dobles, restaurada tras cada prueba. */
let buscarPorIdOriginal;

test.before(async () => {
  await instalarDobles();
  buscarPorIdOriginal = UsuariosRepository.buscarPorId;
});

test.afterEach(() => {
  UsuariosRepository.buscarPorId = buscarPorIdOriginal;
});

/**
 * Sustituye `buscarPorId` y cuenta cuántas veces se consulta.
 * @param {(id: number) => Promise<object|null>} implementacion Respuesta simulada de la BD.
 * @returns {{consultas: number[]}} Registro de ids consultados.
 */
function simularBaseDeDatos(implementacion) {
  const registro = { consultas: [] };
  UsuariosRepository.buscarPorId = async (id) => {
    registro.consultas.push(Number(id));
    return implementacion(id);
  };
  return registro;
}

/** Cuerpo válido para la ruta administrativa POST /asignaciones. */
const TERNA_VALIDA = {
  es_tesis: false,
  profesor_nombre: "Terna #1 - Ing. Pérez",
  alumnos: [{ carnet: "1990-1", nombre_completo: "Ana López" }],
  tipo_evento_id: 1,
};

test("una ruta administrativa revalida el rol en la base de datos", async () => {
  const token = await obtenerToken(request(app()));
  const bd = simularBaseDeDatos(async () => ADMIN);

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send(TERNA_VALIDA);

  assert.equal(respuesta.status, 201);
  assert.deepEqual(bd.consultas, [ADMIN.id]);
});

test("si el rol de administrador fue revocado, la petición responde 403", async () => {
  // Token emitido mientras el usuario todavía era administrador.
  const token = await obtenerToken(request(app()));

  // Después, un operador le retira el rol en la base de datos.
  const bd = simularBaseDeDatos(async () => ({
    ...ADMIN,
    rol_id: 2,
    rol_nombre: "profesor",
  }));

  const escritura = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send(TERNA_VALIDA);

  assert.equal(escritura.status, 403);
  assert.equal(escritura.body.error.code, "FORBIDDEN");

  const gestionUsuarios = await request(app())
    .get("/api/v1/usuarios")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(gestionUsuarios.status, 403);
  assert.equal(bd.consultas.length, 2, "cada petición administrativa consulta la BD");
});

test("si la cuenta fue eliminada, la ruta administrativa responde 401", async () => {
  const token = await obtenerToken(request(app()));
  simularBaseDeDatos(async () => null);

  const respuesta = await request(app())
    .get("/api/v1/usuarios")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.body.error.code, "UNAUTHORIZED");
});

test("si la base de datos falla durante la revalidación, no se concede acceso", async () => {
  const token = await obtenerToken(request(app()));
  simularBaseDeDatos(async () => {
    throw new Error("ECONNREFUSED 127.0.0.1:3306");
  });

  const respuesta = await request(app())
    .delete("/api/v1/asignaciones/lote/3f9c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 500);
  assert.ok(!JSON.stringify(respuesta.body).includes("ECONNREFUSED"));
});

test("las rutas no críticas mantienen la verificación rápida sin consultar la BD", async () => {
  const token = await obtenerToken(request(app()));
  const bd = simularBaseDeDatos(async () => {
    throw new Error("no debería consultarse");
  });

  const historial = await request(app())
    .get("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`);
  const catalogo = await request(app())
    .get("/api/v1/tipos-evento")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(historial.status, 200);
  assert.equal(catalogo.status, 200);
  assert.equal(bd.consultas.length, 0);
});

test("un rol sin privilegios se rechaza sin consultar la BD", async () => {
  const { PROFESOR } = require("./helpers/entorno");
  const token = await obtenerToken(request(app()), PROFESOR.email);
  const bd = simularBaseDeDatos(async () => PROFESOR);

  const respuesta = await request(app())
    .get("/api/v1/usuarios")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 403);
  assert.equal(bd.consultas.length, 0);
});
