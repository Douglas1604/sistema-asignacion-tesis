/**
 * @fileoverview Servicio HTTP del módulo de asignaciones.
 *
 * Es el ÚNICO punto que conoce las rutas de este recurso. Los componentes no
 * inyectan HttpClient: piden datos aquí. Así la URL base, el formato de la
 * envoltura y el manejo de errores se cambian en un solo sitio.
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  ApiResponse,
  AsignacionReporte,
  AlumnoAsignacion,
  BorradoData,
  CrearAsignacionData,
  CrearAsignacionTernaRequest,
  CrearAsignacionTesisRequest,
  TipoEvento,
} from '../models/api';

@Injectable({
  // 'root' hace que este servicio esté disponible en toda la aplicación
  // sin necesidad de declararlo en cada módulo individualmente.
  providedIn: 'root',
})
export class AsignacionService {
  private readonly apiUrl = `${environment.apiUrl}/asignaciones`;
  private readonly tiposEventoUrl = `${environment.apiUrl}/tipos-evento`;

  constructor(private http: HttpClient) {}

  /**
   * @description Envía al servidor los datos de una terna de Privado o Seminario.
   * La estructura es de 1 a N (Un catedrático y un grupo de alumnos).
   * @param profesor_nombre El nombre (y/o grupo) del catedrático seleccionado.
   * @param alumnos Arreglo con los alumnos que fueron sorteados para este catedrático.
   * @param tipo_evento_id El ID de la modalidad (1 = Privado, 2 = Seminario).
   * @returns Observable con el resumen `{registros, tipo_evento_id, modo}`.
   * @throws {HttpErrorResponse} Emitido por el Observable ante 401, 403 o 422.
   */
  guardarTerna(
    profesor_nombre: string,
    alumnos: { carnet: string; nombre_completo: string }[],
    tipo_evento_id: number,
  ): Observable<CrearAsignacionData> {
    // La bandera 'es_tesis: false' indica al backend cómo estructurar el INSERT.
    const cuerpo: CrearAsignacionTernaRequest = {
      es_tesis: false,
      profesor_nombre,
      // Enviamos solo los campos del contrato: los índices auxiliares de la
      // ruleta y las columnas sobrantes del Excel no viajan al servidor.
      alumnos: alumnos.map(this.aAlumnoAsignacion),
      tipo_evento_id,
    };

    return this.http
      .post<ApiResponse<CrearAsignacionData>>(this.apiUrl, cuerpo)
      .pipe(map((respuesta) => respuesta.data));
  }

  /**
   * @description Envía al servidor los datos de un jurado de Tesis.
   * La estructura es invertida: 3 a 1 (Tres catedráticos evaluando a un solo alumno).
   * @param alumno El estudiante que defenderá su tesis.
   * @param profesores Arreglo con los 3 catedráticos (Presidente, Vocal 1, Vocal 2).
   * @param tipo_evento_id El ID de la modalidad (3 = Tesis).
   * @returns Observable con el resumen `{registros: 3, tipo_evento_id, modo: 'tesis'}`.
   * @throws {HttpErrorResponse} Emitido por el Observable ante 401, 403 o 422.
   */
  guardarTesis(
    alumno: { carnet: string; nombre_completo: string },
    profesores: { nombre_completo: string }[],
    tipo_evento_id: number,
  ): Observable<CrearAsignacionData> {
    // La bandera 'es_tesis: true' activa la lógica de roles (Presidente, Vocales).
    const cuerpo: CrearAsignacionTesisRequest = {
      es_tesis: true,
      alumno: this.aAlumnoAsignacion(alumno),
      profesores: profesores.map((p) => ({ nombre_completo: p.nombre_completo })),
      tipo_evento_id,
    };

    return this.http
      .post<ApiResponse<CrearAsignacionData>>(this.apiUrl, cuerpo)
      .pipe(map((respuesta) => respuesta.data));
  }

  /**
   * @description Pide al servidor todo el historial de asignaciones guardadas.
   * Desenvuelve el campo `data` para que los componentes reciban un arreglo plano.
   * @returns Observable con las filas del historial (hasta el límite por defecto del backend).
   */
  obtenerAsignaciones(): Observable<AsignacionReporte[]> {
    return this.http
      .get<ApiResponse<AsignacionReporte[]>>(this.apiUrl)
      .pipe(map((respuesta) => respuesta.data));
  }

  /**
   * @description Elimina un lote completo de asignaciones por su marca de tiempo.
   * @param fecha Fecha del lote en formato dd/mm/aaaa hh:mm.
   * @returns Observable con el número de filas eliminadas.
   *
   * `encodeURIComponent` es imprescindible: la fecha contiene '/', ':' y un
   * espacio, caracteres con significado estructural en una URL.
   */
  eliminarLote(fecha: string): Observable<BorradoData> {
    const url = `${this.apiUrl}/lote?fecha=${encodeURIComponent(fecha)}`;
    return this.http
      .delete<ApiResponse<BorradoData>>(url)
      .pipe(map((respuesta) => respuesta.data));
  }

  /**
   * @description Elimina la asignación de un alumno dentro de un sorteo concreto.
   * @param carnet Carnet del estudiante.
   * @param fecha Fecha del sorteo en formato dd/mm/aaaa hh:mm.
   * @returns Observable con el número de filas eliminadas.
   */
  eliminarAsignacionAlumno(carnet: string, fecha: string): Observable<BorradoData> {
    const url =
      `${this.apiUrl}/alumno/${encodeURIComponent(carnet)}/${encodeURIComponent(fecha)}`;
    return this.http
      .delete<ApiResponse<BorradoData>>(url)
      .pipe(map((respuesta) => respuesta.data));
  }

  /**
   * @description Obtiene el catálogo de modalidades de evento.
   * @returns Observable con la lista de modalidades disponibles.
   */
  obtenerTiposEvento(): Observable<TipoEvento[]> {
    return this.http
      .get<ApiResponse<TipoEvento[]>>(this.tiposEventoUrl)
      .pipe(map((respuesta) => respuesta.data));
  }

  /**
   * Reduce un alumno del sorteo a los campos que acepta la API.
   * @param alumno Alumno tal y como lo maneja la ruleta.
   * @returns Objeto con solo `carnet` y `nombre_completo`; el backend rechazaría
   *          (por `.strict()`) campos no declarados en el contrato.
   */
  private aAlumnoAsignacion(alumno: {
    carnet: string;
    nombre_completo: string;
  }): AlumnoAsignacion {
    return { carnet: alumno.carnet, nombre_completo: alumno.nombre_completo };
  }
}
