/**
 * @fileoverview Reglas de negocio del registro de resultados del sorteo.
 *
 * Esta capa decide QUÉ se guarda y comprueba las precondiciones; el CÓMO se
 * escribe en la base queda en el repositorio. La semántica de la asignación
 * (jurado de 3 para tesis, un catedrático con su grupo para privado/seminario,
 * y la modalidad por defecto) se conserva idéntica a la implementación original.
 */

const crypto = require("crypto");
const AsignacionesRepository = require("../repositories/asignaciones.repository");
const TiposEventoRepository = require("../repositories/tiposEvento.repository");
const { aListaAsignacionesReporteDTO } = require("../dtos/asignacion.dto");
const AppError = require("../utils/AppError");
const logger = require("../config/logger");
const env = require("../config/env");

/** Tope duro de página para el historial. */
const LIMITE_MAXIMO = 500;

/** Modalidades por defecto heredadas del sorteo original. */
const MODALIDAD_TESIS_POR_DEFECTO = 3;
const MODALIDAD_NORMAL_POR_DEFECTO = 1;

/** Un jurado de tesis lo forman exactamente tres catedráticos. */
const CATEDRATICOS_POR_JURADO = 3;

/**
 * Resuelve la modalidad a registrar, replicando la regla previa:
 * se usa la enviada y, si no viene, 3 para tesis y 1 para el resto.
 * @param {number|undefined} tipoEventoId Modalidad recibida.
 * @param {boolean} esTesis Bandera de modalidad tesis.
 * @returns {number} Identificador de modalidad.
 */
function resolverTipoEvento(tipoEventoId, esTesis) {
  return (
    tipoEventoId || (esTesis ? MODALIDAD_TESIS_POR_DEFECTO : MODALIDAD_NORMAL_POR_DEFECTO)
  );
}

/**
 * Verifica que la modalidad exista en el catálogo antes de escribir.
 * @param {number} tipoEventoId Modalidad a comprobar.
 * @throws {AppError} 422 si la modalidad no existe.
 */
async function asegurarModalidadValida(tipoEventoId) {
  const existe = await TiposEventoRepository.existe(tipoEventoId);
  if (!existe) {
    throw AppError.unprocessable(
      "La modalidad indicada no existe en el catálogo de tipos de evento"
    );
  }
}

