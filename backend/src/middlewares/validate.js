/**
 * @fileoverview Validación de entradas con Zod.
 *
 * Se valida body, query y params contra esquemas estrictos. Los esquemas usan
 * `.strict()`, de modo que un campo no declarado hace fallar la petición en vez
 * de colarse hacia las capas inferiores. El valor ya saneado sustituye al
 * original, así los controladores trabajan siempre con datos de forma conocida.
 */

const AppError = require("../utils/AppError");

/**
 * Traduce los problemas de Zod a un detalle seguro para el cliente:
 * qué campo falló y por qué, nunca el valor recibido.
 * @param {import("zod").ZodError} error Error de validación.
 * @returns {Array<{campo: string, mensaje: string}>}
 */
function formatearProblemas(error) {
  return error.issues.map((issue) => ({
    campo: issue.path.join(".") || "(raíz)",
    mensaje: issue.message,
  }));
}

/**
 * Construye un middleware que valida las partes indicadas de la petición.
 *
 * @param {{body?: import("zod").ZodTypeAny, query?: import("zod").ZodTypeAny, params?: import("zod").ZodTypeAny}} esquemas
 * @returns {import("express").RequestHandler}
 */
function validate(esquemas) {
  return (req, res, next) => {
    // Se acumulan los problemas de todas las partes en lugar de cortar en el
    // primero: el cliente recibe en una sola respuesta la lista completa de
    // campos a corregir.
    const problemas = [];

    for (const parte of ["body", "params", "query"]) {
      const esquema = esquemas[parte];
      if (!esquema) continue;

      // `safeParse` además de validar TRANSFORMA: recorta espacios, pasa el
      // correo a minúsculas, convierte "5" en 5 y descarta claves no declaradas.
      const resultado = esquema.safeParse(req[parte]);

      if (!resultado.success) {
        problemas.push(
          ...formatearProblemas(resultado.error).map((problema) => ({
            ...problema,
            campo: `${parte}.${problema.campo}`,
          }))
        );
        continue;
      }

      // En Express 5 `req.query` es un getter sin setter, así que los datos
      // validados se publican en `req.validated` en lugar de reasignarse.
      if (parte === "query") {
        req.validatedQuery = resultado.data;
      } else {
        req[parte] = resultado.data;
      }
    }

    if (problemas.length > 0) {
      return next(
        AppError.unprocessable("La petición contiene datos inválidos", problemas)
      );
    }

    return next();
  };
}

module.exports = validate;
