/**
 * @fileoverview Controlador de la pantalla principal (Dashboard).
 * Aquí mostramos un resumen estadístico de las asignaciones y el historial reciente.
 * Sirve como la página de bienvenida tras iniciar sesión, dando un panorama rápido del sistema.
 */

import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { AsignacionReporte } from '../../models/api';
import { interpretarError, mensajeParaUsuario } from '../../core/api-error';
import { AsignacionService } from '../../services/asignacion';
import Swal from 'sweetalert2';

/**
 * Fila del historial tal y como la pinta la tabla del dashboard.
 *
 * @description La API devuelve una fila por cada pareja catedrático-alumno y
 * con los campos `alumno_info` ("carnet - nombre") y `fecha`. La plantilla
 * leía en cambio `alumno_carnet`, `alumno_nombre` y `fecha_formateada`, que no
 * existen en la respuesta: la tabla salía vacía y el botón de borrar enviaba
 * `undefined`. Esta proyección traduce el contrato de la API a lo que la vista
 * necesita y agrupa las tres filas de un tesista en una sola.
 */
interface FilaHistorial {
  lote_id: string;
  modalidad: string;
  alumno_carnet: string;
  alumno_nombre: string;
  profesores: string;
  fecha_formateada: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
/**
 * Pantalla de inicio posterior al login: métricas agregadas del historial y
 * borrado puntual de asignaciones individuales.
 */
export class DashboardComponent implements OnInit {
  // Variables para guardar las métricas que se muestran en las tarjetas superiores
  totalSorteos = 0; 
  totalTesis = 0; 
  totalPrivados = 0;
  
  // Lista para cargar la tabla del historial en pantalla
  ultimosSorteos: FilaHistorial[] = [];

  /** Alumno cuyo borrado está en curso; evita repetir la petición. */
  eliminandoClave: string | null = null;

  constructor(private asignacionService: AsignacionService, private cdr: ChangeDetectorRef, private authService: AuthService, private router: Router) {}

  /**
   * Se ejecuta en cuanto el componente carga en pantalla.
   * Su única tarea es disparar la consulta de datos al backend para refrescar la vista.
   */
  ngOnInit() { 
    this.cargarDatos(); 
  }

  /**
   * @description Trae todo el historial de la base de datos y calcula las estadísticas.
   * Separa los conteos filtrando por la modalidad (Tesis vs Privados/Seminarios)
   * para pintar las métricas en las tarjetas del dashboard.
   */
  cargarDatos() {
    this.asignacionService.obtenerAsignaciones().subscribe({
      next: (data) => {
        const filas = data || [];

        // Una asignación de tesis ocupa TRES filas (una por miembro del
        // jurado), así que contar filas multiplicaba por tres los tesistas.
        // Se agrupa por (lote, alumno) para que cada alumno cuente una vez.
        const porAlumno = new Map<string, FilaHistorial>();

        for (const fila of filas) {
          if (!fila.alumno_info) continue;

          // `alumno_info` llega como "carnet - nombre"; se parte en el primer
          // separador para no romper nombres que contengan guiones.
          const separador = fila.alumno_info.indexOf(' - ');
          const carnet = separador === -1
            ? fila.alumno_info.trim()
            : fila.alumno_info.slice(0, separador).trim();
          const nombre = separador === -1
            ? ''
            : fila.alumno_info.slice(separador + 3).trim();

          const clave = `${fila.lote_id || fila.fecha}|${carnet}`;
          const existente = porAlumno.get(clave);

          if (existente) {
            // Acumula los miembros del jurado en una sola celda.
            existente.profesores = existente.profesores
              ? `${existente.profesores}, ${fila.profesor_nombre}`
              : fila.profesor_nombre;
            continue;
          }

          porAlumno.set(clave, {
            lote_id: fila.lote_id || '',
            modalidad: fila.modalidad,
            alumno_carnet: carnet,
            alumno_nombre: nombre,
            profesores: fila.profesor_nombre || '',
            fecha_formateada: fila.fecha,
          });
        }

        this.ultimosSorteos = Array.from(porAlumno.values());

        // Los totales se calculan sobre asignaciones, no sobre filas de la BD.
        this.totalSorteos = this.ultimosSorteos.length;
        this.totalTesis = this.ultimosSorteos.filter(d => d.modalidad === 'Tesis').length;
        this.totalPrivados = this.ultimosSorteos.filter(d => d.modalidad !== 'Tesis').length;
        
        // Forzamos a Angular a actualizar la pantalla con los nuevos números
        this.cdr.detectChanges();
      },
      error: (err) => {
        Swal.fire("Error", mensajeParaUsuario(interpretarError(err)), "error");
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * @description Permite borrar un registro individual directamente desde la tabla de inicio.
   * Útil si el usuario administrador nota un error puntual en la vista rápida.
   *
   * La API identifica la asignación por LOTE y carnet
   * (`DELETE /asignaciones/lote/{lote_id}/alumno/{carnet}`). Antes se le
   * pasaba la fecha como si fuera la clave, sobre una ruta inexistente.
   *
   * @param fila Fila del historial seleccionada en la tabla.
   */
  eliminarSorteo(fila: FilaHistorial) {
    if (!fila.lote_id) {
      Swal.fire(
        'No se puede eliminar',
        'Este registro es anterior al control por lotes y no puede eliminarse desde aquí.',
        'info'
      );
      return;
    }

    if (this.eliminandoClave) return;
    const clave = `${fila.lote_id}|${fila.alumno_carnet}`;

    Swal.fire({ 
      title: '¿Eliminar sorteo?', 
      text: "Se borrará la asignación de este alumno.", 
      icon: 'warning', 
      showCancelButton: true, 
      confirmButtonColor: '#CC0000', 
      confirmButtonText: 'Sí, borrar' 
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.eliminandoClave = clave;
      this.cdr.detectChanges();

      // Mandamos a borrar al backend; el servicio arma la URL y adjunta el token
      this.asignacionService.eliminarAsignacionAlumno(fila.lote_id, fila.alumno_carnet).subscribe({
        next: () => {
          this.eliminandoClave = null;
          // Recargamos los datos para que el registro desaparezca de la tabla
          this.cargarDatos();
          Swal.fire('Eliminado', 'Sorteo borrado exitosamente.', 'success');
        },
        error: (err) => {
          this.eliminandoClave = null;
          Swal.fire('Error', mensajeParaUsuario(interpretarError(err)), 'error');
          this.cdr.detectChanges();
        }
      });
    });
  }

  /**
   * Cierra la sesión: borra el token y la identidad guardados en el navegador
   * y devuelve al login. Antes el enlace solo navegaba, dejando la sesión viva.
   * @param evento Clic del enlace, para evitar la navegación por defecto.
   */
  cerrarSesion(evento: Event) {
    evento.preventDefault();
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}