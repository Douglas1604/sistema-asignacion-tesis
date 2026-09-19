/**
 * @fileoverview Utilidades compartidas por los tests.
 *
 * Fija el entorno de pruebas ANTES de que se cargue la configuración, y expone
 * ayudas para construir la app y para sustituir los repositorios por dobles.
 * Los tests no tocan MariaDB: comprueban el comportamiento de la API (auth,
 * validación, límites, formato de error), no el motor de base de datos.
 */

process.env.NODE_ENV = "test";
// Valores deterministas para que las pruebas no dependan del .env local.
process.env.JWT_SECRET =
  process.env.JWT_SECRET_TEST ||
  "secreto_exclusivo_para_pruebas_con_longitud_suficiente_123456";
process.env.CORS_ORIGINS = "http://localhost:4200";
process.env.JSON_BODY_LIMIT = "10kb";
process.env.MAX_ALUMNOS_POR_LOTE = "100";
process.env.SWAGGER_ENABLED = "false";

const crearApp = require("../../src/app");
const UsuariosRepository = require("../../src/repositories/usuarios.repository");
const AsignacionesRepository = require("../../src/repositories/asignaciones.repository");
const TiposEventoRepository = require("../../src/repositories/tiposEvento.repository");
const { hashPassword } = require("../../src/utils/password");

/** Contraseña en claro del usuario administrador de prueba. */
const PASSWORD_ADMIN = "ClaveDePrueba123";

/** Usuario administrador de prueba, sin hash todavía. */
const ADMIN = {
  id: 1,
  username: "Admin",
  email: "admin@umg.edu.gt",
  rol_id: 1,
  rol_nombre: "admin",
  creado_en: "2026-02-18 05:31:03",
};

/** Usuario sin privilegios de gestión. */
const PROFESOR = {
  id: 2,
  username: "Profesor",
  email: "profesor@umg.edu.gt",
  rol_id: 2,
  rol_nombre: "profesor",
  creado_en: "2026-02-18 05:31:03",
};

/**
 * Sustituye los métodos de repositorio por dobles en memoria.
 * Se llama una vez antes de la batería de pruebas.
 * @returns {Promise<void>}
 */
async function instalarDobles() {
  const hashAdmin = await hashPassword(PASSWORD_ADMIN);
  const hashProfesor = await hashPassword(PASSWORD_ADMIN);

  const porEmail = new Map([
    [ADMIN.email, { ...ADMIN, password_hash: hashAdmin }],
    [PROFESOR.email, { ...PROFESOR, password_hash: hashProfesor }],
  ]);
  const porId = new Map([
    [ADMIN.id, ADMIN],
    [PROFESOR.id, PROFESOR],
  ]);

  UsuariosRepository.buscarPorEmailConHash = async (email) =>
    porEmail.get(email) || null;
  UsuariosRepository.buscarPorId = async (id) => porId.get(Number(id)) || null;
  UsuariosRepository.listar = async () => [ADMIN, PROFESOR];
  UsuariosRepository.contar = async () => 2;

  TiposEventoRepository.listar = async () => [
    { id: 1, nombre: "Privado", descripcion: "Examen privado" },
    { id: 3, nombre: "Tesis", descripcion: "Trabajo de graduación" },
  ];
  TiposEventoRepository.existe = async (id) => [1, 2, 3].includes(Number(id));

  AsignacionesRepository.crearAsignacionesTesis = async ({ profesores }) =>
    profesores.length;
  AsignacionesRepository.crearAsignacionesTerna = async ({ alumnos }) =>
    alumnos.length;
  AsignacionesRepository.listarParaReporte = async () => [
    {
      modalidad: "Tesis",
      profesor_nombre: "Ing. Juan Pérez (Presidente)",
      alumno_info: "1990-12-3456 - Ana López",
      fecha: "12/09/2026 10:30",
    },
  ];
  AsignacionesRepository.contar = async () => 1;
}

/**
 * Construye una instancia de la app para las pruebas.
 * @returns {import("express").Express}
 */
function app() {
  return crearApp();
}

/**
 * Obtiene un token válido iniciando sesión a través de la propia API.
 * @param {import("supertest").SuperTest} peticion Cliente supertest ya creado.
 * @param {string} [email] Correo del usuario con el que autenticarse.
 * @returns {Promise<string>} JWT de acceso.
 */
async function obtenerToken(peticion, email = ADMIN.email) {
  const respuesta = await peticion
    .post("/api/v1/auth/login")
    .send({ email, password: PASSWORD_ADMIN });
  return respuesta.body.data.token;
}

module.exports = {
  app,
  instalarDobles,
  obtenerToken,
  PASSWORD_ADMIN,
  ADMIN,
  PROFESOR,
};
