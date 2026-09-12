/**
 * @fileoverview Reglas de negocio del módulo de usuarios.
 */

const UsuariosRepository = require("../repositories/usuarios.repository");
const { aListaUsuariosDTO, aUsuarioDTO } = require("../dtos/usuario.dto");
const AppError = require("../utils/AppError");

/** Tope duro de página: evita que un cliente pida la tabla entera de un tirón. */
const LIMITE_MAXIMO = 100;

const UsuariosService = {
  /**
   * Lista usuarios paginados, ya convertidos a DTO (sin password_hash).
   * @param {{limite?: number, pagina?: number}} opciones Parámetros ya validados.
   * @returns {Promise<{items: object[], meta: object}>}
   */
  async listar({ limite = 20, pagina = 1 } = {}) {
    // Mismo patrón de paginación por desplazamiento que el historial de
    // asignaciones, con un tope más bajo por tratarse de datos de cuentas.
    const limiteSeguro = Math.min(limite, LIMITE_MAXIMO);
    const desplazamiento = (pagina - 1) * limiteSeguro;

    const [filas, total] = await Promise.all([
      UsuariosRepository.listar({ limite: limiteSeguro, desplazamiento }),
      UsuariosRepository.contar(),
    ]);

    return {
      items: aListaUsuariosDTO(filas),
      meta: { total, pagina, limite: limiteSeguro },
    };
  },

  /**
   * Obtiene un usuario concreto.
   * @param {number} id Identificador del usuario.
   * @returns {Promise<object>} DTO de usuario.
   * @throws {AppError} 404 si no existe.
   */
  async obtenerPorId(id) {
    const usuario = await UsuariosRepository.buscarPorId(id);
    if (!usuario) {
      throw AppError.notFound("Usuario no encontrado");
    }
    return aUsuarioDTO(usuario);
  },
};

module.exports = UsuariosService;
