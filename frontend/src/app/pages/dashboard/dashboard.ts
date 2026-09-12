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

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
  // Variables para guardar las métricas que se muestran en las tarjetas superiores
  totalSorteos = 0; 
  totalTesis = 0; 
  totalPrivados = 0;
  
  // Lista para cargar la tabla del historial en pantalla
  ultimosSorteos: any[] = [];

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
        // Calculamos los totales usando el tamaño del arreglo y la función filter de JavaScript
        this.totalSorteos = data.length;
        this.totalTesis = data.filter(d => d.modalidad === 'Tesis').length;
        this.totalPrivados = data.filter(d => d.modalidad !== 'Tesis').length;
        
        // Llenamos la tabla inferior con todos los registros
        this.ultimosSorteos = data; 
        
        // Forzamos a Angular a actualizar la pantalla con los nuevos números
        this.cdr.detectChanges();
      },
      error: (err) => Swal.fire("Error", mensajeParaUsuario(interpretarError(err)), "error")
    });
  }

  /**
   * @description Permite borrar un registro individual directamente desde la tabla de inicio.
   * Útil si el usuario administrador nota un error puntual en la vista rápida.
   * @param carnet El carnet del estudiante a eliminar.
   * @param fecha La fecha exacta en la que se realizó su sorteo (usada como llave compuesta).
   */
  eliminarSorteo(carnet: string, fecha: string) {
    Swal.fire({ 
      title: '¿Eliminar sorteo?', 
      text: "Se borrará la asignación de este alumno.", 
      icon: 'warning', 
      showCancelButton: true, 
      confirmButtonColor: '#CC0000', 
      confirmButtonText: 'Sí, borrar' 
    }).then((result) => {
      if (result.isConfirmed) {
        // Mandamos a borrar al backend; el servicio arma la URL y adjunta el token
        this.asignacionService.eliminarAsignacionAlumno(carnet, fecha).subscribe({
          next: () => {
            // Recargamos los datos para que el registro desaparezca de la tabla
            this.cargarDatos();
            Swal.fire('Eliminado', 'Sorteo borrado exitosamente.', 'success');
          },
          error: (err) => Swal.fire('Error', mensajeParaUsuario(interpretarError(err)), 'error')
        });
      }
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