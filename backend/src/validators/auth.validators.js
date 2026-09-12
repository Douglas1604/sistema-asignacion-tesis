/**
 * @fileoverview Esquemas de validación del módulo de autenticación.
 */

const { z } = require("zod");

/** Longitud máxima aceptada para una contraseña. Frena hashes desmedidos. */
const MAX_PASSWORD = 128;

/**
 * Credenciales de inicio de sesión.
 * El correo se normaliza a minúsculas para que la búsqueda sea estable.
 * No se exige aquí una contraseña "fuerte": eso pertenece al alta de usuarios,
 * y aplicarlo al login solo daría pistas sobre el formato de las contraseñas.
 */
const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "El correo es obligatorio")
      .max(100, "El correo excede la longitud permitida")
      .email("El correo no tiene un formato válido"),
    password: z
      .string()
      .min(1, "La contraseña es obligatoria")
      .max(MAX_PASSWORD, "La contraseña excede la longitud permitida"),
  })
  .strict();

module.exports = { loginSchema };
