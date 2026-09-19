/**
 * @fileoverview Pruebas de los controles de seguridad transversales:
 * límites de cuerpo, validación de entrada, autorización por rol, cabeceras
 * defensivas, CORS y fuga de detalles internos en los errores.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { app, instalarDobles, obtenerToken, PROFESOR } =
  require("./helpers/entorno");

test.before(instalarDobles);

// ---------------------------------------------------------------------------
// Límite de tamaño de cuerpo
// ---------------------------------------------------------------------------

test("un cuerpo que supera el límite de 10kb responde 413", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  // Carga muy por encima del límite configurado.
  const cargaEnorme = {
    es_tesis: false,
    profesor_nombre: "Terna #1",
    alumnos: Array.from({ length: 2000 }, (_, i) => ({
      carnet: `1990-12-${i}`,
      nombre_completo: "Nombre De Alumno Bastante Largo Para Ocupar Espacio",
    })),
    tipo_evento_id: 1,
  };

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send(cargaEnorme);

  assert.equal(respuesta.status, 413);
  assert.equal(respuesta.body.error.code, "PAYLOAD_TOO_LARGE");
});

test("un lote con más alumnos de los permitidos se rechaza", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  // 150 alumnos supera MAX_ALUMNOS_POR_LOTE (100) pero cabe en 10kb.
  const alumnos = Array.from({ length: 150 }, (_, i) => ({
    carnet: `C${i}`,
    nombre_completo: `A${i}`,
  }));

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: false,
      profesor_nombre: "Terna #1",
      alumnos,
      tipo_evento_id: 1,
    });

  assert.equal(respuesta.status, 422);
  assert.equal(respuesta.body.error.code, "VALIDATION_ERROR");
});

// ---------------------------------------------------------------------------
// Validación de entrada
// ---------------------------------------------------------------------------

test("login sin campos obligatorios responde 422 con detalle por campo", async () => {
  const respuesta = await request(app()).post("/api/v1/auth/login").send({});

  assert.equal(respuesta.status, 422);
  assert.equal(respuesta.body.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(respuesta.body.error.details));
  const campos = respuesta.body.error.details.map((d) => d.campo);
  assert.ok(campos.includes("body.email"));
  assert.ok(campos.includes("body.password"));
});

test("login con correo mal formado responde 422", async () => {
  const respuesta = await request(app())
    .post("/api/v1/auth/login")
    .send({ email: "esto-no-es-un-correo", password: "algo" });

  assert.equal(respuesta.status, 422);
});

test("un campo no declarado en el cuerpo se rechaza", async () => {
  // Intento de asignarse un rol por inyección de campo.
  const respuesta = await request(app())
    .post("/api/v1/auth/login")
    .send({ email: "admin@umg.edu.gt", password: "x", rol: "admin" });

  assert.equal(respuesta.status, 422);
});

test("JSON malformado responde 400", async () => {
  const respuesta = await request(app())
    .post("/api/v1/auth/login")
    .set("Content-Type", "application/json")
    .send('{"email": "roto",,}');

  assert.equal(respuesta.status, 400);
  assert.equal(respuesta.body.error.code, "BAD_REQUEST");
});

test("un jurado de tesis que no tiene 3 catedráticos se rechaza", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: true,
      alumno: { carnet: "1990-1", nombre_completo: "Ana López" },
      profesores: [{ nombre_completo: "Ing. A" }, { nombre_completo: "Ing. B" }],
      tipo_evento_id: 3,
    });

  assert.equal(respuesta.status, 422);
});

test("un lote_id que no es un UUID válido se rechaza", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .delete(`/api/v1/asignaciones/lote/${encodeURIComponent("' OR 1=1 --")}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 422);
});

// ---------------------------------------------------------------------------
// Autorización por rol
// ---------------------------------------------------------------------------

test("un usuario no administrador no puede listar usuarios", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion, PROFESOR.email);

  const respuesta = await request(app())
    .get("/api/v1/usuarios")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 403);
  assert.equal(respuesta.body.error.code, "FORBIDDEN");
});

test("un usuario no administrador no puede registrar asignaciones", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion, PROFESOR.email);

  const respuesta = await request(app())
    .post("/api/v1/asignaciones")
    .set("Authorization", `Bearer ${token}`)
    .send({
      es_tesis: false,
      profesor_nombre: "Terna #1",
      alumnos: [{ carnet: "1990-1", nombre_completo: "Ana López" }],
      tipo_evento_id: 1,
    });

  assert.equal(respuesta.status, 403);
});

test("un usuario no administrador no puede borrar un lote", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion, PROFESOR.email);

  const respuesta = await request(app())
    .delete("/api/v1/asignaciones/lote/00000000-0000-4000-8000-000000000000")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 403);
});

test("el listado de usuarios nunca incluye password_hash", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .get("/api/v1/usuarios")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 200);
  assert.ok(!JSON.stringify(respuesta.body).includes("password_hash"));
});

// ---------------------------------------------------------------------------
// Cabeceras, CORS y rutas inexistentes
// ---------------------------------------------------------------------------

test("se emiten las cabeceras de seguridad de Helmet", async () => {
  const respuesta = await request(app()).get("/api/v1/health");

  assert.equal(respuesta.headers["x-content-type-options"], "nosniff");
  assert.equal(respuesta.headers["x-frame-options"], "SAMEORIGIN");
  assert.ok(respuesta.headers["content-security-policy"]);
  // Express no debe anunciar la tecnología del servidor.
  assert.equal(respuesta.headers["x-powered-by"], undefined);
});

test("cada respuesta lleva un identificador de petición", async () => {
  const respuesta = await request(app()).get("/api/v1/health");
  assert.ok(respuesta.headers["x-request-id"]);
});

test("un origen de la lista blanca recibe la cabecera CORS", async () => {
  const respuesta = await request(app())
    .get("/api/v1/health")
    .set("Origin", "http://localhost:4200");

  assert.equal(
    respuesta.headers["access-control-allow-origin"],
    "http://localhost:4200"
  );
});

test("un origen ajeno no recibe autorización CORS", async () => {
  const respuesta = await request(app())
    .get("/api/v1/health")
    .set("Origin", "http://sitio-malicioso.example");

  assert.equal(respuesta.headers["access-control-allow-origin"], undefined);
});

test("una ruta inexistente responde 404 en el formato estándar", async () => {
  const respuesta = await request(app()).get("/api/v1/no-existe");

  assert.equal(respuesta.status, 404);
  assert.equal(respuesta.body.success, false);
  assert.equal(respuesta.body.error.code, "NOT_FOUND");
});

test("un fallo de base de datos no filtra detalles internos", async () => {
  const AsignacionesRepository = require("../src/repositories/asignaciones.repository");
  const original = AsignacionesRepository.listarParaReporte;

  // Simulamos un error real del driver de MySQL.
  AsignacionesRepository.listarParaReporte = async () => {
    const error = new Error(
      "ER_NO_SUCH_TABLE: Table 'tesis_ruleta.asignaciones' doesn't exist"
    );
    error.code = "ER_NO_SUCH_TABLE";
    throw error;
  };

  try {
    const peticion = request(app());
    const token = await obtenerToken(peticion);

    const respuesta = await request(app())
      .get("/api/v1/asignaciones")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(respuesta.status, 500);
    const cuerpo = JSON.stringify(respuesta.body);
    assert.ok(!cuerpo.includes("ER_NO_SUCH_TABLE"), "no debe filtrar el código SQL");
    assert.ok(!cuerpo.includes("tesis_ruleta"), "no debe filtrar el nombre de la BD");
    assert.ok(!cuerpo.includes("stack"), "no debe filtrar el stack");
  } finally {
    AsignacionesRepository.listarParaReporte = original;
  }
});
