/**
 * @fileoverview Traducción centralizada de errores HTTP a mensajes de usuario.
 *
 * Motivo: sin esto, cada componente inventa su propio texto y acaba mostrando
 * el error crudo del servidor. Aquí se decide una vez qué ve el usuario,
 * y se garantiza que nunca se le enseñe un detalle interno.
 */

import { HttpErrorResponse } from '@angular/common/http';

import { ApiErrorResponse, DetalleValidacion } from '../models/api';

/** Error de la API ya interpretado y listo para mostrar. */
export interface ErrorApi {
  /** Código HTTP (0 si no hubo respuesta). */
  status: number;
  /** Código de negocio estable devuelto por el backend. */
  codigo: string;
  /** Mensaje apto para mostrar al usuario. */
  mensaje: string;
  /** Errores de validación por campo, si los hay. */
  detalles?: DetalleValidacion[];
  /** Identificador de la petición, útil para soporte. */
  requestId?: string;
}

/** Mensajes por defecto según el código HTTP. */
const MENSAJES_POR_ESTADO: Record<number, string> = {
  0: 'No se pudo conectar con el servidor. Revisa tu conexión.',
  400: 'La solicitud no es válida.',
  401: 'Tu sesión no es válida o ha expirado. Inicia sesión de nuevo.',
  403: 'No tienes permisos para realizar esta acción.',
  404: 'No se encontró el recurso solicitado.',
  409: 'El registro ya existe.',
  413: 'El archivo o los datos enviados son demasiado grandes.',
  422: 'Algunos datos no son válidos.',
  429: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.',
  500: 'Ocurrió un error en el servidor. Inténtalo más tarde.',
  503: 'El servicio no está disponible en este momento.',
};

/**
 * Indica si el cuerpo recibido tiene la forma de error de nuestra API.
 * @param cuerpo Cuerpo de la respuesta de error.
 */
// Guarda de tipo (type guard) de TypeScript: el retorno `cuerpo is ApiErrorResponse`
// hace que, dentro del `if` que la invoca, el compilador trate `cuerpo` con ese
// tipo, sin recurrir a conversiones forzadas.
function esErrorDeLaApi(cuerpo: unknown): cuerpo is ApiErrorResponse {
  return (
    typeof cuerpo === 'object' &&
    cuerpo !== null &&
    'error' in cuerpo &&
    typeof (cuerpo as ApiErrorResponse).error?.message === 'string'
  );
}

/**
 * Convierte cualquier error HTTP en un `ErrorApi` con mensaje presentable.
 *
 * Prioriza el mensaje del backend, que ya está redactado para el cliente y no
 * contiene SQL ni trazas. Si no hay cuerpo reconocible, recurre al mensaje
 * genérico del código de estado, nunca al texto crudo de la excepción.
 *
 * @param error Error emitido por HttpClient.
 * @returns Error interpretado.
 */
export function interpretarError(error: unknown): ErrorApi {
  if (error instanceof HttpErrorResponse) {
    const cuerpo = error.error;

    if (esErrorDeLaApi(cuerpo)) {
      return {
        status: error.status,
        codigo: cuerpo.error.code,
        mensaje: cuerpo.error.message,
        detalles: cuerpo.error.details,
        requestId: cuerpo.error.requestId,
      };
    }

    return {
      status: error.status,
      codigo: 'HTTP_ERROR',
      mensaje:
        MENSAJES_POR_ESTADO[error.status] ?? 'Ocurrió un error inesperado.',
    };
  }

  return {
    status: 0,
    codigo: 'UNKNOWN',
    mensaje: 'Ocurrió un error inesperado.',
  };
}

/**
 * Construye el texto a mostrar, añadiendo el detalle de validación si existe.
 * Devuelve TEXTO PLANO: los diálogos lo pintan con `text:`, nunca con `html:`.
 *
 * @param error Error ya interpretado.
 * @returns Mensaje completo para el usuario.
 */
export function mensajeParaUsuario(error: ErrorApi): string {
  if (!error.detalles || error.detalles.length === 0) {
    return error.mensaje;
  }

  const lineas = error.detalles.map((detalle) => `• ${detalle.mensaje}`);
  return [error.mensaje, ...lineas].join('\n');
}
