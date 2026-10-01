/**
 * @fileoverview Esquemas de validación del módulo de autenticación.
 */

const { z } = require("zod");

/**
 * Longitud máxima aceptada para una contraseña. Frena hashes desmedidos.
 * Nota: bcrypt solo considera los primeros 72 bytes de la entrada; el tope
 * evita además que se envíen cadenas enormes para consumir CPU del servidor.
 */
const MAX_PASSWORD = 128;

/** Longitud máxima del identificador, alineada con `usuarios.email`. */
const MAX_IDENTIFICADOR = 100;

/**
 * Credenciales de inicio de sesión.
 *
 * @description El cliente puede enviar `email`, `username` o ambos: la cuenta
 * administradora del sistema existe con las dos formas y obligar a una sola
 * dejaría fuera a la otra. El esquema los unifica en `identificador`, que es
 * lo único que el servicio necesita.
 *
 * Normalización: se recorta siempre y se pasa a minúsculas solo cuando el
 * valor parece un correo (contiene `@`). Un nombre de usuario se deja tal
 * cual, porque una colación sensible a mayúsculas lo haría irreconocible.
 *
 * No se exige aquí una contraseña "fuerte" ni un formato de correo estricto:
 * eso pertenece al alta de usuarios, y aplicarlo al login solo daría pistas
 * sobre qué cuentas existen y cómo son sus credenciales.
 */
const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(MAX_IDENTIFICADOR, "El correo excede la longitud permitida")
      .optional(),
    username: z
      .string()
      .trim()
      .max(MAX_IDENTIFICADOR, "El usuario excede la longitud permitida")
      .optional(),
    // Declarada opcional a propósito: la obligatoriedad se comprueba en el
    // `superRefine`, que solo se ejecuta si el objeto base valida. Si aquí se
    // exigiera con `.min(1)`, un cuerpo vacío fallaría antes de llegar al
    // refinamiento y el cliente recibiría el error de la contraseña pero no el
    // del identificador, teniendo ambos el mismo problema.
    password: z
      .string()
      .max(MAX_PASSWORD, "La contraseña excede la longitud permitida")
      .optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (!datos.email && !datos.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Indica tu correo o tu nombre de usuario",
      });
    }
    if (!datos.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["password"],
        message: "La contraseña es obligatoria",
      });
    }
  })
  .transform((datos) => {
    const crudo = datos.email || datos.username || "";
    const identificador = crudo.includes("@") ? crudo.toLowerCase() : crudo;

    return { identificador, password: datos.password };
  });

module.exports = { loginSchema };
