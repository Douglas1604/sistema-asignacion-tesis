/**
 * @fileoverview Definición OpenAPI 3 y montaje de Swagger UI.
 *
 * Postura de seguridad de la documentación:
 *  - `security` global exige bearerAuth, así un endpoint nuevo aparece como
 *    protegido salvo que declare explícitamente `security: []`.
 *  - La interfaz se sirve solo si SWAGGER_ENABLED es true, y se desactiva
 *    automáticamente en producción aunque la variable diga lo contrario.
 */

const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const env = require("./env");
const logger = require("./logger");

/** Ruta base de la API documentada. */
const BASE_PATH = "/api/v1";

const definicion = {
  openapi: "3.0.3",
  info: {
    title: "API Ruleta de Asignaciones Académicas",
    version: "1.0.0",
    description:
      "API REST del sistema de sorteo de asignaciones académicas (UMG). " +
      "Salvo el chequeo de salud y el login, todos los endpoints requieren un token Bearer.",
  },
  servers: [{ url: BASE_PATH, description: "Servidor actual" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Token obtenido en POST /auth/login. Enviar en la cabecera Authorization con el prefijo Bearer.",
      },
    },
    schemas: {
      // ---------- Errores ----------
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "UNAUTHORIZED" },
              message: {
                type: "string",
                example: "Se requiere un token de acceso",
              },
              details: {
                type: "array",
                description: "Presente solo en errores de validación.",
                items: {
                  type: "object",
                  properties: {
                    campo: { type: "string", example: "body.email" },
                    mensaje: {
                      type: "string",
                      example: "El correo es obligatorio",
                    },
                  },
                },
              },
              requestId: {
                type: "string",
                format: "uuid",
                description:
                  "Identificador para localizar la traza en los logs del servidor.",
              },
            },
          },
        },
      },
      MetaPaginacion: {
        type: "object",
        properties: {
          total: { type: "integer", example: 120 },
          pagina: { type: "integer", example: 1 },
          limite: { type: "integer", example: 20 },
        },
      },

      // ---------- Autenticación ----------
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: {
            type: "string",
            format: "email",
            maxLength: 100,
            example: "admin@umg.edu.gt",
          },
          password: {
            type: "string",
            maxLength: 128,
            example: "MiClaveSegura123",
          },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          token: { type: "string", description: "JWT de acceso." },
          expiresIn: { type: "string", example: "8h" },
          user: { $ref: "#/components/schemas/Usuario" },
        },
      },
      Usuario: {
        type: "object",
        description:
          "Representación pública de un usuario. Nunca incluye password_hash.",
        properties: {
          id: { type: "integer", example: 1 },
          username: { type: "string", example: "Admin" },
          email: {
            type: "string",
            format: "email",
            example: "admin@umg.edu.gt",
          },
          rol_id: { type: "integer", example: 1 },
          rol: { type: "string", nullable: true, example: "admin" },
          creado_en: {
            type: "string",
            nullable: true,
            example: "2026-02-18 05:31:03",
          },
        },
      },

      // ---------- Catálogo ----------
      TipoEvento: {
        type: "object",
        properties: {
          id: { type: "integer", example: 3 },
          nombre: { type: "string", example: "Tesis" },
          descripcion: {
            type: "string",
            nullable: true,
            example: "Trabajo de graduación",
          },
        },
      },

      // ---------- Asignaciones ----------
      AlumnoSorteo: {
        type: "object",
        required: ["carnet", "nombre_completo"],
        properties: {
          carnet: { type: "string", maxLength: 50, example: "1990-12-3456" },
          nombre_completo: {
            type: "string",
            maxLength: 100,
            example: "Ana López",
          },
          id: {
            type: "integer",
            description: "Índice auxiliar de la ruleta; se ignora al guardar.",
          },
        },
      },
      ProfesorSorteo: {
        type: "object",
        required: ["nombre_completo"],
        properties: {
          nombre_completo: {
            type: "string",
            maxLength: 100,
            example: "Ing. Juan Pérez",
          },
          id: {
            type: "integer",
            description: "Índice auxiliar de la ruleta; se ignora al guardar.",
          },
          area: { type: "string", maxLength: 100 },
        },
      },
      CrearAsignacionTesis: {
        type: "object",
        required: ["es_tesis", "alumno", "profesores"],
        properties: {
          es_tesis: { type: "boolean", enum: [true] },
          alumno: { $ref: "#/components/schemas/AlumnoSorteo" },
          profesores: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            description:
              "Jurado en orden de sorteo: Presidente, Vocal 1, Vocal 2.",
            items: { $ref: "#/components/schemas/ProfesorSorteo" },
          },
          tipo_evento_id: { type: "integer", example: 3 },
        },
      },
      CrearAsignacionTerna: {
        type: "object",
        required: ["es_tesis", "profesor_nombre", "alumnos"],
        properties: {
          es_tesis: { type: "boolean", enum: [false] },
          profesor_nombre: {
            type: "string",
            maxLength: 100,
            example: "Terna #1 - Ing. Juan Pérez",
          },
          alumnos: {
            type: "array",
            minItems: 1,
            maxItems: env.MAX_ALUMNOS_POR_LOTE,
            items: { $ref: "#/components/schemas/AlumnoSorteo" },
          },
          tipo_evento_id: { type: "integer", example: 1 },
        },
      },
      AsignacionReporte: {
        type: "object",
        properties: {
          modalidad: { type: "string", example: "Tesis" },
          profesor_nombre: {
            type: "string",
            example: "Ing. Juan Pérez (Presidente)",
          },
          alumno_info: { type: "string", example: "1990-12-3456 - Ana López" },
          fecha: { type: "string", example: "12/09/2026 10:30" },
        },
      },
    },
    responses: {
      PeticionInvalida: {
        description: "La petición está mal formada.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      NoAutenticado: {
        description: "Falta el token, o es inválido o ha expirado.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      SinPermisos: {
        description:
          "El usuario está autenticado pero su rol no permite la operación.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      NoEncontrado: {
        description: "El recurso solicitado no existe.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      CuerpoDemasiadoGrande: {
        description: "El cuerpo de la petición supera el límite configurado.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      ErrorValidacion: {
        description: "Los datos enviados no superan la validación.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      DemasiadasPeticiones: {
        description: "Se superó el límite de peticiones permitido.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
  },
  // Exigencia por defecto: protegido salvo declaración explícita de lo contrario.
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Salud", description: "Monitorización del servicio" },
    { name: "Autenticación", description: "Inicio de sesión y perfil" },
    {
      name: "Usuarios",
      description: "Gestión de cuentas (solo administrador)",
    },
    { name: "Asignaciones", description: "Resultados del sorteo y actas" },
    { name: "Tipos de evento", description: "Catálogo de modalidades" },
  ],
};

// El glob de swagger-jsdoc espera separadores POSIX; en Windows hay que
// normalizar las barras invertidas o no encontraría ningún archivo de rutas.
const GLOB_RUTAS = path
  .join(__dirname, "..", "routes", "*.js")
  .split(path.sep)
  .join("/");

const spec = swaggerJsdoc({
  definition: definicion,
  apis: [GLOB_RUTAS],
});

/**
 * Monta la documentación interactiva si el entorno lo permite.
 * @param {import("express").Express} app Aplicación de Express.
 */
function montarSwagger(app) {
  // En producción la documentación no se publica: describe la superficie de
  // ataque completa y facilita el trabajo de un atacante.
  if (env.isProduction || !env.SWAGGER_ENABLED) {
    logger.info("swagger_deshabilitado", {
      motivo: env.isProduction
        ? "entorno de producción"
        : "SWAGGER_ENABLED=false",
    });
    return;
  }

  app.get("/api-docs.json", (req, res) => res.json(spec));
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "API Ruleta de Asignaciones",
    })
  );

  logger.info("swagger_montado", { ruta: "/api-docs" });
}

module.exports = { spec, montarSwagger, BASE_PATH };