const AsignacionesService = {
  /**
   * Registra el resultado de un sorteo, sea jurado de tesis o terna normal.
   *
   * @param {object} payload Cuerpo ya validado por el esquema de entrada.
   * @param {{usuarioId?: number, ip?: string, requestId?: string}} [contexto] Datos de auditoría.
   * @returns {Promise<{registros: number, tipo_evento_id: number, modo: string}>}
   * @throws {AppError} 422 si faltan precondiciones del sorteo.
   */
  async registrar(payload, contexto = {}) {
    const esTesis = Boolean(payload.es_tesis);
    const tipoEventoId = resolverTipoEvento(payload.tipo_evento_id, esTesis);

    await asegurarModalidadValida(tipoEventoId);

    let registros;
    let modo;

    if (esTesis) {
      if (payload.profesores.length !== CATEDRATICOS_POR_JURADO) {
        throw AppError.unprocessable(
          "Un jurado de tesis requiere exactamente 3 catedráticos"
        );
      }
      modo = "tesis";
      registros = await AsignacionesRepository.crearAsignacionesTesis({
        alumno: payload.alumno,
        profesores: payload.profesores,
        tipoEventoId,
      });
    } else {
      if (payload.alumnos.length > env.MAX_ALUMNOS_POR_LOTE) {
        throw AppError.unprocessable(
          "Se excedió el número máximo de alumnos permitidos en un solo lote"
        );
      }
      modo = "terna";
      registros = await AsignacionesRepository.crearAsignacionesTerna({
        profesorNombre: payload.profesor_nombre,
        alumnos: payload.alumnos,
        tipoEventoId,
      });
    }

    logger.auditoria({
      accion: "ASIGNACIONES_CREADAS",
      recurso: "asignaciones",
      detalles: { modo, tipo_evento_id: tipoEventoId, registros },
      ...contexto,
    });

    return { registros, tipo_evento_id: tipoEventoId, modo };
  },

  /**
   * Registra una terna de tesis completa de forma atómica (Issue #7).
   * Inserta los 3 catedráticos y todos sus alumnos bajo una única transacción MariaDB y un único lote_id.
   *
   * @param {object} payload Cuerpo ya validado: {profesores[3], alumnos[], tipo_evento_id?}.
   * @param {{usuarioId?: number, ip?: string, requestId?: string}} [contexto] Datos de auditoría.
   * @returns {Promise<{lote_id: string, registros: number, alumnos: number, tipo_evento_id: number, modo: string}>}
   * @throws {AppError} 422 si no se cumplen las precondiciones.
   */
  async registrarTernaTesis(payload, contexto = {}) {
    const tipoEventoId = resolverTipoEvento(payload.tipo_evento_id, true);
    await asegurarModalidadValida(tipoEventoId);

    if (payload.profesores.length !== CATEDRATICOS_POR_JURADO) {
      throw AppError.unprocessable(
        "Un jurado de tesis requiere exactamente 3 catedráticos"
      );
    }

    if (payload.alumnos.length > env.MAX_ALUMNOS_POR_LOTE) {
      throw AppError.unprocessable(
        "Se excedió el número máximo de alumnos permitidos en un solo lote"
      );
    }

    const loteId = crypto.randomUUID();

    const registros = await AsignacionesRepository.crearTernaTesis({
      loteId,
      alumnos: payload.alumnos,
      profesores: payload.profesores,
      tipoEventoId,
    });

    logger.auditoria({
      accion: "TERNA_TESIS_CREADA",
      recurso: "asignaciones",
      detalles: {
        lote_id: loteId,
        tipo_evento_id: tipoEventoId,
        alumnos: payload.alumnos.length,
        registros,
        modo: "tesis",
      },
      ...contexto,
    });

    return {
      lote_id: loteId,
      registros,
      alumnos: payload.alumnos.length,
      tipo_evento_id: tipoEventoId,
      modo: "tesis",
    };
  },

  /**
   * Devuelve el historial de sorteos para la pantalla de reportes.
   * @param {{limite?: number, pagina?: number}} opciones Parámetros ya validados.
   * @returns {Promise<{items: object[], meta: object}>}
   */
  async listarHistorial({ limite = 500, pagina = 1 } = {}) {
    const limiteSeguro = Math.min(limite, LIMITE_MAXIMO);
    const desplazamiento = (pagina - 1) * limiteSeguro;

    const [filas, total] = await Promise.all([
      AsignacionesRepository.listarParaReporte({
        limite: limiteSeguro,
        desplazamiento,
      }),
      AsignacionesRepository.contar(),
    ]);

    return {
      items: aListaAsignacionesReporteDTO(filas),
      meta: { total, pagina, limite: limiteSeguro },
    };
  },

  /**
   * Elimina las asignaciones de un alumno dentro de un lote concreto.
   * @param {{carnet: string, fecha: string}} datos Identificadores del registro.
   * @param {{usuarioId?: number, ip?: string, requestId?: string}} [contexto] Datos de auditoría.
   * @returns {Promise<{eliminados: number}>}
   * @throws {AppError} 404 si no existe esa asignación.
   */
  async eliminarAsignacionAlumno({ carnet, fecha }, contexto = {}) {
    const existentes = await AsignacionesRepository.contarPorAlumnoYFecha(
      carnet,
      fecha
    );
    if (existentes === 0) {
      throw AppError.notFound("No existe ninguna asignación para ese alumno y fecha");
    }

    const eliminados = await AsignacionesRepository.eliminarPorAlumnoYFecha(
      carnet,
      fecha
    );

    logger.auditoria({
      accion: "ASIGNACION_ALUMNO_ELIMINADA",
      recurso: "asignaciones",
      detalles: { carnet, fecha, eliminados },
      ...contexto,
    });

    return { eliminados };
  },

  /**
   * Elimina un lote completo de asignaciones identificado por su marca de tiempo.
   * @param {string} fecha Marca en formato dd/mm/aaaa hh:mm.
   * @param {{usuarioId?: number, ip?: string, requestId?: string}} [contexto] Datos de auditoría.
   * @returns {Promise<{eliminados: number}>}
   * @throws {AppError} 404 si no hay ningún registro con esa marca.
   */
  async eliminarLote(fecha, contexto = {}) {
    const existentes = await AsignacionesRepository.contarPorFechaLote(fecha);
    if (existentes === 0) {
      throw AppError.notFound("No existe ningún lote de sorteo con esa fecha");
    }

    const eliminados = await AsignacionesRepository.eliminarLotePorFecha(fecha);

    logger.auditoria({
      accion: "ASIGNACIONES_LOTE_ELIMINADO",
      recurso: "asignaciones",
      detalles: { fecha, eliminados },
      ...contexto,
    });

    return { eliminados };
  },
};

module.exports = AsignacionesService;