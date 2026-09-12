/**
 * @fileoverview DTOs del módulo de asignaciones y del catálogo de modalidades.
 */

/**
 * Fila del historial tal y como la consume el generador de actas del frontend.
 * @param {object} fila Fila del repositorio.
 * @returns {{modalidad: string, profesor_nombre: string, alumno_info: string, fecha: string}}
 */
function aAsignacionReporteDTO(fila) {
  return {
    modalidad: fila.modalidad,
    profesor_nombre: fila.profesor_nombre,
    alumno_info: fila.alumno_info,
    fecha: fila.fecha,
  };
}

/**
 * @param {object[]} filas Filas del repositorio.
 * @returns {object[]}
 */
function aListaAsignacionesReporteDTO(filas) {
  return filas.map(aAsignacionReporteDTO);
}

/**
 * @param {object} fila Fila de `tipos_evento`.
 * @returns {{id: number, nombre: string, descripcion: string|null}}
 */
function aTipoEventoDTO(fila) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion || null,
  };
}

/**
 * @param {object[]} filas Filas de `tipos_evento`.
 * @returns {object[]}
 */
function aListaTiposEventoDTO(filas) {
  return filas.map(aTipoEventoDTO);
}

module.exports = {
  aAsignacionReporteDTO,
  aListaAsignacionesReporteDTO,
  aTipoEventoDTO,
  aListaTiposEventoDTO,
};
