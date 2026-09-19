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

// ---------------------------------------------------------------------------
// Canal lateral de temporización (timing attack)
// ---------------------------------------------------------------------------

/**
 * Sustituye temporalmente `bcrypt.compare` por un espía que registra el hash
 * contra el que se compara y delega en la implementación real.
 * @returns {{llamadas: string[], restaurar: () => void}}
 */
function espiarBcryptCompare() {
  const bcrypt = require("bcryptjs");
  const original = bcrypt.compare;
  const llamadas = [];
  bcrypt.compare = (plano, hash, ...resto) => {
    llamadas.push(hash);
    return original.call(bcrypt, plano, hash, ...resto);
  };
  return { llamadas, restaurar: () => (bcrypt.compare = original) };
}

/** Hash bcrypt con el mismo coste que exige la configuración. */
const env = require("../src/config/env");
const FORMATO_HASH_MISMO_COSTE = new RegExp(
  "^\\$2[aby]\\$" + String(env.BCRYPT_ROUNDS).padStart(2, "0") + "\\$.{53}$"
);

test("con correo inexistente se ejecuta bcrypt contra el hash dummy", async () => {
  const espia = espiarBcryptCompare();
  try {
    const respuesta = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "nadie@umg.edu.gt", password: PASSWORD_ADMIN });

    assert.equal(respuesta.status, 401);
    assert.equal(espia.llamadas.length, 1, "debe invocarse bcrypt exactamente una vez");
    assert.match(espia.llamadas[0], FORMATO_HASH_MISMO_COSTE, "mismo coste que un hash real");
  } finally {
    espia.restaurar();
  }
});

test("con contraseña incorrecta se ejecuta bcrypt contra el hash real", async () => {
  const UsuariosRepository = require("../src/repositories/usuarios.repository");
  const { password_hash: hashReal } =
    await UsuariosRepository.buscarPorEmailConHash(ADMIN.email);

  const espia = espiarBcryptCompare();
  try {
    const respuesta = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: ADMIN.email, password: "contrasena-equivocada" });

    assert.equal(respuesta.status, 401);
    assert.deepEqual(espia.llamadas, [hashReal]);
  } finally {
    espia.restaurar();
  }
});

test("una contraseña heredada en texto plano también consume el hash dummy", async () => {
  const UsuariosRepository = require("../src/repositories/usuarios.repository");
  const original = UsuariosRepository.buscarPorEmailConHash;
  UsuariosRepository.buscarPorEmailConHash = async () => ({ ...ADMIN, password_hash: "1234" });

  const espia = espiarBcryptCompare();
  try {
    const respuesta = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: ADMIN.email, password: "1234" });

    assert.equal(respuesta.status, 401);
    assert.equal(espia.llamadas.length, 1);
    assert.match(espia.llamadas[0], FORMATO_HASH_MISMO_COSTE);
  } finally {
    espia.restaurar();
    UsuariosRepository.buscarPorEmailConHash = original;
  }
});

test("el tiempo de respuesta no distingue correo inexistente de contraseña incorrecta", async () => {
  /**
   * Mide la duración de un intento de login.
   * @param {string} email Correo a probar.
   * @returns {Promise<number>} Milisegundos.
   */
  const medir = async (email) => {
    const inicio = process.hrtime.bigint();
    const respuesta = await request(app())
      .post("/api/v1/auth/login")
      .send({ email, password: "contrasena-equivocada" });
    assert.equal(respuesta.status, 401);
    return Number(process.hrtime.bigint() - inicio) / 1e6;
  };
  const mediana = (valores) => [...valores].sort((a, b) => a - b)[Math.floor(valores.length / 2)];

  // Calentamiento: la primera petición paga la carga perezosa de módulos.
  await medir(ADMIN.email);

  // Muestras intercaladas para que el ruido del sistema afecte a ambos por igual.
  const inexistente = [];
  const passwordMala = [];
  for (let i = 0; i < 5; i++) {
    inexistente.push(await medir("nadie@umg.edu.gt"));
    passwordMala.push(await medir(ADMIN.email));
  }

  const ratio = mediana(inexistente) / mediana(passwordMala);
  // Sin la defensa, el correo inexistente respondía en ~1 ms frente a cientos
  // de ms del bcrypt real (ratio cercano a 0). Con ella ambos ejecutan un
  // bcrypt del mismo coste; el margen absorbe el ruido del planificador.
  assert.ok(
    ratio > 0.6 && ratio < 1.6,
    `tiempos desiguales: inexistente=${mediana(inexistente).toFixed(1)}ms, ` +
      `contraseña incorrecta=${mediana(passwordMala).toFixed(1)}ms (ratio ${ratio.toFixed(2)})`
  );
});
