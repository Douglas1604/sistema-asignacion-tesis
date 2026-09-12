/**
 * @fileoverview Piezas de validación reutilizables.
 */

const { z } = require("zod");

/** Identificador numérico positivo procedente de la URL. */
const idParam = z.coerce.number().int().positive();

/** Paginación común a los listados. */
const paginacionQuery = z
  .object({
    pagina: z.coerce.number().int().positive().default(1),
    limite: z.coerce.number().int().positive().max(500).default(20),
  })
  .strict();

/**
 * Texto corto obligatorio, recortado de espacios.
 * @param {number} max Longitud máxima permitida.
 * @param {string} etiqueta Nombre del campo para el mensaje de error.
 */
const textoRequerido = (max, etiqueta) =>
  z
    .string()
    .trim()
    .min(1, etiqueta + " es obligatorio")
    .max(max, etiqueta + " excede la longitud permitida");

module.exports = { idParam, paginacionQuery, textoRequerido };
