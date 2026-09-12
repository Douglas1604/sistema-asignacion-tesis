/**
 * @fileoverview Registro de eventos apto para auditoría.
 * Emite JSON por línea con el identificador de petición, para poder rastrear
 * una operación de punta a punta. Antes de escribir, redacta cualquier campo
 * sensible: contraseñas, hashes, tokens y cabeceras de autorización.
 */

const env = require("./env");

/** Claves cuyo valor jamás debe aparecer en un log. */
const CLAVES_SENSIBLES = new Set([
  "password",
  "password_hash",
  "passwordhash",
  "contrasena",
  "token",
  "authorization",
  "jwt",
  "jwt_secret",
  "secret",
  "cookie",
  "db_password",
]);

const MARCA_REDACTADO = "[REDACTADO]";

/**
 * Copia una estructura sustituyendo los valores de claves sensibles.
 * @param {*} valor Estructura a limpiar.
 * @param {number} [profundidad] Control interno de recursión.
 * @returns {*} Copia segura para escribir en el log.
 */
function redactar(valor, profundidad = 0) {
  // Caso base de la recursión. El tope de profundidad protege frente a
  // estructuras cíclicas o excesivamente anidadas que desbordarían la pila.
  if (profundidad > 6 || valor === null || typeof valor !== "object") {
    return valor;
  }
  if (Array.isArray(valor)) {
    return valor.map((item) => redactar(item, profundidad + 1));
  }
  const limpio = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    limpio[clave] = CLAVES_SENSIBLES.has(clave.toLowerCase())
      ? MARCA_REDACTADO
      : redactar(contenido, profundidad + 1);
  }
  return limpio;
}

/**
 * Escribe una línea de log estructurada.
 * @param {"info"|"warn"|"error"} nivel Severidad.
 * @param {string} mensaje Descripción corta y estable del evento.
 * @param {object} [contexto] Datos adicionales (se redactan antes de emitir).
 */
function escribir(nivel, mensaje, contexto = {}) {
  // Durante los tests silenciamos la salida para no ensuciar el reporte.
  if (env.isTest) return;

  const linea = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    mensaje,
    ...redactar(contexto),
  });

  if (nivel === "error") console.error(linea);
  else if (nivel === "warn") console.warn(linea);
  else console.log(linea);
}

/**
 * Fachada de registro utilizada por el resto de la aplicación.
 * Desacopla el código de negocio del destino físico del log (hoy la consola,
 * mañana un colector externo) sin modificar a los consumidores.
 */
const logger = {
  info: (mensaje, contexto) => escribir("info", mensaje, contexto),
  warn: (mensaje, contexto) => escribir("warn", mensaje, contexto),
  error: (mensaje, contexto) => escribir("error", mensaje, contexto),

  /**
   * Registra un evento de auditoría: quién hizo qué, sobre qué recurso.
   * Es el rastro que permite reconstruir las operaciones sensibles del sistema.
   * @param {object} evento
   * @param {string} evento.accion Acción realizada (LOGIN_EXITOSO, ASIGNACIONES_CREADAS...).
   * @param {number|null} [evento.usuarioId] Usuario responsable, si lo hay.
   * @param {string} [evento.recurso] Recurso afectado.
   * @param {object} [evento.detalles] Datos adicionales no sensibles.
   * @param {string} [evento.requestId] Identificador de la petición.
   * @param {string} [evento.ip] IP de origen.
   */
  auditoria: (evento) => escribir("info", "auditoria", { tipo: "AUDIT", ...evento }),
};

module.exports = logger;
