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

/** Registro de un jurado de tesis. */
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

/** Registro de una terna de tesis atómica (POST /asignaciones/terna). */
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
  .strict();

const FORMATO_FECHA_LOTE = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/;

const eliminarLoteQuerySchema = z
  .object({
    fecha: z
      .string()
      .trim()
      .regex(
        FORMATO_FECHA_LOTE,
        "La fecha del lote debe tener el formato dd/mm/aaaa hh:mm"
      ),
  })
  .strict();

const eliminarAsignacionAlumnoParamsSchema = z
  .object({
    carnet: textoRequerido(MAX_CARNET, "El carnet"),
    fecha: z
      .string()
      .trim()
      .regex(
        FORMATO_FECHA_LOTE,
        "La fecha debe tener el formato dd/mm/aaaa hh:mm"
      ),
  })
  .strict();

const listarAsignacionesQuerySchema = paginacionQuery.extend({
  limite: z.coerce.number().int().positive().max(500).default(500),
});

module.exports = {
  crearAsignacionSchema,
  crearTernaTesisSchema,
  eliminarLoteQuerySchema,
  eliminarAsignacionAlumnoParamsSchema,
  listarAsignacionesQuerySchema,
};