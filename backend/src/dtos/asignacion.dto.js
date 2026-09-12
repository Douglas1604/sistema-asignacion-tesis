/**
 * @fileoverview DTOs del módulo de asignaciones y del catálogo de modalidades.
 *
 * Un DTO (Data Transfer Object) define el contrato de salida de la API con
 * independencia del esquema de la base de datos: si una tabla cambia, se
 * adapta esta proyección y el frontend no percibe la diferencia.
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
 * Proyecta una colección completa de filas del historial.
 * @param {object[]} filas Filas del repositorio.
 * @returns {object[]}
 */
function aListaAsignacionesReporteDTO(filas) {
  return filas.map(aAsignacionReporteDTO);
}

/**
 * Proyecta una modalidad del catálogo; normaliza la descripción ausente a null.
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
 * Proyecta el catálogo completo de modalidades.
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
