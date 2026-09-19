/**
 * @fileoverview Piezas de validación reutilizables.
 */

const { z } = require("zod");

/**
 * Identificador numérico positivo procedente de la URL.
 * `coerce` es necesario porque todo segmento de ruta y de query llega como
 * string; la coerción ocurre antes de las reglas `int` y `positive`.
 */
const idParam = z.coerce.number().int().positive();

/** Paginación común a los listados. */
const paginacionQuery = z
  .object({
    pagina: z.coerce.number().int().positive().default(1),
    limite: z.coerce.number().int().positive().max(500).default(20),
  })
  .strict();

/**
 * Caracteres de control e invisibles (incluye el override RTL U+202E): se
 * sustituyen por un espacio antes de cualquier otra comprobación, igual que
 * en `frontend/src/app/core/excel-seguro.ts`. Sin esto, un '=' podría
 * esconderse detrás de un carácter "vacío" que el usuario no ve, y los
 * caracteres de control contaminarían logs y actas.
 * Construido con `new RegExp` sobre una cadena con escapes dobles para que
 * ningún editor/herramienta normalice los puntos de código a caracteres
 * literales dentro del archivo fuente.
 */
const CARACTERES_INVISIBLES = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200D\\u2060\\uFEFF\\u202E]",
  "g"
);

/**
 * Prefijos que una hoja de cálculo interpreta como inicio de fórmula
 * (OWASP "CSV/Formula Injection"): `=`, `+`, `-`, `@`.
 */
const PREFIJO_FORMULA = /^[=+\-@]/;

/**
 * Limpia un valor de entrada ANTES de validarlo: quita caracteres de control
 * e invisibles, colapsa espacios y neutraliza un posible prefijo de fórmula
 * anteponiendo un apóstrofo, como hace Excel.
 *
 * El ORDEN es parte del control de seguridad: los invisibles se eliminan y
 * los espacios se recortan ANTES de comprobar el prefijo, para que una
 * cadena con un carácter invisible delante de "=SUM(A1)" no esconda la
 * fórmula. Este texto se guarda tal cual en la base de datos, así que
 * también protege el acta exportada a Excel: nunca reaparece "en crudo".
 *
 * @param {unknown} valor Valor bruto recibido en el cuerpo, query o params.
 * @returns {unknown} El texto saneado, o el valor original si no es string.
 */
function limpiarTexto(valor) {
  if (typeof valor !== "string") return valor;

  let texto = valor.replace(CARACTERES_INVISIBLES, " ").replace(/\s+/g, " ").trim();

  if (PREFIJO_FORMULA.test(texto)) {
    texto = `'${texto}`;
  }

  return texto;
}

/**
 * Texto corto obligatorio, saneado contra inyección de fórmulas y caracteres
 * de control antes de aplicar los límites de longitud.
 * @param {number} max Longitud máxima permitida.
 * @param {string} etiqueta Nombre del campo para el mensaje de error.
 * @returns {import("zod").ZodType<string>} Esquema reutilizable.
 */
const textoRequerido = (max, etiqueta) =>
  z.preprocess(
    limpiarTexto,
    z
      .string()
      .min(1, etiqueta + " es obligatorio")
      .max(max, etiqueta + " excede la longitud permitida")
  );

module.exports = { idParam, paginacionQuery, textoRequerido };
