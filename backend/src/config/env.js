/**
 * @fileoverview Validación estricta de variables de entorno al arrancar.
 * Si falta una variable obligatoria o es insegura, el proceso NO arranca.
 * Ningún secreto, credencial, host o puerto está hardcodeado en el código.
 */

const { z } = require("zod");

// Cargamos el .env antes de validar.
require("dotenv").config();

/** Longitud mínima exigida al secreto JWT para que sea razonablemente resistente. */
const MIN_JWT_SECRET_LENGTH = 32;

/** Valores de ejemplo que jamás deben llegar a un entorno real. */
const SECRETOS_PROHIBIDOS = [
  "tu_secreto_super_seguro_cambialo_en_produccion",
  "changeme",
  "secret",
];

/**
 * Convierte una variable de entorno separada por comas en una lista depurada.
 *
 * @param {string|undefined} valor Cadena del tipo "http://a.com, http://b.com".
 * @returns {string[]} Elementos recortados, sin entradas vacías.
 */
const csvALista = (valor) =>
  String(valor || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Esquema declarativo de la configuración.
 *
 * @description Se procesa en tres fases encadenadas:
 *  1. `object`      -> tipado y coerción de cada variable (todo `process.env` es string).
 *  2. `transform`   -> derivación de valores calculados (lista CORS, banderas de entorno).
 *  3. `superRefine` -> reglas que dependen de varias variables a la vez.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // Base de datos
    DB_HOST: z.string().min(1, "DB_HOST es obligatorio"),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
    DB_USER: z.string().min(1, "DB_USER es obligatorio"),
    // La contraseña puede ser vacía en XAMPP local, pero debe declararse explícitamente.
    DB_PASSWORD: z.string(),
    DB_NAME: z.string().min(1, "DB_NAME es obligatorio"),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),

    // Autenticación
    JWT_SECRET: z
      .string()
      .min(
        MIN_JWT_SECRET_LENGTH,
        `JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres`
      )
      .refine(
        (valor) => !SECRETOS_PROHIBIDOS.includes(valor.toLowerCase()),
        "JWT_SECRET contiene un valor de ejemplo; genera uno propio"
      ),
    JWT_EXPIRES_IN: z.string().default("8h"),
    JWT_ISSUER: z.string().default("tesis-ruleta-api"),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    // CORS: lista blanca explícita, nunca cors() abierto.
    CORS_ORIGINS: z.string().min(1, "CORS_ORIGINS es obligatorio"),

    // Límites de cuerpo y de lotes
    JSON_BODY_LIMIT: z.string().default("10kb"),
    MAX_ALUMNOS_POR_LOTE: z.coerce.number().int().min(1).max(500).default(100),

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

    // Documentación
    SWAGGER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((valor) => valor === "true"),

    // Confianza en proxies (necesario para que el rate limit lea la IP real)
    TRUST_PROXY: z.string().default("false"),

    // --- Preparación automática del esquema ---
    // Permite que el arranque aplique las migraciones idempotentes y siembre
    // los catálogos cuando no hay acceso a la consola de MariaDB del servidor.
    DB_AUTO_MIGRATE: z
      .enum(["true", "false"])
      .default("true")
      .transform((valor) => valor === "true"),

    // --- Semilla del usuario administrador ---
    // Resuelve el caso "la base remota no tiene dado de alta al administrador":
    // el arranque lo crea o reactiva sin necesidad de entrar a la base.
    SEED_ADMIN_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((valor) => valor === "true"),
    SEED_ADMIN_USERNAME: z.string().trim().min(1).max(50).default("admin"),
    SEED_ADMIN_EMAIL: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(100)
      .default("dpinedah3@miumg.edu.gt"),
    // Contraseña en claro de la semilla. Se hashea con bcrypt en el arranque y
    // nunca se escribe en los logs. Si se deja vacía y la cuenta no existe, el
    // arranque genera una aleatoria y la imprime UNA vez para poder entrar.
    SEED_ADMIN_PASSWORD: z.string().max(128).default(""),
    // Alternativa: hash bcrypt ya calculado (60 caracteres). Tiene prioridad
    // sobre SEED_ADMIN_PASSWORD y evita poner la contraseña en el entorno.
    SEED_ADMIN_PASSWORD_HASH: z.string().trim().max(60).default(""),
  })
  .transform((env) => ({
    ...env,
    corsOrigins: csvALista(env.CORS_ORIGINS),
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
  }))
  .superRefine((env, ctx) => {
    if (env.corsOrigins.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS debe listar al menos un origen permitido",
      });
    }
    // El comodín anularía por completo la lista blanca.
    if (env.corsOrigins.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS no admite '*'; enumera los orígenes exactos",
      });
    }
    // En producción exigimos contraseña de base de datos real.
    if (env.isProduction && env.DB_PASSWORD.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DB_PASSWORD"],
        message: "DB_PASSWORD no puede ir vacía en producción",
      });
    }
    // Una semilla con contraseña trivial sería peor que no tener semilla: la
    // cuenta creada es administradora.
    if (
      env.SEED_ADMIN_ENABLED &&
      env.SEED_ADMIN_PASSWORD.length > 0 &&
      env.SEED_ADMIN_PASSWORD.length < 8
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SEED_ADMIN_PASSWORD"],
        message: "SEED_ADMIN_PASSWORD debe tener al menos 8 caracteres",
      });
    }
    // Un hash mal copiado dejaría la cuenta sin poder iniciar sesión y sin
    // ningún aviso: se detecta aquí, no en el primer login fallido.
    if (
      env.SEED_ADMIN_PASSWORD_HASH.length > 0 &&
      !/^\$2[aby]\$\d{2}\$.{53}$/.test(env.SEED_ADMIN_PASSWORD_HASH)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SEED_ADMIN_PASSWORD_HASH"],
        message:
          "SEED_ADMIN_PASSWORD_HASH no tiene formato de hash bcrypt de 60 caracteres",
      });
    }
  });

// `safeParse` no lanza excepción: devuelve un objeto con el resultado, lo que
// permite reunir todos los problemas y reportarlos juntos antes de abortar.
const resultado = envSchema.safeParse(process.env);

if (!resultado.success) {
  // Reportamos qué variable falla, nunca su valor, para no filtrar secretos al log.
  const detalles = resultado.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
    .join("\n");
  console.error(
    `\n[config] Configuración de entorno inválida. El servidor no puede arrancar:\n${detalles}\n`
  );
  process.exit(1);
}

// Congelar el objeto impide que otro módulo altere la configuración en tiempo
// de ejecución (por ejemplo, sustituir el secreto JWT tras el arranque).
module.exports = Object.freeze(resultado.data);
