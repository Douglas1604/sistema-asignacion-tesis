/**
 * @fileoverview Lógica principal del motor de sorteos y asignaciones académicas.
 * Maneja la lectura de archivos Excel, el cálculo matemático para la distribución 
 * equitativa de alumnos y la animación visual de las ruletas.
 */

import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { FormsModule } from '@angular/forms';
import { AsignacionService } from '../../services/asignacion';
import { interpretarError, mensajeParaUsuario } from '../../core/api-error';
import {
  validarArchivoExcel,
  extraerProfesores,
  extraerAlumnos,
  normalizarCelda,
  MAX_FILAS,
} from '../../core/excel-seguro';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

export interface Profesor { id?: number; nombre_completo: string; area?: string; }
export interface Alumno { id?: number; carnet: string; nombre_completo: string; }

@Component({
  selector: 'app-sorteo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sorteo.html',
  styleUrl: './sorteo.css'
})
export class SorteoComponent implements OnInit {
  configuracionLista: boolean = false;
  tiposEvento: any[] = [
    { id: 1, nombre: 'Examen Privado', descripcion: 'Evaluación por Áreas' },
    { id: 2, nombre: 'Seminario', descripcion: 'Asignación General' },
    { id: 3, nombre: 'Tesis', descripcion: 'Terna Evaluadora' }
  ];
  eventoSeleccionado: any = null;

  coloresRuleta: string[] = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#e83e8c', '#fd7e14', '#20c997', '#6c757d'];
  nombreArchivoProfesores: string = ''; 
  nombreArchivoAlumnos: string = '';

  // =========================================================
  // Metodo 1: PRIVADOS Y SEMINARIO
  // =========================================================
  areaSeleccionada: string = '';
  areasDisponibles: string[] = ['Análisis, Diseño y Desarrollo', 'Administración de Sistemas', 'Ciencias de la Ingeniería'];
  contadoresAreas: { [key: string]: number } = {};

  profesoresBaseNormal: Profesor[] = []; 
  profesoresNormal: Profesor[] = []; 
  alumnosNormal: Alumno[] = [];
  
  cupoBaseNormal: number = 0; 
  sobrantesNormal: number = 0;

  gradosRotacionNormalProfe: number = 0; 
  girandoNormalProfe: boolean = false;
  catedraticoGanadorNormal: Profesor | null = null; 
  cupoActualNormal: number = 0; 
  alumnosAsignadosNormal: Alumno[] = [];   
  
  gradosRotacionNormalAlum: number = 0; 
  girandoNormalAlum: boolean = false;
  alumnoGanadorTemporalNormal: Alumno | null = null; 

  // =========================================================
  // Metodo 2: TESIS
  // =========================================================
  profesoresTesis: Profesor[] = []; 
  alumnosTesis: Alumno[] = []; 
  
  catedraticosTesisAsignados: Profesor[] = []; 
  alumnosTesisAsignados: Alumno[] = []; 
  
  cantidadTernasTesis: number = 0;
  cupoBaseTesis: number = 0; 
  sobrantesTesis: number = 0;
  cupoActualTesis: number = 0;
  matematicaTesisCalculada: boolean = false; 

  gradosRotacionTesisProfe: number = 0; 
  girandoTesisProfe: boolean = false;
  gradosRotacionTesisAlum: number = 0; 
  girandoTesisAlum: boolean = false;
  
  profesorGanadorTemporalTesis: Profesor | null = null;
  alumnoGanadorTemporalTesis: Alumno | null = null;

  constructor(private asignacionService: AsignacionService, private cdr: ChangeDetectorRef, private authService: AuthService, private router: Router) {}

  ngOnInit() {
    // La URL y el token los resuelve el servicio; la lógica del sorteo no cambia.
    this.asignacionService.obtenerTiposEvento().subscribe({
      next: (data) => {
        if (data && data.length > 0) {
          this.tiposEvento = data; 
        }
        this.cdr.detectChanges(); 
      },
      error: (err) => {
        console.warn("No se pudo cargar desde la API, usando valores locales:", err);
        this.cdr.detectChanges();
      }
    });
  }

  confirmarConfiguracion() {
    if (!this.eventoSeleccionado) { 
      Swal.fire('Acción Requerida', 'Debes seleccionar la Modalidad.', 'warning'); 
      return; 
    }
    this.configuracionLista = true;
  }

