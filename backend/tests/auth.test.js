/**
 * @fileoverview Pruebas de autenticación: login correcto, login fallido y
 * protección de los endpoints que exigen token.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const { app, instalarDobles, obtenerToken, PASSWORD_ADMIN, ADMIN } =
  require("./helpers/entorno");

test.before(instalarDobles);

test("login correcto devuelve token y datos del usuario", async () => {
  const respuesta = await request(app())
    .post("/api/v1/auth/login")
    .send({ email: ADMIN.email, password: PASSWORD_ADMIN });

  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.success, true);
  assert.ok(respuesta.body.data.token, "debe devolver un token");
  assert.equal(respuesta.body.data.user.email, ADMIN.email);
  assert.equal(respuesta.body.data.user.rol, "admin");

  // El token debe ser verificable y no llevar datos sensibles.
  const payload = jwt.decode(respuesta.body.data.token);
  assert.equal(payload.sub, String(ADMIN.id));
  assert.equal(payload.password, undefined);
  assert.equal(payload.password_hash, undefined);
});

test("la respuesta de login nunca expone el hash de la contraseña", async () => {
  const respuesta = await request(app())
    .post("/api/v1/auth/login")
    .send({ email: ADMIN.email, password: PASSWORD_ADMIN });

  const cuerpo = JSON.stringify(respuesta.body);
  assert.ok(!cuerpo.includes("password_hash"), "no debe aparecer password_hash");
  assert.ok(!cuerpo.includes(PASSWORD_ADMIN), "no debe aparecer la contraseña");
  assert.equal(respuesta.body.data.user.password_hash, undefined);
});

test("login con contraseña incorrecta responde 401", async () => {
  const respuesta = await request(app())
    .post("/api/v1/auth/login")
    .send({ email: ADMIN.email, password: "contrasena-equivocada" });

  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.body.success, false);
  assert.equal(respuesta.body.error.code, "UNAUTHORIZED");
});

test("login con correo inexistente responde 401 con el mismo mensaje", async () => {
  const inexistente = await request(app())
    .post("/api/v1/auth/login")
    .send({ email: "nadie@umg.edu.gt", password: PASSWORD_ADMIN });

  const passwordMala = await request(app())
    .post("/api/v1/auth/login")
    .send({ email: ADMIN.email, password: "contrasena-equivocada" });

  assert.equal(inexistente.status, 401);
  // Mismo mensaje en ambos casos: no se puede deducir qué cuentas existen.
  assert.equal(inexistente.body.error.message, passwordMala.body.error.message);
});

test("una contraseña en texto plano almacenada no permite iniciar sesión", async () => {
  // Simulamos un registro heredado, con la contraseña sin hashear en la columna.
  const UsuariosRepository = require("../src/repositories/usuarios.repository");
  const original = UsuariosRepository.buscarPorEmailConHash;

  UsuariosRepository.buscarPorEmailConHash = async () => ({
    ...ADMIN,
    password_hash: "1234",
  });

  try {
    const respuesta = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: ADMIN.email, password: "1234" });

    assert.equal(respuesta.status, 401, "no debe aceptarse la comparación plana");
  } finally {
    UsuariosRepository.buscarPorEmailConHash = original;
  }
});

test("endpoint protegido sin token responde 401", async () => {
  const respuesta = await request(app()).get("/api/v1/auth/me");

  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.body.success, false);
  assert.equal(respuesta.body.error.code, "UNAUTHORIZED");
});

test("endpoint protegido con token inválido responde 401", async () => {
  const respuesta = await request(app())
    .get("/api/v1/auth/me")
    .set("Authorization", "Bearer token.claramente.invalido");

  assert.equal(respuesta.status, 401);
  assert.equal(respuesta.body.error.code, "UNAUTHORIZED");
});

test("token firmado con otro secreto responde 401", async () => {
  const tokenFalsificado = jwt.sign({ sub: "1", rol: "admin" }, "secreto-atacante");

  const respuesta = await request(app())
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${tokenFalsificado}`);

  assert.equal(respuesta.status, 401);
});

test("cabecera Authorization mal formada responde 401", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  // Sin el esquema Bearer el token no debe aceptarse.
  const respuesta = await request(app())
    .get("/api/v1/auth/me")
    .set("Authorization", token);

  assert.equal(respuesta.status, 401);
});

test("token válido da acceso al perfil", async () => {
  const peticion = request(app());
  const token = await obtenerToken(peticion);

  const respuesta = await request(app())
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.data.email, ADMIN.email);
  assert.equal(respuesta.body.data.password_hash, undefined);
});
