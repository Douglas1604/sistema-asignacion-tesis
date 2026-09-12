/**
 * @fileoverview Tipos del contrato con la API.
 *
 * Reflejan exactamente lo que devuelve el backend bajo /api/v1. Ninguno de
 * estos tipos incluye contraseñas ni hashes: esos campos no salen del servidor
 * y no deben existir en el cliente.
 */

/** Envoltura de éxito de la API. */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: MetaPaginacion;
}

/** Metadatos de paginación. */
export interface MetaPaginacion {
  total: number;
  pagina: number;
  limite: number;
}

/** Detalle de un fallo de validación, campo a campo. */
export interface DetalleValidacion {
  campo: string;
  mensaje: string;
}

/** Envoltura de error de la API. */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: DetalleValidacion[];
    requestId?: string;
  };
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

/**
 * Credenciales de inicio de sesión.
 * El campo es `password`, no `password_hash`: el cliente envía la contraseña
 * en claro sobre el canal y es el servidor quien la verifica contra bcrypt.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Usuario autenticado, tal y como lo expone la API. */
export interface Usuario {
  id: number;
  username?: string;
  email: string;
  rol_id?: number;
  rol?: string | null;
  creado_en?: string | null;
}

/** Carga útil devuelta por el login. */
export interface LoginData {
  token: string;
  expiresIn: string;
  user: Usuario;
}

/**
 * Identidad mínima que el cliente conserva entre recargas.
 * Se guarda solo lo que la interfaz necesita mostrar; el resto del perfil se
 * vuelve a pedir a /auth/me cuando hace falta.
 */
export interface SesionLocal {
  id: number;
  email: string;
  rol: string | null;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/** Modalidad de evento (Privado, Seminario, Tesis). */
export interface TipoEvento {
  id: number;
  nombre: string;
  descripcion?: string | null;
}

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

/** Alumno enviado al registrar una asignación. */
export interface AlumnoAsignacion {
  carnet: string;
  nombre_completo: string;
}

/** Catedrático enviado al registrar un jurado de tesis. */
export interface ProfesorAsignacion {
  nombre_completo: string;
}

/** Cuerpo para registrar una terna de privado o seminario. */
export interface CrearAsignacionTernaRequest {
  es_tesis: false;
  profesor_nombre: string;
  alumnos: AlumnoAsignacion[];
  tipo_evento_id: number;
}

/** Cuerpo para registrar un jurado de tesis. */
export interface CrearAsignacionTesisRequest {
  es_tesis: true;
  alumno: AlumnoAsignacion;
  profesores: ProfesorAsignacion[];
  tipo_evento_id: number;
}

/** Resultado del registro de una asignación. */
export interface CrearAsignacionData {
  registros: number;
  tipo_evento_id: number;
  modo: 'tesis' | 'terna';
}

/** Fila del historial, en el formato que consumen los reportes. */
export interface AsignacionReporte {
  modalidad: string;
  profesor_nombre: string;
  alumno_info: string;
  fecha: string;
}

/** Resultado de una operación de borrado. */
export interface BorradoData {
  eliminados: number;
}
