/**
 * @fileoverview Controlador del módulo de Reportes y Actas Oficiales.
 * Este archivo se encarga de obtener el historial de sorteos desde el backend, 
 * limpiar datos corruptos, agrupar las asignaciones por lotes (fecha y modalidad) 
 * y generar los archivos Excel en formato de "cascada" para las actas oficiales.
 */

import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { AsignacionReporte } from '../../models/api';
import { interpretarError, mensajeParaUsuario } from '../../core/api-error';
import { AsignacionService } from '../../services/asignacion';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule], 
  templateUrl: './reportes.html',
  styleUrl: './reportes.css'
})
/**
 * Pantalla de reportes: transforma el historial plano de la API (una fila por
 * pareja catedrático-alumno) en lotes agrupados y exportables como acta.
 */
export class ReportesComponent implements OnInit {
  // Arreglo principal que alimenta la tabla de la vista con los lotes de sorteo ya agrupados
  sorteosAgrupados: any[] = []; 

  constructor(
    private asignacionService: AsignacionService,
    private cdr: ChangeDetectorRef,
    private authService: AuthService,
    private router: Router
  ) {}

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
  
  /**
   * Se ejecuta al inicializar el componente.
   * Llama a la función principal para poblar la tabla de reportes inmediatamente.
   */
  ngOnInit() { 
    this.cargarDatos(); 
  }

  /**
   * @description Obtiene el listado plano de asignaciones desde el servicio y lo transforma 
   * en una estructura agrupada por lotes (basado en la modalidad y fecha exacta del sorteo).
   * Implementa un filtro de limpieza para ignorar registros residuales ("undefined").
   */
  cargarDatos() {
    this.asignacionService.obtenerAsignaciones().subscribe({
      next: (data: AsignacionReporte[]) => { 
        // Usamos la estructura de datos Map para agrupar eficientemente usando una clave compuesta
        const gruposMap = new Map();

        data.forEach(row => {
          // Filtro de integridad: Ignoramos registros con "undefined" generados por filas vacías en Excel
          if (row.alumno_info && row.alumno_info.includes('undefined')) return;
          if (row.profesor_nombre && row.profesor_nombre.includes('undefined')) return;

          // Clave única para identificar a qué lote de sorteo pertenece esta fila.
          // Agrupar en un Map es O(n): una sola pasada, con búsqueda por clave en
          // tiempo constante, frente al O(n²) de comparar cada fila con las demás.
          const clave = `${row.modalidad}_${row.fecha}`;
          
          // Si el lote no existe en el Map, lo inicializamos con Sets para evitar duplicados
          if (!gruposMap.has(clave)) {
            gruposMap.set(clave, {
              modalidad: row.modalidad,
              fecha_formateada: row.fecha,
              profesores: new Set(),
              alumnos: new Set()
            });
          }
          
          // Agregamos los datos al lote correspondiente
          const g = gruposMap.get(clave);
          if (row.profesor_nombre) g.profesores.add(row.profesor_nombre);
          if (row.alumno_info) g.alumnos.add(row.alumno_info);
        });

        // Convertimos el Map a un Array tradicional para que el *ngFor de Angular pueda iterarlo
        this.sorteosAgrupados = Array.from(gruposMap.values());
        
        // Forzamos la detección de cambios para actualizar la vista inmediatamente
        this.cdr.detectChanges(); 
      },
      error: (err) => Swal.fire('Error', mensajeParaUsuario(interpretarError(err)), 'error')
    });
  }

  /**
   * @description Genera y descarga un archivo Excel (.xlsx) estructurado en "cascada" 
   * para un lote de sorteo específico, alineando profesores y alumnos en columnas.
   * @param grupo Objeto que contiene los datos del lote a exportar.
   */
  exportarSorteoBatch(grupo: any) {
    // Convertimos los Sets a Arrays para poder iterarlos por índice
    const profesArr = Array.from(grupo.profesores) as string[];
    const alumnosArr = Array.from(grupo.alumnos) as string[];
    
    // Determinamos cuál de las dos listas es más larga para saber cuántas filas tendrá el Excel
    const maxRows = Math.max(profesArr.length, alumnosArr.length);
    
    let datosExportar: any[] = [];

    // Llenado dinámico de las filas del Excel para crear el efecto "cascada"
    for (let i = 0; i < maxRows; i++) {
      datosExportar.push({
        'Modalidad': i === 0 ? grupo.modalidad : '', // Solo mostramos la modalidad en la primera fila
        'Catedrático': profesArr[i] || '',
        'Alumno': alumnosArr[i] || '',
        'Fecha Sorteo': i === 0 ? grupo.fecha_formateada : '' // Solo mostramos la fecha en la primera fila
      });
    }

    // Inicializamos la hoja de cálculo usando la librería SheetJS (XLSX)
    const worksheet = XLSX.utils.json_to_sheet(datosExportar);
    const workbook = { Sheets: { 'Acta Oficial': worksheet }, SheetNames: ['Acta Oficial'] };
    
    // Sanitizamos la fecha para evitar errores en sistemas operativos por caracteres inválidos en el nombre
    const fechaLimpia = grupo.fecha_formateada.replace(/[\/\:\s]/g, '-');
    
    // Desencadenamos la descarga del archivo en el navegador del usuario
    XLSX.writeFile(workbook, `Reporte_${grupo.modalidad}_${fechaLimpia}.xlsx`);
  }

  /**
   * @description Elimina permanentemente un lote completo de asignaciones de la base de datos 
   * utilizando su marca de tiempo (fecha_formateada) como identificador.
   * @param grupo Objeto que representa el lote seleccionado en la tabla.
   */
  eliminarSorteoBatch(grupo: any) {
    Swal.fire({
      title: '¿Estás seguro?',
      text: `Se eliminará permanentemente el lote de ${grupo.modalidad} del ${grupo.fecha_formateada}.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        // El servicio arma la URL, codifica la fecha y adjunta el token.
        this.asignacionService.eliminarLote(grupo.fecha_formateada).subscribe({
          next: () => {
            Swal.fire('Eliminado', 'El lote ha sido eliminado de forma exitosa.', 'success');
            // Recargamos el listado para reflejar los cambios en la interfaz sin necesidad de recargar la página
            this.cargarDatos(); 
          },
          error: (err) => {
            // Mensaje centralizado: nunca se muestra el error crudo del servidor.
            Swal.fire('Error', mensajeParaUsuario(interpretarError(err)), 'error');
          }
        });
      }
    });
  }
}