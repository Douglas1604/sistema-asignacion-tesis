/**
 * @fileoverview Transformación de filas de `usuarios` a objetos de salida.
 * Construimos el DTO enumerando campos uno por uno (lista blanca). Así, si
 * mañana la tabla gana una columna sensible, no se filtra sola a la respuesta.
 */

/**
 * @param {object} fila Fila devuelta por el repositorio.
 * @returns {{id: number, username: string, email: string, rol: string, rol_id: number, creado_en: string}}
 */
function aUsuarioDTO(fila) {
  return {
    id: fila.id,
    username: fila.username,
    email: fila.email,
    rol_id: fila.rol_id,
    rol: fila.rol_nombre || null,
    creado_en: fila.creado_en || null,
  };
}

/**
 * @param {object[]} filas Filas devueltas por el repositorio.
 * @returns {object[]} Lista de DTOs.
 */
function aListaUsuariosDTO(filas) {
  return filas.map(aUsuarioDTO);
}

module.exports = { aUsuarioDTO, aListaUsuariosDTO };
