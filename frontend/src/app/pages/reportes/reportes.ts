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

/**
 * Lote de sorteo ya agrupado, tal y como lo consume la tabla de actas.
 * Antes era `any`, lo que ocultó que la pantalla usaba la fecha como si
 * fuera el identificador del lote.
 */
interface LoteReporte {
  /** UUID del guardado. Vacío solo en históricos previos a la migración. */
  lote_id: string;
  modalidad: string;
  fecha_formateada: string;
  profesores: Set<string>;
  alumnos: Set<string>;
}

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
  sorteosAgrupados: LoteReporte[] = [];

  /** Petición de listado en curso; evita mostrar "no hay actas" mientras carga. */
  cargando = false;

  /** Lote cuyo borrado está en curso; bloquea el botón para no repetirlo. */
  eliminandoLoteId: string | null = null;

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
    this.cargando = true;

    this.asignacionService.obtenerAsignaciones().subscribe({
      next: (data: AsignacionReporte[]) => { 
        // Usamos la estructura de datos Map para agrupar eficientemente por lote
        const gruposMap = new Map<string, LoteReporte>();

        (data || []).forEach(row => {
          // Filtro de integridad: Ignoramos registros con "undefined" generados por filas vacías en Excel
          if (row.alumno_info && row.alumno_info.includes('undefined')) return;
          if (row.profesor_nombre && row.profesor_nombre.includes('undefined')) return;

          // La clave del lote es su `lote_id`, no "modalidad + fecha": la fecha
          // solo tiene precisión de minuto, así que dos sorteos guardados en el
          // mismo minuto se mostraban y se borraban como si fueran uno solo.
          // Una fila sin lote procede de un histórico anterior a la migración;
          // se agrupa por el criterio antiguo, pero no se podrá borrar.
          const clave = row.lote_id || `legado:${row.modalidad}_${row.fecha}`;
          
          // Agrupar en un Map es O(n): una sola pasada, con búsqueda por clave en
          // tiempo constante, frente al O(n²) de comparar cada fila con las demás.
          if (!gruposMap.has(clave)) {
            gruposMap.set(clave, {
              lote_id: row.lote_id || '',
              modalidad: row.modalidad,
              fecha_formateada: row.fecha,
              profesores: new Set<string>(),
              alumnos: new Set<string>()
            });
          }
          
          // Agregamos los datos al lote correspondiente
          const g = gruposMap.get(clave)!;
          if (row.profesor_nombre) g.profesores.add(row.profesor_nombre);
          if (row.alumno_info) g.alumnos.add(row.alumno_info);
        });

        // Convertimos el Map a un Array tradicional para que el *ngFor de Angular pueda iterarlo
        this.sorteosAgrupados = Array.from(gruposMap.values());
        this.cargando = false;
        
        // Forzamos la detección de cambios para actualizar la vista inmediatamente
        this.cdr.detectChanges(); 
      },
      error: (err) => {
        this.cargando = false;
        // Sin esto la pantalla se quedaba con el listado anterior y sin aviso
        // de que la recarga había fallado.
        Swal.fire('Error', mensajeParaUsuario(interpretarError(err)), 'error');
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * @description Genera y descarga un archivo Excel (.xlsx) estructurado en "cascada" 
   * para un lote de sorteo específico, alineando profesores y alumnos en columnas.
   * @param grupo Objeto que contiene los datos del lote a exportar.
   */
  exportarSorteoBatch(grupo: LoteReporte) {
    // Convertimos los Sets a Arrays para poder iterarlos por índice
    const profesArr = Array.from(grupo.profesores);
    const alumnosArr = Array.from(grupo.alumnos);
    
    // Determinamos cuál de las dos listas es más larga para saber cuántas filas tendrá el Excel
    const maxRows = Math.max(profesArr.length, alumnosArr.length);

    // Un lote sin ninguna fila asociada generaba un libro con la hoja vacía,
    // que Excel abre como archivo dañado. Mejor avisar y no descargar nada.
    if (maxRows === 0) {
      Swal.fire('Acta vacía', 'Este lote no tiene registros que exportar.', 'info');
      return;
    }
    
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
    
    // Sanitizamos la fecha para evitar errores en sistemas operativos por
    // caracteres inválidos en el nombre. `|| ''` cubre el lote sin fecha:
    // `replace` sobre undefined lanzaría y la descarga no llegaría a ocurrir.
    const fechaLimpia = (grupo.fecha_formateada || 'sin-fecha').replace(/[\/\:\s]/g, '-');
    
    // Desencadenamos la descarga del archivo en el navegador del usuario
    XLSX.writeFile(workbook, `Reporte_${grupo.modalidad}_${fechaLimpia}.xlsx`);
  }

  /**
   * @description Anula un lote completo de asignaciones identificándolo por su
   * `lote_id`. Antes se enviaba `fecha_formateada` a una ruta que espera un
   * UUID (y con el patrón `?fecha=`, que no existe en la API): la petición
   * devolvía 404 y el botón rojo parecía no responder.
   * @param grupo Lote seleccionado en la tabla.
   */
  eliminarSorteoBatch(grupo: LoteReporte) {
    // Un histórico anterior a la migración de lotes no tiene UUID: sin él la
    // API no puede identificar qué borrar, así que se avisa en vez de lanzar
    // una petición que devolvería 422.
    if (!grupo.lote_id) {
      Swal.fire(
        'No se puede eliminar',
        'Este registro es anterior al control por lotes y no puede eliminarse desde aquí.',
        'info'
      );
      return;
    }

    // Semáforo: sin él, dos clics seguidos lanzan dos borrados y el segundo
    // responde 404 sobre un lote que ya no existe.
    if (this.eliminandoLoteId) return;

    Swal.fire({
      title: '¿Estás seguro?',
      text: `Se anulará el lote de ${grupo.modalidad} del ${grupo.fecha_formateada} y dejará de aparecer en las actas.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (!result.isConfirmed) return;

      this.eliminandoLoteId = grupo.lote_id;
      this.cdr.detectChanges();

      // El servicio arma la URL `DELETE /asignaciones/lote/{lote_id}` y el
      // interceptor adjunta el token. El backend aplica borrado LÓGICO
      // (active = 0), que ninguna clave foránea puede rechazar.
      this.asignacionService.eliminarLote(grupo.lote_id).subscribe({
        next: () => {
          this.eliminandoLoteId = null;
          Swal.fire('Eliminado', 'El lote ha sido eliminado de forma exitosa.', 'success');
          // Recargamos el listado para reflejar los cambios en la interfaz sin necesidad de recargar la página
          this.cargarDatos(); 
        },
        error: (err) => {
          this.eliminandoLoteId = null;
          // Mensaje centralizado: nunca se muestra el error crudo del servidor.
          Swal.fire('Error', mensajeParaUsuario(interpretarError(err)), 'error');
          this.cdr.detectChanges();
        }
      });
    });
  }
}