  // =========================================================
  // GENERADOR DE PLANTILLAS EXCEL
  // =========================================================
  generarPlantilla(tipo: 'profesores' | 'alumnos') {
    let titulo = tipo === 'profesores' ? 'Plantilla de Catedráticos' : 'Plantilla de Alumnos';
    let instrucciones = tipo === 'profesores' 
      ? 'Escribe un nombre por línea (Ej: Ing ---\nIng ---\nIng ---)' 
      : 'Escribe Carnet y Nombre separados por una coma (Ej: xxx-xx-xxxx, A--- B---)';

    Swal.fire({
      title: titulo,
      input: 'textarea',
      inputLabel: instrucciones,
      inputPlaceholder: 'Ingresa los datos aquí...',
      inputAttributes: { 'aria-label': 'Ingresa los datos aquí' },
      showCancelButton: true,
      confirmButtonText: 'Generar Excel',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#003366',
      width: '600px'
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        // El texto lo escribe el usuario: se normaliza igual que una celda de
        // Excel, lo que además neutraliza el prefijo de fórmula al exportar.
        const lineas = String(result.value)
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l !== '')
          .slice(0, MAX_FILAS);

        let datosExportar: any[] = [];

        if (tipo === 'profesores') {
          datosExportar = lineas.map((nombre: string) => ({
            'Nombre Catedratico ': normalizarCelda(nombre)
          }));
        } else {
          datosExportar = lineas.map((linea: string) => {
            const partes = linea.split(',');
            return {
              'Carnet': normalizarCelda(partes[0], 50),
              'Nombre Alumno': normalizarCelda(partes[1]) || 'Desconocido'
            };
          });
        }

        const worksheet = XLSX.utils.json_to_sheet(datosExportar);
        const workbook = { Sheets: { 'Datos': worksheet }, SheetNames: ['Datos'] };
        XLSX.writeFile(workbook, `Plantilla_${tipo}.xlsx`);
        
        Swal.fire('¡Plantilla Generada!', `Sube el archivo Plantilla_${tipo}.xlsx en el botón de al lado.`, 'success');
      }
    });
  }

  /**
   * Lee un archivo Excel de catedráticos o de alumnos.
   *
   * El archivo es entrada NO CONFIABLE: antes de usar nada se valida el
   * archivo (uno solo, extensión, tipo y tamaño) y se normaliza cada celda
   * (ver core/excel-seguro.ts). La lógica del sorteo trabaja siempre sobre
   * datos ya saneados.
   */
  leerExcel(evento: any, tipo: 'profesores' | 'alumnos') {
    const target: DataTransfer = <DataTransfer>(evento.target);

    // Validación del archivo antes de leer un solo byte de su contenido.
    const validacion = validarArchivoExcel(target.files);
    if (!validacion.valido) {
      Swal.fire('Archivo no válido', validacion.error ?? '', 'error');
      evento.target.value = '';
      return;
    }

    const file = target.files[0];
    const fileName = normalizarCelda(file.name, 255);

    if (tipo === 'profesores' && fileName === this.nombreArchivoAlumnos && fileName !== '') { Swal.fire('Error', 'Archivo duplicado.', 'error'); evento.target.value = ''; return; }
    if (tipo === 'alumnos' && fileName === this.nombreArchivoProfesores && fileName !== '') { Swal.fire('Error', 'Archivo duplicado.', 'error'); evento.target.value = ''; return; }

    const reader: FileReader = new FileReader();

    // Un archivo corrupto hace fallar la lectura: hay que avisar, no callar.
    reader.onerror = () => {
      Swal.fire('Error', 'No se pudo leer el archivo seleccionado.', 'error');
      evento.target.value = '';
    };

    reader.onload = (e: any) => {
      let datosExcel: unknown[][];

      try {
        const bstr: string = e.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });

        const primeraHoja = wb.SheetNames[0];
        if (!primeraHoja) {
          Swal.fire('Archivo vacío', 'El libro no contiene ninguna hoja.', 'error');
          evento.target.value = '';
          return;
        }

        const ws = wb.Sheets[primeraHoja];
        datosExcel = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
      } catch {
        // Un archivo manipulado puede romper el parseo: no propagamos el fallo.
        Swal.fire(
          'Archivo no válido',
          'No se pudo interpretar el archivo. Comprueba que sea un Excel correcto.',
          'error'
        );
        evento.target.value = '';
        return;
      }

      if (tipo === 'profesores') {
        const resultado = extraerProfesores(datosExcel);

        if (resultado.filas.length === 0) {
          Swal.fire(
            'Sin datos',
            'No se encontró ningún catedrático. Revisa que la primera columna tenga los nombres.',
            'error'
          );
          evento.target.value = '';
          return;
        }

        this.avisarFilasIgnoradas(resultado.descartadas, resultado.truncado);

        this.nombreArchivoProfesores = fileName;
        const profesMapeados = resultado.filas;

        if (this.eventoSeleccionado?.id === 3) {
          this.matematicaTesisCalculada = false;
          this.profesoresTesis = [...profesMapeados];
          Swal.fire('Éxito', `${this.profesoresTesis.length} catedráticos cargados para Tesis.`, 'success');
          this.calcularMatematicaTesis();
        } else {
          this.contadoresAreas = {}; 
          this.profesoresBaseNormal = [...profesMapeados];
          if (this.eventoSeleccionado?.id === 1) {
            this.profesoresNormal = [...this.profesoresBaseNormal]; 
            this.areaSeleccionada = '';
            Swal.fire('Excel Cargado', `Detectados ${this.profesoresBaseNormal.length} catedráticos. Selecciona un Área.`, 'info');
          } else {
            let numerosDisponibles = Array.from({length: this.profesoresBaseNormal.length}, (_, i) => i + 1);
            for (let i = numerosDisponibles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [numerosDisponibles[i], numerosDisponibles[j]] = [numerosDisponibles[j], numerosDisponibles[i]];
            }
            this.profesoresNormal = this.profesoresBaseNormal.map((p, index) => ({ ...p, id: numerosDisponibles[index] }));
            this.areaSeleccionada = 'Seminario'; 
            Swal.fire('Éxito', `${this.profesoresNormal.length} catedráticos cargados para Seminario.`, 'success');
          }
          this.calcularMatematicaNormal();
        }

      } else if (tipo === 'alumnos') {
        const resultado = extraerAlumnos(datosExcel);

        if (resultado.filas.length === 0) {
          Swal.fire(
            'Sin datos',
            'No se encontró ningún alumno. Revisa que la primera columna tenga los carnets.',
            'error'
          );
          evento.target.value = '';
          return;
        }

        this.avisarFilasIgnoradas(resultado.descartadas, resultado.truncado);

        this.nombreArchivoAlumnos = fileName;
        const alumnosMapeados = resultado.filas;

        if (this.eventoSeleccionado?.id === 3) {
          this.alumnosTesis = [...alumnosMapeados];
          Swal.fire('Éxito', `${this.alumnosTesis.length} alumnos cargados para Tesis.`, 'success');
          this.calcularMatematicaTesis();
        } else {
          this.alumnosNormal = [...alumnosMapeados];
          Swal.fire('Éxito', `${this.alumnosNormal.length} alumnos cargados.`, 'success');
          this.calcularMatematicaNormal();
        }
      }
    };
    reader.readAsBinaryString(target.files[0]);
  }

  /**
   * Informa al usuario de las filas que se ignoraron al cargar un Excel.
   * Hacerlo explícito evita que un archivo mal formado pase desapercibido y
   * el sorteo se ejecute con menos participantes de los esperados.
   *
   * @param descartadas Filas omitidas por estar vacías o incompletas.
   * @param truncado Indica si se alcanzó el límite máximo de filas.
   */
  private avisarFilasIgnoradas(descartadas: number, truncado: boolean) {
    const avisos: string[] = [];

    if (descartadas > 0) {
      avisos.push(`Se ignoraron ${descartadas} fila(s) vacías o incompletas.`);
    }
    if (truncado) {
      avisos.push(`Solo se procesaron las primeras ${MAX_FILAS} filas.`);
    }

    if (avisos.length > 0) {
      Swal.fire('Aviso', avisos.join('\n'), 'warning');
    }
  }

  obtenerNombreCorto(nombre: string): string {
    if (!nombre) return '';
    return nombre.trim();
  }
  
  obtenerNombreAlumnoCorto(alu: Alumno): string {
    if (!alu) return '';
    const primerNombre = alu.nombre_completo.trim().split(' ')[0] || '';
    const partesCarnet = (alu.carnet || '').trim().split('-');
    const numeroFinal = partesCarnet.length > 1 ? partesCarnet[partesCarnet.length - 1].trim() : (alu.carnet || '').trim();
    return `${primerNombre} - ${numeroFinal}`;
  }
  
  obtenerNombreAlumnoLista(alu: Alumno): string {
    if (!alu) return '';
    const partes = alu.nombre_completo.trim().split(' ').filter(p => p.length > 0);
    const primerNombre = partes[0] || '';
    const primerApellido = partes.length > 2 ? partes[2] : (partes[1] || '');
    return `${primerNombre} ${primerApellido} - ${alu.carnet.trim()}`;
  }
  
  obtenerTransformTexto(index: number, total: number): string {
    const angulo = 360 / total; const medio = (index * angulo) + (angulo / 2);
    return `translate(-50%, -50%) rotate(${medio}deg) translateY(-110px) rotate(90deg)`;
  }
  
  obtenerFondoRuleta(lista: any[]): string {
    if(!lista || lista.length === 0) return '#e2e8f0';
    let gradiente = 'conic-gradient('; const angulo = 360 / lista.length;
    lista.forEach((_, i) => { gradiente += `${this.coloresRuleta[i % this.coloresRuleta.length]} ${angulo * i}deg ${angulo * (i + 1)}deg${i === lista.length - 1 ? '' : ', '}`; });
    return gradiente + ')';
  }

  calcularRotacionExacta(rotacionActual: number, totalElementos: number, indiceGanador: number): number {
    const angulo = 360 / totalElementos;
    const anguloCentroPorcion = (indiceGanador * angulo) + (angulo / 2);
    const modObjetivo = (360 - anguloCentroPorcion) % 360;
    const vueltasBase = (Math.floor(Math.random() * 4) + 5) * 360;
    let diferencia = modObjetivo - (rotacionActual % 360);
    if (diferencia < 0) diferencia += 360; 
    return rotacionActual + vueltasBase + diferencia;
  }

  // =========================================================
  // METODO NORMAL
  // =========================================================
  seleccionarArea(area: string) {
    if (this.catedraticoGanadorNormal !== null) return; 
    if (!area) return;
    this.areaSeleccionada = area;
    this.profesoresNormal = [...this.profesoresBaseNormal];
    let numerosDisponibles = Array.from({length: this.profesoresNormal.length}, (_, i) => i + 1);
    for (let i = numerosDisponibles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numerosDisponibles[i], numerosDisponibles[j]] = [numerosDisponibles[j], numerosDisponibles[i]];
    }
    this.profesoresNormal = this.profesoresNormal.map((p, index) => ({ ...p, id: numerosDisponibles[index] }));
    this.calcularMatematicaNormal();
  }

  calcularMatematicaNormal() {
    if (this.profesoresNormal.length > 0 && this.alumnosNormal.length > 0) {
      this.cupoBaseNormal = Math.floor(this.alumnosNormal.length / this.profesoresNormal.length);
      this.sobrantesNormal = this.alumnosNormal.length % this.profesoresNormal.length;
    } else {
      this.cupoBaseNormal = 0; this.sobrantesNormal = 0;
    }
    this.cdr.detectChanges(); 
  }

  iniciarSorteoCatedraticosNormal() {
    if (this.alumnosNormal.length === 0) { Swal.fire('¡Sorteo Finalizado!', 'Ya no hay alumnos disponibles.', 'info'); return; }
    if (this.eventoSeleccionado?.id === 1 && this.areaSeleccionada === '') { Swal.fire('Atención', 'Selecciona el área.', 'warning'); return; }
    if (this.catedraticoGanadorNormal) { Swal.fire('Atención', 'Ya seleccionado.', 'warning'); return; }
    if (this.girandoNormalProfe || this.profesoresNormal.length === 0) return;
    
    this.girandoNormalProfe = true; 
    this.catedraticoGanadorNormal = null; 
    this.alumnosAsignadosNormal = [];
    
    const indice = Math.floor(Math.random() * this.profesoresNormal.length);
    this.gradosRotacionNormalProfe = this.calcularRotacionExacta(this.gradosRotacionNormalProfe, this.profesoresNormal.length, indice);
    
    setTimeout(() => {
      this.girandoNormalProfe = false;
      const profeGanador = this.profesoresNormal[indice];
      const clave = this.areaSeleccionada || 'General';
      const numeroGrupoOrdenado = (this.contadoresAreas[clave] || 0) + 1;
      profeGanador.id = numeroGrupoOrdenado; 

      this.catedraticoGanadorNormal = profeGanador;
      this.cupoActualNormal = this.cupoBaseNormal + (this.sobrantesNormal > 0 ? 1 : 0);
      
      let mensaje = `Se le ha asignado la Terna #${numeroGrupoOrdenado} a ${this.catedraticoGanadorNormal.nombre_completo}.`;
      if (this.eventoSeleccionado?.id === 1 && this.areaSeleccionada !== '') {
        mensaje = `${this.catedraticoGanadorNormal.nombre_completo} se asignó al grupo ${numeroGrupoOrdenado} de ${this.areaSeleccionada}.`;
      }
      Swal.fire('¡Catedrático Seleccionado!', mensaje, 'success');
      this.cdr.detectChanges();
    }, 4000); 
  }

  iniciarSorteoAlumnosNormal() {
    if (this.alumnoGanadorTemporalNormal) {
      const idx = this.alumnosNormal.findIndex(a => a.id === this.alumnoGanadorTemporalNormal!.id);
      if (idx !== -1) this.alumnosNormal.splice(idx, 1);
      this.alumnoGanadorTemporalNormal = null;
    }
    
    if (this.girandoNormalAlum || this.alumnosNormal.length === 0 || this.alumnosAsignadosNormal.length >= this.cupoActualNormal) return;
    this.girandoNormalAlum = true;
    
    const indice = Math.floor(Math.random() * this.alumnosNormal.length);
    this.gradosRotacionNormalAlum = this.calcularRotacionExacta(this.gradosRotacionNormalAlum, this.alumnosNormal.length, indice);
    
    setTimeout(() => {
      this.girandoNormalAlum = false;
      const ganador = this.alumnosNormal[indice];
      this.alumnosAsignadosNormal.push(ganador);
      this.alumnoGanadorTemporalNormal = ganador;
      
      Swal.fire({ title: 'Alumno Asignado', text: `${ganador.nombre_completo} fue removido de la ruleta.`, icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });

      if (this.alumnosAsignadosNormal.length >= this.cupoActualNormal) { 
        if (this.sobrantesNormal > 0) this.sobrantesNormal--; 
        setTimeout(() => Swal.fire('¡Cupo Lleno!', `La terna ha sido completada.`, 'info'), 600);
      }
      this.cdr.detectChanges();
    }, 4000); 
  }

  guardarTernaNormal() {
    if (!this.catedraticoGanadorNormal) return;
    
    if (this.alumnoGanadorTemporalNormal) {
      const idx = this.alumnosNormal.findIndex(a => a.id === this.alumnoGanadorTemporalNormal!.id);
      if (idx !== -1) this.alumnosNormal.splice(idx, 1);
      this.alumnoGanadorTemporalNormal = null;
    }

    let nombreFinal = this.catedraticoGanadorNormal.nombre_completo;
    if (this.eventoSeleccionado?.id === 1 && this.areaSeleccionada !== '') { 
      nombreFinal = `Grupo ${this.catedraticoGanadorNormal.id} de ${this.areaSeleccionada} - ${nombreFinal}`; 
    } else {
      nombreFinal = `Terna #${this.catedraticoGanadorNormal.id} - ${nombreFinal}`;
    }

    this.asignacionService.guardarTerna(nombreFinal, this.alumnosAsignadosNormal, this.eventoSeleccionado.id).subscribe({
      next: () => {
        Swal.fire('¡Guardado!', 'Asignación registrada correctamente.', 'success');
        const clave = this.areaSeleccionada || 'General';
        this.contadoresAreas[clave] = (this.contadoresAreas[clave] || 0) + 1;

        this.profesoresNormal = this.profesoresNormal.filter(p => p.nombre_completo !== this.catedraticoGanadorNormal?.nombre_completo);
        if (this.eventoSeleccionado?.id === 1) {
          this.profesoresBaseNormal = this.profesoresBaseNormal.filter(p => p.nombre_completo !== this.catedraticoGanadorNormal?.nombre_completo);
        }

        this.catedraticoGanadorNormal = null; 
        this.alumnosAsignadosNormal = []; 
        if (this.eventoSeleccionado?.id === 1) { this.areaSeleccionada = ''; }
        
        this.calcularMatematicaNormal();
        if (this.profesoresNormal.length === 0 || this.alumnosNormal.length === 0) Swal.fire('¡Finalizado!', 'Proceso concluido.', 'success');
      },
      // Antes no había manejador de error: un fallo al guardar pasaba
      // inadvertido y el usuario creía que la terna había quedado registrada.
      error: (err) => {
        Swal.fire('No se pudo guardar', mensajeParaUsuario(interpretarError(err)), 'error');
      }
    });
  }

  // =========================================================
  // METODO TESIS
  // =========================================================
  calcularMatematicaTesis() {
    if (!this.matematicaTesisCalculada && this.profesoresTesis.length > 0 && this.alumnosTesis.length > 0) {
      this.cantidadTernasTesis = Math.ceil(this.profesoresTesis.length / 3);
      if (this.cantidadTernasTesis === 0) this.cantidadTernasTesis = 1;
      this.cupoBaseTesis = Math.floor(this.alumnosTesis.length / this.cantidadTernasTesis);
      this.sobrantesTesis = this.alumnosTesis.length % this.cantidadTernasTesis;
      this.matematicaTesisCalculada = true; 
    }
    this.cdr.detectChanges();
  }

  iniciarSorteoTesisCatedratico() {
    if (this.profesorGanadorTemporalTesis) {
      const idx = this.profesoresTesis.findIndex(p => p.id === this.profesorGanadorTemporalTesis!.id);
      if (idx !== -1) this.profesoresTesis.splice(idx, 1);
      this.profesorGanadorTemporalTesis = null;
    }

    if (this.alumnosTesis.length === 0) { 
      Swal.fire('¡Sorteo Finalizado!', 'Ya no hay alumnos disponibles para conformar más jurados.', 'info'); 
      return; 
    }
    
    if (this.girandoTesisProfe || this.catedraticosTesisAsignados.length >= 3 || this.profesoresTesis.length === 0) return;
    
    this.girandoTesisProfe = true;
    
    const indice = Math.floor(Math.random() * this.profesoresTesis.length);
    this.gradosRotacionTesisProfe = this.calcularRotacionExacta(this.gradosRotacionTesisProfe, this.profesoresTesis.length, indice);

    setTimeout(() => {
      this.girandoTesisProfe = false;
      const ganador = this.profesoresTesis[indice];
      this.catedraticosTesisAsignados.push(ganador);
      this.profesorGanadorTemporalTesis = ganador;
      
      const roles = ['Presidente', 'Vocal 1', 'Vocal 2'];
      const rolAsignado = roles[this.catedraticosTesisAsignados.length - 1];

      // Se usa `text:` y no `html:`: el nombre viene de un Excel subido por el
      // usuario y con `html:` una celda como <img src=x onerror=...> se
      // ejecutaría dentro de la aplicación.
      if (this.catedraticosTesisAsignados.length < 3) {
        Swal.fire({
          title: `¡${rolAsignado} Seleccionado!`,
          text: `${ganador.nombre_completo}\n\nSe ha integrado con éxito al jurado examinador (${this.catedraticosTesisAsignados.length}/3).`,
          icon: 'success',
          confirmButtonColor: '#003366',
          confirmButtonText: 'Continuar Sorteo'
        });
      } else {
        this.cupoActualTesis = this.cupoBaseTesis + (this.sobrantesTesis > 0 ? 1 : 0);
        Swal.fire({
          title: `¡${rolAsignado} Seleccionado!`,
          text: `${ganador.nombre_completo}\n\n¡Terna Completada! Se han asignado los 3 catedráticos requeridos.\n\nProcede a sortear individualmente a los ${this.cupoActualTesis} alumnos asignados a este jurado.`,
          icon: 'success',
          confirmButtonColor: '#003366',
          confirmButtonText: 'Comenzar Asignación de Alumnos'
        });
      }
      this.cdr.detectChanges();
    }, 4000);
  }

  iniciarSorteoTesisAlumnoIndividual() {
    if (this.alumnoGanadorTemporalTesis) {
      const idx = this.alumnosTesis.findIndex(a => a.id === this.alumnoGanadorTemporalTesis!.id);
      if (idx !== -1) this.alumnosTesis.splice(idx, 1);
      this.alumnoGanadorTemporalTesis = null;
    }

    if (this.catedraticosTesisAsignados.length < 3) { Swal.fire('Atención', 'Debes conformar el jurado de 3 catedráticos primero.', 'warning'); return; }
    if (this.girandoTesisAlum || this.alumnosTesisAsignados.length >= this.cupoActualTesis || this.alumnosTesis.length === 0) return;
    
    this.girandoTesisAlum = true;
    const indice = Math.floor(Math.random() * this.alumnosTesis.length);
    this.gradosRotacionTesisAlum = this.calcularRotacionExacta(this.gradosRotacionTesisAlum, this.alumnosTesis.length, indice);

    setTimeout(() => {
      this.girandoTesisAlum = false;
      const ganador = this.alumnosTesis[indice];
      
      this.alumnosTesisAsignados.push(ganador);
      this.alumnoGanadorTemporalTesis = ganador;
      
      const totalAsignados = this.alumnosTesisAsignados.length;
      const esUltimo = totalAsignados >= this.cupoActualTesis;

      // El nombre y el carnet proceden del Excel: se muestran como texto plano.
      if (!esUltimo) {
        Swal.fire({
          title: '¡Alumno Seleccionado!',
          text: `${ganador.nombre_completo}\nCarnet: ${ganador.carnet}\n\nAlumno ${totalAsignados} de ${this.cupoActualTesis} asignados a esta terna.`,
          icon: 'success',
          confirmButtonColor: '#CC0000',
          confirmButtonText: 'Continuar Sorteo'
        });
      } else {
        Swal.fire({
          title: '¡Alumno Seleccionado!',
          text: `${ganador.nombre_completo}\nCarnet: ${ganador.carnet}\n\n¡Grupo Completo (${totalAsignados}/${this.cupoActualTesis})! Se ha completado el cupo de alumnos para esta terna. Ya puedes registrarla oficialmente.`,
          icon: 'success',
          confirmButtonColor: '#003366',
          confirmButtonText: 'Listo para Guardar'
        });
      }
      this.cdr.detectChanges();
    }, 4000); 
  }

  guardarTesisOficial() {
    if (this.alumnosTesisAsignados.length === 0 || this.catedraticosTesisAsignados.length < 3) return;
    
    if (this.profesorGanadorTemporalTesis) {
      const idx = this.profesoresTesis.findIndex(p => p.id === this.profesorGanadorTemporalTesis!.id);
      if (idx !== -1) this.profesoresTesis.splice(idx, 1);
      this.profesorGanadorTemporalTesis = null;
    }

    if (this.alumnoGanadorTemporalTesis) {
      const idx = this.alumnosTesis.findIndex(a => a.id === this.alumnoGanadorTemporalTesis!.id);
      if (idx !== -1) this.alumnosTesis.splice(idx, 1);
      this.alumnoGanadorTemporalTesis = null;
    }

    let guardados = 0;
    const totalAGuardar = this.alumnosTesisAsignados.length;

    this.alumnosTesisAsignados.forEach(alu => {
      this.asignacionService.guardarTesis(alu, this.catedraticosTesisAsignados, this.eventoSeleccionado.id).subscribe({
        next: () => {
          guardados++;
          if (guardados === totalAGuardar) {
            Swal.fire('¡Guardado!', 'El jurado y su grupo de alumnos han sido registrados correctamente.', 'success');
            if (this.sobrantesTesis > 0) this.sobrantesTesis--;
            this.alumnosTesisAsignados = []; 
            this.catedraticosTesisAsignados = []; 
            this.calcularMatematicaTesis(); 
            if (this.alumnosTesis.length === 0) { Swal.fire('¡Finalizado!', 'Todos los tesistas han sido asignados.', 'success'); }
          }
        },
        error: () => {
          guardados++;
          if (guardados === totalAGuardar) { Swal.fire('¡Aviso!', 'Se completó el proceso, revisa el reporte.', 'info'); }
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