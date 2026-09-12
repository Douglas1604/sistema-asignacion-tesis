/**
 * @fileoverview Punto de arranque del servidor.
 *
 * Responsabilidades, en este orden:
 *   1. Validar la configuración de entorno (lo hace `config/env` al importarse;
 *      si algo falta, el proceso termina antes de escuchar peticiones).
 *   2. Comprobar que la base de datos responde.
 *   3. Abrir el puerto.
 *   4. Apagar de forma ordenada ante una señal del sistema.
 *
 * La construcción de la app vive en `src/app.js`, de modo que los tests puedan
 * usarla sin levantar un puerto real.
 */

const env = require("./src/config/env");
const logger = require("./src/config/logger");
const crearApp = require("./src/app");
const { verificarConexion, cerrarPool } = require("./src/config/db");

/** Margen para que las peticiones en curso terminen antes de cerrar. */
const TIEMPO_ESPERA_APAGADO_MS = 10000;

async function iniciar() {
  // Arrancar sin base de datos solo serviría para devolver errores 500 a todo
  // el mundo; es preferible fallar ruidosamente aquí.
  try {
    await verificarConexion();
    logger.info("bd_conectada", { base: env.DB_NAME, host: env.DB_HOST });
  } catch (error) {
    logger.error("bd_no_disponible", {
      base: env.DB_NAME,
      host: env.DB_HOST,
      // El mensaje del driver no contiene credenciales, pero sí el host/puerto:
      // queda en el log del servidor, nunca en una respuesta HTTP.
      motivo: error.message,
    });
    process.exit(1);
  }

  const app = crearApp();

  const server = app.listen(env.PORT, () => {
    logger.info("servidor_iniciado", {
      puerto: env.PORT,
      entorno: env.NODE_ENV,
      documentacion:
        env.SWAGGER_ENABLED && !env.isProduction ? "/api-docs" : "deshabilitada",
      origenesPermitidos: env.corsOrigins,
    });
  });

  /**
   * Cierra el servidor y el pool de conexiones de forma ordenada.
   * @param {string} senal Señal recibida del sistema operativo.
   */
  async function apagar(senal) {
    logger.info("apagado_iniciado", { senal });

    // Si alguna conexión se queda colgada, no bloqueamos el apagado para siempre.
    const temporizador = setTimeout(() => {
      logger.warn("apagado_forzado", { motivo: "tiempo de espera agotado" });
      process.exit(1);
    }, TIEMPO_ESPERA_APAGADO_MS);
    temporizador.unref();

    server.close(async () => {
      try {
        await cerrarPool();
        logger.info("apagado_completado");
        process.exit(0);
      } catch (error) {
        logger.error("apagado_con_errores", { motivo: error.message });
        process.exit(1);
      }
    });
  }

  process.on("SIGTERM", () => apagar("SIGTERM"));
  process.on("SIGINT", () => apagar("SIGINT"));

  // Una promesa rechazada sin manejar deja el proceso en estado indefinido:
  // se registra y se termina para que el supervisor lo reinicie limpio.
  process.on("unhandledRejection", (motivo) => {
    logger.error("promesa_rechazada_sin_manejar", {
      motivo: motivo instanceof Error ? motivo.message : String(motivo),
    });
    apagar("unhandledRejection");
  });

  process.on("uncaughtException", (error) => {
    logger.error("excepcion_no_capturada", {
      motivo: error.message,
      stack: env.isProduction ? undefined : error.stack,
    });
    process.exit(1);
  });
}

iniciar();
