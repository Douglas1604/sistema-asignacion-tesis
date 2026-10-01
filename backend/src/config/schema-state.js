/**
 * @fileoverview Capacidades detectadas del esquema de la base de datos.
 *
 * MOTIVO: el servidor de producción no siempre tiene aplicadas las mismas
 * migraciones que el entorno local, y no hay acceso a su consola para
 * comprobarlo. En vez de asumir columnas que quizá no existan (lo que
 * convertiría cada consulta en un error 500), el arranque las detecta una vez
 * y publica aquí el resultado; los repositorios componen su SQL en función de
 * estas banderas.
 *
 * Todas empiezan en `false`: sin detección previa se emite el SQL mínimo, que
 * es el que funciona contra el esquema más antiguo.
 */

/**
 * Banderas de capacidad del esquema vigente.
 * Es un objeto mutable a propósito: `bootstrap.js` lo rellena en el arranque y
 * el resto del proceso lo lee. No se congela porque los tests pueden querer
 * simular un esquema concreto.
 *
 * @type {{usuariosActive: boolean, asignacionesActive: boolean, asignacionesLoteId: boolean}}
 */
const estadoEsquema = {
  /** `usuarios.active` existe: el login puede exigir cuentas habilitadas. */
  usuariosActive: false,
  /** `asignaciones.active` existe: el borrado de lotes puede ser lógico. */
  asignacionesActive: false,
  /** `asignaciones.lote_id` existe: las actas se agrupan y borran por lote. */
  asignacionesLoteId: false,
};

module.exports = estadoEsquema;
