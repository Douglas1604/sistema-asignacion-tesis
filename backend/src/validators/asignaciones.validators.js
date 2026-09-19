/**
 * @fileoverview Esquemas de validación del módulo de asignaciones.
 */

const { z } = require("zod");
const env = require("../config/env");
const { paginacionQuery, textoRequerido } = require("./comunes");

/** Longitudes alineadas con las columnas de la tabla `asignaciones`. */
const MAX_NOMBRE = 100;
const MAX_CARNET = 50;

/** Un jurado de tesis lo forman exactamente tres catedráticos. */
const CATEDRATICOS_POR_JURADO = 3;

/** Alumno tal y como lo entrega la ruleta. */
const alumnoSchema = z.object({
  carnet: textoRequerido(MAX_CARNET, "El carnet"),
  nombre_completo: textoRequerido(MAX_NOMBRE, "El nombre del alumno"),
  id: z.coerce.number().int().optional(),
});

/** Catedrático tal y como lo entrega la ruleta. */
const profesorSchema = z.object({
  nombre_completo: textoRequerido(MAX_NOMBRE, "El nombre del catedrático"),
  id: z.coerce.number().int().optional(),
  area: z.string().max(MAX_NOMBRE).optional(),
});

/** Modalidad del evento. */
const tipoEventoIdSchema = z.coerce.number().int().positive();

/** Identificador de lote: UUID generado por el servicio al guardar. */
const loteIdSchema = z.uuid("El lote_id debe ser un UUID válido");

/**
 * Registro de un jurado de tesis.
 *
 * `lote_id` es opcional: si se omite, el servicio crea un lote nuevo; si se
 * envía (el mismo que devolvió un guardado anterior), el alumno se adjunta a
 * ese lote en vez de abrir uno propio. Así el sorteo agrupa a varios
 * tesistas sorteados en la misma sesión bajo un único lote.
 */
const asignacionTesisSchema = z
  .object({
    es_tesis: z.literal(true),
    alumno: alumnoSchema,
    profesores: z
      .array(profesorSchema)
      .length(
        CATEDRATICOS_POR_JURADO,
        "Un jurado de tesis requiere exactamente 3 catedráticos"
      ),
    tipo_evento_id: tipoEventoIdSchema.optional(),
    lote_id: loteIdSchema.optional(),
  })
  .strict();

/** Registro de una terna de privado o seminario. */
const asignacionTernaSchema = z
  .object({
    es_tesis: z.literal(false),
    profesor_nombre: textoRequerido(MAX_NOMBRE, "El nombre del catedrático"),
    alumnos: z
      .array(alumnoSchema)
      .min(1, "Debe asignarse al menos un alumno")
      .max(
        env.MAX_ALUMNOS_POR_LOTE,
        "Se excedió el número máximo de alumnos permitidos en un solo lote"
      ),
    tipo_evento_id: tipoEventoIdSchema.optional(),
  })
  .strict();

/** Cuerpo aceptado por POST /asignaciones. */
const crearAsignacionSchema = z.discriminatedUnion("es_tesis", [
  asignacionTesisSchema,
  asignacionTernaSchema,
]);

/**
 * Registro de una terna de tesis atómica (POST /asignaciones/terna).
 * El `superRefine` rechaza carnets repetidos dentro de la misma terna: sin
 * esto, el mismo alumno podría recibir dos filas en el lote.
 */
const crearTernaTesisSchema = z
  .object({
    profesores: z
      .array(profesorSchema)
      .length(
        CATEDRATICOS_POR_JURADO,
        "Un jurado de tesis requiere exactamente 3 catedráticos"
      ),
    alumnos: z
      .array(alumnoSchema)
      .min(1, "Debe asignarse al menos un alumno")
      .max(
        env.MAX_ALUMNOS_POR_LOTE,
        "Se excedió el número máximo de alumnos permitidos en un solo lote"
      ),
    tipo_evento_id: tipoEventoIdSchema.optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    const carnetsVistos = new Set();
    datos.alumnos.forEach((alumno, indice) => {
      if (carnetsVistos.has(alumno.carnet)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["alumnos", indice, "carnet"],
          message: "El carnet está repetido dentro de la misma terna",
        });
      } else {
        carnetsVistos.add(alumno.carnet);
      }
    });
  });

const eliminarLoteParamsSchema = z
  .object({
    lote_id: loteIdSchema,
  })
  .strict();

const eliminarAsignacionAlumnoParamsSchema = z
  .object({
    lote_id: loteIdSchema,
    carnet: textoRequerido(MAX_CARNET, "El carnet"),
  })
  .strict();

const listarAsignacionesQuerySchema = paginacionQuery.extend({
  limite: z.coerce.number().int().positive().max(500).default(500),
});

module.exports = {
  crearAsignacionSchema,
  crearTernaTesisSchema,
  eliminarLoteParamsSchema,
  eliminarAsignacionAlumnoParamsSchema,
  listarAsignacionesQuerySchema,
};