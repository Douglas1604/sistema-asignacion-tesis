/**
 * @fileoverview Esquemas de validación del módulo de asignaciones.
 *
 * El cuerpo admite dos formas excluyentes, las mismas que emite el sorteo:
 *  - Tesis   (es_tesis = true):  un alumno y un jurado de 3 catedráticos.
 *  - Terna   (es_tesis = false): un catedrático y su grupo de alumnos.
 * Se modela como unión discriminada para que cada forma se valide con sus
 * propias reglas y no se acepte una mezcla de ambas.
 */

const { z } = require("zod");
const env = require("../config/env");
const { paginacionQuery, textoRequerido } = require("./comunes");

/** Longitudes alineadas con las columnas de la tabla `asignaciones`. */
const MAX_NOMBRE = 100;
const MAX_CARNET = 50;

/** Un jurado de tesis lo forman exactamente tres catedráticos. */
const CATEDRATICOS_POR_JURADO = 3;

/**
 * Alumno tal y como lo entrega la ruleta.
 * Los campos `id` y demás claves auxiliares del Excel se descartan en vez de
 * rechazarse: son ruido de la hoja de cálculo, no entrada de negocio.
 */
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
      // Tope de tamaño de lote: junto al límite de cuerpo, acota el trabajo
      // que una sola petición puede provocar en la base de datos.
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
 * Marca de tiempo que identifica un lote, en el formato exacto que produce
 * el reporte (DATE_FORMAT '%d/%m/%Y %H:%i'). Validar la forma evita que
 * llegue a la consulta cualquier cadena arbitraria.
 */
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

/**
 * Identificadores de una asignación individual: carnet del alumno y marca de
 * tiempo del lote. Ambos llegan por la URL, así que se acotan en forma y
 * longitud antes de llegar a la consulta.
 */
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

/** Filtros del historial de asignaciones. */
const listarAsignacionesQuerySchema = paginacionQuery.extend({
  limite: z.coerce.number().int().positive().max(500).default(500),
});

module.exports = {
  crearAsignacionSchema,
  eliminarLoteQuerySchema,
  eliminarAsignacionAlumnoParamsSchema,
  listarAsignacionesQuerySchema,
};
