/**
 * @fileoverview Servicio HTTP del módulo de asignaciones.
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
  providedIn: 'root',
})
export class AsignacionService {
  private readonly apiUrl = `${environment.apiUrl}/asignaciones`;
  private readonly tiposEventoUrl = `${environment.apiUrl}/tipos-evento`;

  constructor(private http: HttpClient) {}

  /** Envía los datos de una terna de Privado o Seminario (1 a N). */
  guardarTerna(
    profesor_nombre: string,
    alumnos: { carnet: string; nombre_completo: string }[],
    tipo_evento_id: number,
  ): Observable<CrearAsignacionData> {
    const cuerpo: CrearAsignacionTernaRequest = {
      es_tesis: false,
      profesor_nombre,
      alumnos: alumnos.map(this.aAlumnoAsignacion),
      tipo_evento_id,
    };

    return this.http
      .post<ApiResponse<CrearAsignacionData>>(this.apiUrl, cuerpo)
      .pipe(map((respuesta) => respuesta.data));
  }

  /** Envía los datos de un jurado de Tesis individual (3 a 1). */
  guardarTesis(
    alumno: { carnet: string; nombre_completo: string },
    profesores: { nombre_completo: string }[],
    tipo_evento_id: number,
  ): Observable<CrearAsignacionData> {
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
   * Envía al servidor una terna de tesis completa de forma atómica (Issue #7).
   * Inserta los 3 catedráticos y todos los alumnos asignados en una única transacción SQL.
   */
  guardarTernaTesis(
    profesores: { nombre_completo: string }[],
    alumnos: { carnet: string; nombre_completo: string }[],
    tipo_evento_id: number,
  ): Observable<CrearAsignacionData> {
    const cuerpo = {
      profesores: profesores.map((p) => ({ nombre_completo: p.nombre_completo })),
      alumnos: alumnos.map((a) => ({
        carnet: String(a.carnet).trim(),
        nombre_completo: a.nombre_completo,
      })),
      tipo_evento_id: Number(tipo_evento_id),
    };

    return this.http
      .post<ApiResponse<CrearAsignacionData>>(`${this.apiUrl}/terna`, cuerpo)
      .pipe(map((respuesta) => respuesta.data));
  }

  obtenerAsignaciones(): Observable<AsignacionReporte[]> {
    return this.http
      .get<ApiResponse<AsignacionReporte[]>>(this.apiUrl)
      .pipe(map((respuesta) => respuesta.data));
  }

  eliminarLote(fecha: string): Observable<BorradoData> {
    const url = `${this.apiUrl}/lote?fecha=${encodeURIComponent(fecha)}`;
    return this.http
      .delete<ApiResponse<BorradoData>>(url)
      .pipe(map((respuesta) => respuesta.data));
  }

  eliminarAsignacionAlumno(carnet: string, fecha: string): Observable<BorradoData> {
    const url = `${this.apiUrl}/alumno/${encodeURIComponent(carnet)}/${encodeURIComponent(fecha)}`;
    return this.http
      .delete<ApiResponse<BorradoData>>(url)
      .pipe(map((respuesta) => respuesta.data));
  }

  obtenerTiposEvento(): Observable<TipoEvento[]> {
    return this.http
      .get<ApiResponse<TipoEvento[]>>(this.tiposEventoUrl)
      .pipe(map((respuesta) => respuesta.data));
  }

  private aAlumnoAsignacion(alumno: {
    carnet: string;
    nombre_completo: string;
  }): AlumnoAsignacion {
    return { carnet: alumno.carnet, nombre_completo: alumno.nombre_completo };
  }
}