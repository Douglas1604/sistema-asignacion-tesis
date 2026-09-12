/**
 * @fileoverview Ensamblado de la aplicación Express.
 *
 * Aquí solo se construye la app y se encadenan los middlewares en el orden
 * correcto. No se abre ningún puerto ni se conecta a la base de datos: de eso
 * se encarga `server.js`. Separarlo permite que los tests levanten la app en
 * memoria sin ocupar el puerto 3000.
 *
 * Orden de la cadena (importa):
 *   1. Identificador de petición  -> para poder rastrear todo lo que viene detrás.
 *   2. Cabeceras de seguridad     -> antes de emitir cualquier respuesta.
 *   3. CORS con lista blanca      -> rechaza orígenes no autorizados cuanto antes.
 *   4. Límite de cuerpo + parseo  -> corta las cargas grandes antes de procesarlas.
 *   5. Limitador de tasa          -> protege las rutas de negocio.
 *   6. Rutas                      -> autenticación y validación por endpoint.
 *   7. 404 y manejador de errores -> siempre al final.
 */

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const env = require("./config/env");
const logger = require("./config/logger");
const { montarSwagger, BASE_PATH } = require("./config/swagger");

const requestId = require("./middlewares/requestId");
const { apiLimiter } = require("./middlewares/rateLimit");
const { errorHandler, notFoundHandler } = require("./middlewares/errorHandler");

const healthRoutes = require("./routes/health.routes");
const apiV1Routes = require("./routes");

/**
 * Política CORS basada en lista blanca.
 * Se rechaza cualquier origen que no esté declarado en CORS_ORIGINS. Las
 * peticiones sin cabecera Origin (curl, health checks del servidor, pruebas)
 * se permiten porque no proceden de un navegador y no hay sesión que robar.
 */
const corsOptions = {
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    const error = new Error("Origen no permitido por la política CORS");
    error.code = "CORS_NOT_ALLOWED";
    return callback(error);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Request-Id"],
  credentials: true,
  maxAge: 600,
};

/**
 * Construye la aplicación Express ya configurada.
 * @returns {import("express").Express}
 */
function crearApp() {
  const app = express();

  // Sin esto, detrás de un proxy todas las peticiones parecerían venir de la
  // misma IP y el limitador de tasa castigaría a todos los usuarios a la vez.
  app.set("trust proxy", env.TRUST_PROXY === "true" ? 1 : false);

  // Revelaría que el backend es Express y su versión aproximada.
  app.disable("x-powered-by");

  app.use(requestId);

  // Cabeceras defensivas: nosniff, frameguard, HSTS, referrer-policy, CSP...
  app.use(
    helmet({
      // La API devuelve JSON, no incrusta recursos de terceros: la política
      // más restrictiva es la correcta.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    })
  );

  app.use(cors(corsOptions));

  // Límite de tamaño de cuerpo. Superarlo provoca un error `entity.too.large`
  // que el manejador central traduce a 413 sin llegar a las rutas.
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(
    express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT })
  );

  // Registro de acceso. El formato omite deliberadamente cabeceras y cuerpos,
  // que es donde viajarían tokens y contraseñas.
  if (!env.isTest) {
    app.use(
      morgan(
        ':remote-addr :method :url :status :res[content-length] - :response-time ms',
        {
          stream: {
            write: (linea) => logger.info("acceso", { detalle: linea.trim() }),
          },
        }
      )
    );
  }

  // Documentación: solo fuera de producción y si está habilitada.
  montarSwagger(app);

  // Chequeo de salud: público, montado bajo la misma base que documenta el spec.
  app.use(BASE_PATH, healthRoutes);

  // Resto de la API, ya con limitador de tasa general.
  app.use(BASE_PATH, apiLimiter, apiV1Routes);

  // Cualquier otra ruta no existe.
  app.use(notFoundHandler);

  // Único punto que convierte excepciones en respuestas HTTP.
  app.use(errorHandler);

  return app;
}

module.exports = crearApp;
