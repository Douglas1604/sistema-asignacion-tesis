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
import { obtenerEnteroAleatorio, obtenerIndiceAleatorio } from '../../core/crypto-random';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

/**
 * Catedrático participante en la ruleta.
 * `id` es un identificador de sesión (no una clave de base de datos): sirve para
 * localizar al participante dentro de los arreglos y, en Privado/Seminario, se
 * reemplaza por el número de grupo asignado al resultar ganador.
 */
export interface Profesor { id?: number; nombre_completo: string; area?: string; }
/**
 * Alumno participante en la ruleta.
 * `id` es el correlativo de fila generado al leer el Excel y se usa para retirar
 * al ganador de la ruleta sin depender de que carnet o nombre sean únicos.
 */
export interface Alumno { id?: number; carnet: string; nombre_completo: string; }

@Component({
  selector: 'app-sorteo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sorteo.html',
  styleUrl: './sorteo.css'
})
/**
 * Motor del sorteo de asignaciones académicas.
 *
 * @description El componente implementa dos procedimientos independientes:
 *
 *  - Método Normal (Examen Privado y Seminario): relación 1 a N. Se sortea un
 *    catedrático y, a continuación, los alumnos que integrarán su grupo hasta
 *    completar el cupo calculado.
 *  - Método Tesis: relación 3 a N. Se sortean tres catedráticos (Presidente,
 *    Vocal 1, Vocal 2) que conforman una terna evaluadora y después los alumnos
 *    que esa terna examinará.
 *
 * En ambos casos el reparto es equitativo: con A alumnos y G grupos, cada grupo
 * recibe `floor(A / G)` alumnos y los `A mod G` restantes se distribuyen de uno
 * en uno entre los primeros grupos sorteados, de modo que ningún grupo difiere
 * de otro en más de un alumno.
 *
 * Principio de diseño de la animación: el ganador se decide ANTES de girar.
 * La rotación visual se calcula para detenerse exactamente sobre ese índice;
 * la animación comunica el resultado, no lo produce.
 *
 * Separación entre DECISIÓN y FÍSICA de la ruleta (fuentes de aleatoriedad):
 *  - Decisión algorítmica (oficial): el índice del catedrático o alumno ganador
 *    y la numeración aleatoria de catedráticos (Fisher-Yates) se obtienen con
 *    `obtenerIndiceAleatorio` / `obtenerEnteroAleatorio` (`core/crypto-random`),
 *    basados en `crypto.getRandomValues` y sin sesgo de módulo.
 *  - Física cosmética: únicamente el número de vueltas extra de la animación
 *    (`calcularRotacionExacta`) usa `Math.random()`. Son múltiplos de 360°, por
 *    lo que no pueden alterar la porción que queda bajo la aguja: cambian cómo
 *    se ve el giro, nunca quién gana.
 */
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
  /** Grupos ya guardados por área (o 'General'); determina el número del siguiente grupo. */
  contadoresAreas: { [key: string]: number } = {};

  profesoresBaseNormal: Profesor[] = []; 
  profesoresNormal: Profesor[] = []; 
  alumnosNormal: Alumno[] = [];
  
  /** Cociente entero: alumnos garantizados para cada catedrático restante. */
  cupoBaseNormal: number = 0;
  /** Residuo de la división: alumnos extra pendientes de repartir de uno en uno. */
  sobrantesNormal: number = 0;

  gradosRotacionNormalProfe: number = 0; 
  girandoNormalProfe: boolean = false;
  catedraticoGanadorNormal: Profesor | null = null;
  /** Cupo del grupo en curso: `cupoBase + 1` mientras queden sobrantes, `cupoBase` después. */
  cupoActualNormal: number = 0;
  alumnosAsignadosNormal: Alumno[] = [];   
  
  gradosRotacionNormalAlum: number = 0; 
  girandoNormalAlum: boolean = false;
  /**
   * Último alumno extraído que aún permanece visible en la ruleta.
   * Se retira del arreglo al iniciar el siguiente giro o al guardar, no en el
   * instante de ganar: así la porción no desaparece bajo la aguja mientras el
   * público lee el resultado.
   */
  alumnoGanadorTemporalNormal: Alumno | null = null;

  /** Petición de guardado del grupo en curso: bloquea un doble envío. */
  guardandoNormal: boolean = false;

  // =========================================================
  // Metodo 2: TESIS
  // =========================================================
  profesoresTesis: Profesor[] = []; 
  alumnosTesis: Alumno[] = []; 
  
  catedraticosTesisAsignados: Profesor[] = []; 
  alumnosTesisAsignados: Alumno[] = []; 
  
  /** Número de jurados a conformar: `ceil(catedráticos / 3)`. */
  cantidadTernasTesis: number = 0;
  /** Alumnos garantizados por terna: `floor(alumnos / ternas)`. */
  cupoBaseTesis: number = 0;
  /** Alumnos excedentes (`alumnos mod ternas`); se consume uno por cada terna guardada. */
  sobrantesTesis: number = 0;
  /** Cupo de la terna en curso, fijado al completarse su tercer catedrático. */
  cupoActualTesis: number = 0;
  /**
   * Bandera de cálculo único. En Tesis la distribución se calcula una sola vez
   * con las cifras iniciales y luego se consume con `sobrantesTesis`; recalcular
   * tras cada guardado alteraría el reparto ya comprometido.
   */
  matematicaTesisCalculada: boolean = false;

  gradosRotacionTesisProfe: number = 0; 
  girandoTesisProfe: boolean = false;
  gradosRotacionTesisAlum: number = 0; 
  girandoTesisAlum: boolean = false;
  
  profesorGanadorTemporalTesis: Profesor | null = null;
  alumnoGanadorTemporalTesis: Alumno | null = null;

  /** Petición de guardado de la terna en curso: bloquea un doble envío. */
  guardandoTesis: boolean = false;

  // =========================================================
  // REGISTRO IRREVERSIBLE DE PARTICIPANTES YA SORTEADOS
  // =========================================================
  /**
   * Claves de los participantes que YA salieron en la ruleta durante esta
   * sesión, por modalidad.
   *
   * @description Son la memoria autoritativa del sorteo. Los arreglos
   * `alumnosTesis`, `profesoresTesis` y `alumnosNormal` son la RULETA VISIBLE,
   * y de ellos se retira al ganador de forma diferida para que su porción no
   * desaparezca bajo la aguja mientras el público lee el resultado. Esa
   * retirada diferida es frágil: basta con que una transición (guardar la
   * terna, fijar el siguiente jurado) no la ejecute para que el ganador
   * retenido vuelva a la siguiente ronda y, al final, sobren alumnos sin
   * asignar. Estos conjuntos cierran ese hueco: una vez que alguien entra,
   * `purgar…` lo elimina de la ruleta en cada transición, y nada puede
   * devolverlo.
   *
   * Solo se vacían al cargar un Excel nuevo, que es el único momento en que
   * el sorteo empieza de cero.
   */
  private alumnosSorteadosTesis = new Set<string>();
  private profesoresSorteadosTesis = new Set<string>();
  private alumnosSorteadosNormal = new Set<string>();
  private profesoresSorteadosNormal = new Set<string>();

  /**
   * @param asignacionService Acceso HTTP a asignaciones y catálogo de modalidades.
   * @param cdr Detector de cambios; se invoca manualmente porque varias mutaciones
   *            ocurren dentro de callbacks de `FileReader` y `setTimeout`.
   * @param authService Gestión de la sesión (cierre de sesión).
   * @param router Navegación tras cerrar sesión.
   */
  constructor(private asignacionService: AsignacionService, private cdr: ChangeDetectorRef, private authService: AuthService, private router: Router) {}

  /**
   * Carga el catálogo de modalidades desde la API.
   * Si la petición falla se conservan los valores locales declarados en
   * `tiposEvento`, de modo que la pantalla sigue siendo operativa (degradación elegante).
   */
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

  /**
   * Cierra la fase de configuración y habilita la carga de archivos.
   * La modalidad condiciona toda la lógica posterior (Normal vs. Tesis).
   */
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
  /**
   * Genera y descarga una plantilla Excel a partir de texto libre.
   *
   * @description Permite construir el archivo de entrada sin conocer su
   * estructura: cada línea es un registro y, en alumnos, la coma separa carnet y
   * nombre. Todo valor pasa por `normalizarCelda` antes de escribirse.
   *
   * @param tipo Tipo de plantilla a generar.
   */
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

        // Si el texto solo traía líneas en blanco, `json_to_sheet([])` genera
        // un libro sin una sola celda, que Excel abre como archivo dañado.
        if (datosExportar.length === 0) {
          Swal.fire('Sin datos', 'No se reconoció ninguna línea con contenido.', 'warning');
          return;
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
   *
   * Secuencia: validación del archivo -> control de duplicado -> lectura
   * asíncrona con FileReader -> parseo con SheetJS -> extracción y saneamiento
   * de filas -> actualización del estado según la modalidad -> recálculo del reparto.
   *
   * @param evento Evento `change` del input de tipo archivo.
   * @param tipo Lista a la que corresponde el archivo.
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

    // FileReader es asíncrono y basado en eventos: los manejadores `onerror` y
    // `onload` se registran primero y la lectura se dispara al final del método.
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
        // `header: 1` produce una matriz de filas (arreglo de arreglos) en lugar
        // de objetos por encabezado; el tipo `unknown` obliga a validar cada
        // celda antes de usarla, en coherencia con la premisa de entrada no confiable.
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
          // Una nueva lista de catedráticos invalida el reparto previo: se baja
          // la bandera para permitir que `calcularMatematicaTesis` recalcule.
          // Cargar un archivo nuevo es el ÚNICO momento en que el sorteo
          // empieza de cero, así que también se olvida quién ya salió.
          this.matematicaTesisCalculada = false;
          this.profesoresSorteadosTesis.clear();
          this.catedraticosTesisAsignados = [];
          this.profesorGanadorTemporalTesis = null;
          this.profesoresTesis = profesMapeados.map((p) => ({ ...p }));
          Swal.fire('Éxito', `${this.profesoresTesis.length} catedráticos cargados para Tesis.`, 'success');
          this.calcularMatematicaTesis();
        } else {
          this.contadoresAreas = {}; 
          this.profesoresSorteadosNormal.clear();
          this.catedraticoGanadorNormal = null;
          this.profesoresBaseNormal = profesMapeados.map((p) => ({ ...p }));
          if (this.eventoSeleccionado?.id === 1) {
            // Copias propias: el número de grupo se escribe sobre el objeto de
            // la ruleta al ganar, y con referencias compartidas esa escritura
            // alteraba también la lista base.
            this.profesoresNormal = this.profesoresBaseNormal.map((p) => ({ ...p })); 
            this.areaSeleccionada = '';
            Swal.fire('Excel Cargado', `Detectados ${this.profesoresBaseNormal.length} catedráticos. Selecciona un Área.`, 'info');
          } else {
            // Seminario: no hay selección de área, así que la numeración aleatoria
            // se aplica en el momento de la carga.
            //
            // Barajado de Fisher-Yates (variante de Durstenfeld), recorrido inverso:
            // para cada posición i, desde la última hasta la segunda, se elige un
            // índice j uniforme en [0, i] y se intercambian ambas posiciones.
            // Produce n! caminos de ejecución equiprobables, uno por permutación,
            // en tiempo O(n) y sin memoria adicional. El resultado es una
            // asignación de identificadores 1..n únicos y sin sesgo de orden.
            // El índice j sale de Web Crypto: forma parte de la decisión oficial.
            let numerosDisponibles = Array.from({length: this.profesoresBaseNormal.length}, (_, i) => i + 1);
            for (let i = numerosDisponibles.length - 1; i > 0; i--) {
                const j = obtenerEnteroAleatorio(0, i);
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
          this.alumnosSorteadosTesis.clear();
          this.alumnosTesisAsignados = [];
          this.alumnoGanadorTemporalTesis = null;
          this.cupoActualTesis = 0;
          this.matematicaTesisCalculada = false;
          this.alumnosTesis = alumnosMapeados.map((a) => ({ ...a }));
          Swal.fire('Éxito', `${this.alumnosTesis.length} alumnos cargados para Tesis.`, 'success');
          this.calcularMatematicaTesis();
        } else {
          this.alumnosSorteadosNormal.clear();
          this.alumnosAsignadosNormal = [];
          this.alumnoGanadorTemporalNormal = null;
          this.cupoActualNormal = 0;
          this.alumnosNormal = alumnosMapeados.map((a) => ({ ...a }));
          Swal.fire('Éxito', `${this.alumnosNormal.length} alumnos cargados.`, 'success');
          this.calcularMatematicaNormal();
        }
      }
    };
    // Inicia la lectura; al completarse, el navegador invocará `reader.onload`.
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

  // =========================================================
  // RETIRADA IRREVERSIBLE DE PARTICIPANTES
  // =========================================================
  /**
   * Clave estable de un alumno dentro de la sesión de sorteo.
   *
   * Se prefiere el `id` (correlativo de fila del Excel, único por definición)
   * y se recurre al carnet normalizado cuando el alumno no procede de un
   * archivo. Sin el respaldo por carnet, dos filas del mismo alumno con `id`
   * distinto se considerarían personas diferentes.
   *
   * @param alumno Alumno a identificar.
   * @returns Clave única dentro de la sesión.
   */
  private claveAlumno(alumno: Alumno): string {
    if (alumno.id !== undefined && alumno.id !== null) return `id:${alumno.id}`;
    return `carnet:${(alumno.carnet || '').trim().toLowerCase()}`;
  }

  /**
   * Clave estable de un catedrático dentro de la sesión de sorteo.
   *
   * Aquí NO se usa el `id`: en Privado y Seminario se sobrescribe con el
   * número de grupo al resultar ganador, así que dejaría de identificar a la
   * persona. El nombre normalizado sí se mantiene constante.
   *
   * @param profesor Catedrático a identificar.
   * @returns Clave única dentro de la sesión.
   */
  private claveProfesor(profesor: Profesor): string {
    return `nombre:${(profesor.nombre_completo || '').trim().toLowerCase()}`;
  }

  /**
   * Elimina de la ruleta de Tesis a todo alumno y catedrático ya sorteado.
   *
   * @description Se construye un arreglo NUEVO con `filter` en lugar de mutar
   * el existente: la referencia cambia, Angular recalcula las porciones y la
   * ruleta pintada coincide siempre con la lista real de participantes. Es
   * idempotente, así que puede invocarse en cada transición sin efectos
   * acumulados.
   */
  private purgarSorteadosTesis(): void {
    this.alumnosTesis = this.alumnosTesis.filter(
      (a) => !this.alumnosSorteadosTesis.has(this.claveAlumno(a))
    );
    this.profesoresTesis = this.profesoresTesis.filter(
      (p) => !this.profesoresSorteadosTesis.has(this.claveProfesor(p))
    );

    // Ya no hay nada retenido: lo retenido acaba de salir de la ruleta.
    this.alumnoGanadorTemporalTesis = null;
    this.profesorGanadorTemporalTesis = null;
  }

  /**
   * Equivalente de `purgarSorteadosTesis` para Privado y Seminario.
   *
   * En Privado el catedrático se retira también de `profesoresBaseNormal`,
   * que es la lista que repuebla la ruleta al cambiar de área: sin ello, un
   * docente ya asignado reaparecería al seleccionar otra área.
   */
  private purgarSorteadosNormal(): void {
    this.alumnosNormal = this.alumnosNormal.filter(
      (a) => !this.alumnosSorteadosNormal.has(this.claveAlumno(a))
    );
    this.profesoresNormal = this.profesoresNormal.filter(
      (p) => !this.profesoresSorteadosNormal.has(this.claveProfesor(p))
    );
    this.profesoresBaseNormal = this.profesoresBaseNormal.filter(
      (p) => !this.profesoresSorteadosNormal.has(this.claveProfesor(p))
    );

    this.alumnoGanadorTemporalNormal = null;
  }

  /**
   * Etiqueta de un catedrático para la porción de la ruleta.
   * @param nombre Nombre completo ya normalizado.
   * @returns Nombre sin espacios exteriores, o cadena vacía.
   */
  obtenerNombreCorto(nombre: string): string {
    if (!nombre) return '';
    return nombre.trim();
  }
  
  /**
   * Etiqueta compacta de un alumno para la ruleta: primer nombre y último
   * segmento del carnet, suficiente para identificarlo en una porción estrecha.
   * @param alu Alumno a representar.
   * @returns Texto con el formato "Nombre - 1234".
   */
  obtenerNombreAlumnoCorto(alu: Alumno): string {
    if (!alu) return '';
    const primerNombre = alu.nombre_completo.trim().split(' ')[0] || '';
    const partesCarnet = (alu.carnet || '').trim().split('-');
    const numeroFinal = partesCarnet.length > 1 ? partesCarnet[partesCarnet.length - 1].trim() : (alu.carnet || '').trim();
    return `${primerNombre} - ${numeroFinal}`;
  }
  
  /**
   * Etiqueta de un alumno para las listas de asignados.
   * Heurística para nombres hispanos de cuatro partes (dos nombres y dos
   * apellidos): con más de dos palabras toma la tercera como primer apellido.
   * @param alu Alumno a representar.
   * @returns Texto con el formato "Nombre Apellido - carnet".
   */
  obtenerNombreAlumnoLista(alu: Alumno): string {
    if (!alu) return '';
    const partes = alu.nombre_completo.trim().split(' ').filter(p => p.length > 0);
    const primerNombre = partes[0] || '';
    const primerApellido = partes.length > 2 ? partes[2] : (partes[1] || '');
    return `${primerNombre} ${primerApellido} - ${alu.carnet.trim()}`;
  }
  
  /**
   * Posiciona la etiqueta de una porción sobre la bisectriz de su sector.
   *
   * @description Composición de transformaciones CSS, aplicadas en orden:
   *  1. `translate(-50%, -50%)`: centra el texto sobre el centro del círculo.
   *  2. `rotate(medio)`: orienta el eje hacia el centro angular de la porción.
   *  3. `translateY(-110px)`: desplaza la etiqueta hacia el borde (radio 110 px).
   *  4. `rotate(90deg)`: alinea el texto en sentido radial.
   *
   * @param index Posición del elemento en la lista.
   * @param total Número total de porciones.
   * @returns Valor para la propiedad CSS `transform`.
   */
  obtenerTransformTexto(index: number, total: number): string {
    const angulo = 360 / total; const medio = (index * angulo) + (angulo / 2);
    return `translate(-50%, -50%) rotate(${medio}deg) translateY(-110px) rotate(90deg)`;
  }
  
  /**
   * Construye el fondo de la ruleta como un `conic-gradient` de sectores iguales.
   *
   * @description Cada elemento ocupa el arco [ángulo·i, ángulo·(i+1)] con
   * ángulo = 360/n. Repetir la misma posición inicial y final entre colores
   * consecutivos genera bordes nítidos en lugar de un degradado. Los colores
   * se reciclan con aritmética modular cuando hay más elementos que colores.
   *
   * @param lista Elementos que se representarán en la ruleta.
   * @returns Valor para la propiedad CSS `background`.
   */
  obtenerFondoRuleta(lista: any[]): string {
    if(!lista || lista.length === 0) return '#e2e8f0';
    let gradiente = 'conic-gradient('; const angulo = 360 / lista.length;
    lista.forEach((_, i) => { gradiente += `${this.coloresRuleta[i % this.coloresRuleta.length]} ${angulo * i}deg ${angulo * (i + 1)}deg${i === lista.length - 1 ? '' : ', '}`; });
    return gradiente + ')';
  }

  /**
   * Calcula la rotación absoluta que deja la porción ganadora bajo la aguja.
   *
   * @description La aguja está fija en 0° (parte superior) y el gradiente
   * cónico también comienza en 0°, avanzando en sentido horario. El centro de
   * la porción i está en `c = i·α + α/2`, con α = 360/n. Girar la ruleta R
   * grados lleva ese centro a `(c + R) mod 360`; para que coincida con la aguja
   * se necesita `R ≡ 360 − c (mod 360)`, que es `modObjetivo`.
   *
   * Como la rotación es acumulativa (la ruleta no vuelve a 0° entre giros), se
   * calcula la diferencia entre la posición actual normalizada y el objetivo,
   * llevándola al intervalo [0, 360) para girar siempre hacia delante. Se
   * añaden entre 5 y 8 vueltas completas, que no alteran la posición final
   * (múltiplos de 360) pero producen el efecto visual de giro.
   *
   * Uso deliberado de `Math.random()`: el número de vueltas es un detalle
   * COSMÉTICO de la física de la ruleta. El ganador ya llega decidido en
   * `indiceGanador` (Web Crypto) y ninguna vuelta extra puede cambiarlo.
   *
   * @param rotacionActual Grados acumulados de la ruleta antes del giro.
   * @param totalElementos Número de porciones.
   * @param indiceGanador Índice ya sorteado que debe quedar bajo la aguja.
   * @returns Nueva rotación absoluta en grados, siempre mayor que la actual.
   */
  calcularRotacionExacta(rotacionActual: number, totalElementos: number, indiceGanador: number): number {
    const angulo = 360 / totalElementos;
    const anguloCentroPorcion = (indiceGanador * angulo) + (angulo / 2);
    const modObjetivo = (360 - anguloCentroPorcion) % 360;
    // Cosmético (ver JSDoc): solo varía cuántas vueltas se ven, no el resultado.
    const vueltasBase = (Math.floor(Math.random() * 4) + 5) * 360;
    let diferencia = modObjetivo - (rotacionActual % 360);
    if (diferencia < 0) diferencia += 360; 
    return rotacionActual + vueltasBase + diferencia;
  }

  // =========================================================
  // METODO NORMAL
  // =========================================================
  /**
   * Selecciona el área de Examen Privado y prepara la ruleta de catedráticos.
   *
   * @description Se bloquea mientras haya un catedrático ganador sin guardar,
   * para no cambiar de área con un grupo a medio conformar. Restaura la ruleta
   * a partir de `profesoresBaseNormal` (catedráticos aún no asignados), asigna
   * identificadores aleatorios mediante Fisher-Yates y recalcula el reparto.
   *
   * @param area Nombre del área elegida.
   */
  seleccionarArea(area: string) {
    if (this.catedraticoGanadorNormal !== null) return;
    if (!area) return;
    this.areaSeleccionada = area;
    // La base ya no contiene a los docentes asignados (`purgarSorteadosNormal`
    // la depura al guardar), pero se vuelve a filtrar por si acaso: este es el
    // único punto que repuebla la ruleta desde una lista anterior.
    this.purgarSorteadosNormal();
    this.profesoresNormal = this.profesoresBaseNormal.map((p) => ({ ...p }));
    // Fisher-Yates sobre la secuencia 1..n (ver explicación detallada en `leerExcel`),
    // con el índice j obtenido de Web Crypto.
    let numerosDisponibles = Array.from({length: this.profesoresNormal.length}, (_, i) => i + 1);
    for (let i = numerosDisponibles.length - 1; i > 0; i--) {
        const j = obtenerEnteroAleatorio(0, i);
        [numerosDisponibles[i], numerosDisponibles[j]] = [numerosDisponibles[j], numerosDisponibles[i]];
    }
    this.profesoresNormal = this.profesoresNormal.map((p, index) => ({ ...p, id: numerosDisponibles[index] }));
    this.calcularMatematicaNormal();
  }

  /**
   * Calcula el reparto equitativo del Método Normal mediante división euclidiana.
   *
   * @description Para A alumnos y P catedráticos: A = P·q + r, con 0 ≤ r < P.
   *  - `cupoBaseNormal = q = floor(A / P)`: alumnos que recibe todo catedrático.
   *  - `sobrantesNormal = r = A mod P`: alumnos que no caben en el reparto exacto
   *    y se asignan de uno en uno a los primeros r grupos (cupo q + 1).
   * Ejemplo: A = 17, P = 5 -> q = 3, r = 2 -> grupos de 4, 4, 3, 3, 3 (suma 17).
   *
   * Se invoca de nuevo tras cada guardado con las cifras RESTANTES; la división
   * sobre el remanente conserva la equidad del reparto global.
   * Con cualquiera de las listas vacías el reparto es 0 (evita dividir entre cero).
   */
  calcularMatematicaNormal() {
    if (this.profesoresNormal.length > 0 && this.alumnosNormal.length > 0) {
      this.cupoBaseNormal = Math.floor(this.alumnosNormal.length / this.profesoresNormal.length);
      this.sobrantesNormal = this.alumnosNormal.length % this.profesoresNormal.length;
    } else {
      this.cupoBaseNormal = 0; this.sobrantesNormal = 0;
    }
    this.cdr.detectChanges(); 
  }

  /**
   * Sortea el catedrático que encabezará el siguiente grupo (Método Normal).
   *
   * @description Tras superar las precondiciones (quedan alumnos, área elegida
   * en Privado, ningún ganador pendiente y ruleta en reposo):
   *  1. Se elige el índice ganador con probabilidad uniforme 1/n.
   *  2. Se calcula la rotación que lo deja bajo la aguja y se inicia la animación.
   *  3. A los 4 s (misma duración que la transición CSS) se fija el ganador, se
   *     le asigna el número de grupo correlativo del área y se determina el
   *     cupo del grupo: base + 1 si todavía quedan sobrantes por repartir.
   * La bandera `girandoNormalProfe` actúa como semáforo contra dobles clics.
   */
  iniciarSorteoCatedraticosNormal() {
    // Depuración previa: ningún catedrático ni alumno ya asignado puede seguir
    // en la ruleta al abrir un grupo nuevo.
    this.purgarSorteadosNormal();

    if (this.alumnosNormal.length === 0) { Swal.fire('¡Sorteo Finalizado!', 'Ya no hay alumnos disponibles.', 'info'); return; }
    if (this.eventoSeleccionado?.id === 1 && this.areaSeleccionada === '') { Swal.fire('Atención', 'Selecciona el área.', 'warning'); return; }
    if (this.catedraticoGanadorNormal) { Swal.fire('Atención', 'Ya seleccionado.', 'warning'); return; }
    if (this.girandoNormalProfe || this.profesoresNormal.length === 0) return;
    
    this.girandoNormalProfe = true; 
    this.catedraticoGanadorNormal = null; 
    this.alumnosAsignadosNormal = [];

    // DECISIÓN OFICIAL: índice uniforme en {0, …, n−1} (probabilidad 1/n cada
    // uno) desde Web Crypto con muestreo por rechazo. La animación posterior
    // solo representa este resultado.
    const indice = obtenerIndiceAleatorio(this.profesoresNormal.length);
    this.gradosRotacionNormalProfe = this.calcularRotacionExacta(this.gradosRotacionNormalProfe, this.profesoresNormal.length, indice);
    
    setTimeout(() => {
      this.girandoNormalProfe = false;
      const profeGanador = this.profesoresNormal[indice];
      if (!profeGanador) { this.cdr.detectChanges(); return; }

      const clave = this.areaSeleccionada || 'General';
      // El número de grupo es secuencial por área (1, 2, 3…), independiente del
      // identificador aleatorio: refleja el orden en que se conformaron los grupos.
      const numeroGrupoOrdenado = (this.contadoresAreas[clave] || 0) + 1;
      profeGanador.id = numeroGrupoOrdenado;

      this.catedraticoGanadorNormal = profeGanador;
      // Reparto del residuo: mientras quede al menos un sobrante, el grupo
      // actual absorbe uno de ellos y su cupo es base + 1. El cupo se acota a
      // los alumnos que quedan: pedir más de los disponibles dejaría el grupo
      // sin poder completarse y el botón de guardar fuera de alcance.
      const cupoTeoricoNormal = this.cupoBaseNormal + (this.sobrantesNormal > 0 ? 1 : 0);
      this.cupoActualNormal = Math.max(1, Math.min(cupoTeoricoNormal, this.alumnosNormal.length));
      
      let mensaje = `Se le ha asignado la Terna #${numeroGrupoOrdenado} a ${this.catedraticoGanadorNormal.nombre_completo}.`;
      if (this.eventoSeleccionado?.id === 1 && this.areaSeleccionada !== '') {
        mensaje = `${this.catedraticoGanadorNormal.nombre_completo} se asignó al grupo ${numeroGrupoOrdenado} de ${this.areaSeleccionada}.`;
      }
      Swal.fire('¡Catedrático Seleccionado!', mensaje, 'success');
      this.cdr.detectChanges();
    }, 4000); 
  }

  /**
   * Sortea el siguiente alumno para el grupo del catedrático en curso.
   *
   * @description Lógica de retención del ganador temporal: el alumno extraído
   * en el giro anterior sigue en la ruleta hasta este momento. Lo primero que
   * se hace es retirarlo del arreglo (búsqueda por `id`), de modo que el nuevo
   * índice se sortea exclusivamente entre alumnos aún no asignados y un mismo
   * alumno no puede salir dos veces. Cuando el grupo alcanza su cupo se consume
   * uno de los sobrantes y se detienen los giros.
   */
  iniciarSorteoAlumnosNormal() {
    // Paso 1: retirada del ganador del giro anterior y de cualquier alumno ya
    // sorteado. Mismo blindaje que en Tesis: la ruleta nunca puede contener a
    // alguien que ya tiene grupo.
    if (this.alumnoGanadorTemporalNormal) {
      this.alumnosSorteadosNormal.add(this.claveAlumno(this.alumnoGanadorTemporalNormal));
    }
    this.purgarSorteadosNormal();

    // Paso 2: precondiciones (ruleta en reposo, alumnos disponibles, cupo sin completar).
    if (this.girandoNormalAlum || this.alumnosNormal.length === 0 || this.alumnosAsignadosNormal.length >= this.cupoActualNormal) return;
    this.girandoNormalAlum = true;
    
    // DECISIÓN OFICIAL (Web Crypto); la ruleta solo la representa.
    const indice = obtenerIndiceAleatorio(this.alumnosNormal.length);
    this.gradosRotacionNormalAlum = this.calcularRotacionExacta(this.gradosRotacionNormalAlum, this.alumnosNormal.length, indice);
    
    setTimeout(() => {
      this.girandoNormalAlum = false;
      const ganador = this.alumnosNormal[indice];
      if (!ganador) { this.cdr.detectChanges(); return; }

      this.alumnosAsignadosNormal.push(ganador);
      this.alumnosSorteadosNormal.add(this.claveAlumno(ganador));
      this.alumnoGanadorTemporalNormal = ganador;
      
      Swal.fire({ title: 'Alumno Asignado', text: `${ganador.nombre_completo} fue removido de la ruleta.`, icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });

      // Paso 3: grupo completo. Si este grupo absorbió un sobrante, se descuenta.
      if (this.alumnosAsignadosNormal.length >= this.cupoActualNormal) {
        if (this.sobrantesNormal > 0) this.sobrantesNormal--;
        setTimeout(() => Swal.fire('¡Cupo Lleno!', `La terna ha sido completada.`, 'info'), 600);
      }
      this.cdr.detectChanges();
    }, 4000); 
  }

  /**
   * Persiste el grupo conformado (Método Normal) y prepara la siguiente ronda.
   *
   * @description
   *  1. Retira de la ruleta al último alumno ganador, aún retenido.
   *  2. Compone el nombre con el formato que el backend y los reportes esperan:
   *     "Grupo N de Área - Nombre" (Privado) o "Terna #N - Nombre" (Seminario).
   *  3. Envía el lote con una única petición; el backend lo inserta en transacción.
   *  4. Solo si la API confirma: incrementa el contador del área, excluye al
   *     catedrático ya asignado (por nombre) de las ruletas y recalcula el reparto
   *     con los participantes restantes.
   * Si la API falla, el estado local no avanza y el usuario puede reintentar.
   */
  guardarTernaNormal() {
    if (!this.catedraticoGanadorNormal) return;
    if (this.guardandoNormal) return;

    if (this.alumnosAsignadosNormal.length === 0) {
      Swal.fire('Atención', 'Debes sortear al menos un alumno para este grupo.', 'warning');
      return;
    }

    // Cierre del grupo: todos sus alumnos quedan marcados y fuera de la
    // ruleta de forma síncrona, antes de la petición.
    for (const alumno of this.alumnosAsignadosNormal) {
      this.alumnosSorteadosNormal.add(this.claveAlumno(alumno));
    }
    this.purgarSorteadosNormal();

    let nombreFinal = this.catedraticoGanadorNormal.nombre_completo;
    if (this.eventoSeleccionado?.id === 1 && this.areaSeleccionada !== '') { 
      nombreFinal = `Grupo ${this.catedraticoGanadorNormal.id} de ${this.areaSeleccionada} - ${nombreFinal}`; 
    } else {
      nombreFinal = `Terna #${this.catedraticoGanadorNormal.id} - ${nombreFinal}`;
    }

    this.guardandoNormal = true;
    const alumnosEnviados = [...this.alumnosAsignadosNormal];

    this.asignacionService.guardarTerna(nombreFinal, alumnosEnviados, this.eventoSeleccionado.id).subscribe({
      next: () => {
        this.guardandoNormal = false;
        Swal.fire('¡Guardado!', 'Asignación registrada correctamente.', 'success');
        const clave = this.areaSeleccionada || 'General';
        this.contadoresAreas[clave] = (this.contadoresAreas[clave] || 0) + 1;

        // Exclusión del docente ya asignado. En Privado también se elimina de la
        // lista base, que es la que repuebla la ruleta al elegir otra área; así
        // un catedrático no puede encabezar dos grupos en áreas distintas.
        // El registro en el conjunto lo hace además irreversible: `seleccionarArea`
        // repuebla la ruleta desde la base y volvía a incluirlo si el filtro por
        // nombre fallaba (por ejemplo, por diferencias de mayúsculas o espacios).
        if (this.catedraticoGanadorNormal) {
          this.profesoresSorteadosNormal.add(this.claveProfesor(this.catedraticoGanadorNormal));
        }
        this.purgarSorteadosNormal();

        this.catedraticoGanadorNormal = null;
        this.alumnosAsignadosNormal = [];
        this.cupoActualNormal = 0;
        if (this.eventoSeleccionado?.id === 1) { this.areaSeleccionada = ''; }

        this.calcularMatematicaNormal();
        if (this.profesoresNormal.length === 0 || this.alumnosNormal.length === 0) Swal.fire('¡Finalizado!', 'Proceso concluido.', 'success');
        this.cdr.detectChanges();
      },
      // Antes no había manejador de error: un fallo al guardar pasaba
      // inadvertido y el usuario creía que la terna había quedado registrada.
      error: (err) => {
        this.guardandoNormal = false;
        Swal.fire('No se pudo guardar', mensajeParaUsuario(interpretarError(err)), 'error');
        this.cdr.detectChanges();
      }
    });
  }

  // =========================================================
  // METODO TESIS
  // =========================================================
  /**
   * Calcula, una única vez, la distribución del Método Tesis.
   *
   * @description
   *  - `cantidadTernasTesis = ceil(P / 3)`: cada jurado consume tres catedráticos;
   *    se redondea hacia arriba para no dejar docentes fuera del cálculo.
   *  - `cupoBaseTesis = floor(A / T)` y `sobrantesTesis = A mod T`, con la misma
   *    división euclidiana del Método Normal, pero sobre ternas y no catedráticos.
   * Ejemplo: P = 9, A = 20 -> T = 3, q = 6, r = 2 -> grupos de 7, 7 y 6 alumnos.
   *
   * La bandera `matematicaTesisCalculada` fija el reparto inicial; a partir de
   * ahí el avance se controla descontando `sobrantesTesis` al guardar cada terna.
   * La guarda `=== 0` es defensiva: con P > 0, `ceil(P / 3)` nunca vale cero.
   */
  calcularMatematicaTesis(ternasForzadas: number = 3) {
    // Blindaje del divisor: un `ternasForzadas` de 0 o negativo (o un valor no
    // numérico llegado por error) produciría Infinity/NaN en el cupo y dejaría
    // la pantalla mostrando "NaN alumnos por terna".
    const ternasMinimas = Number.isFinite(ternasForzadas) && ternasForzadas > 0
      ? Math.floor(ternasForzadas)
      : 1;

    if (this.alumnosTesis.length > 0) {
      if (!this.matematicaTesisCalculada) {
        if (this.profesoresTesis.length > 0) {
          this.cantidadTernasTesis = Math.ceil(this.profesoresTesis.length / 3);
        } else {
          this.cantidadTernasTesis = ternasMinimas;
        }

        // Con P > 0, `ceil(P / 3)` nunca vale cero; la guarda cubre el resto
        // de caminos y garantiza que el divisor sea siempre >= 1.
        if (!(this.cantidadTernasTesis > 0)) this.cantidadTernasTesis = 1;
        this.cupoBaseTesis = Math.floor(this.alumnosTesis.length / this.cantidadTernasTesis);
        this.sobrantesTesis = this.alumnosTesis.length % this.cantidadTernasTesis;
        this.matematicaTesisCalculada = true;
      }
    } else {
      this.cantidadTernasTesis = ternasMinimas;
      this.cupoBaseTesis = 0;
      this.sobrantesTesis = 0;
    }
    this.cdr.detectChanges();
  }

  /**
   * Sortea un integrante del jurado de tesis.
   *
   * @description Aplica la misma retención diferida que el Método Normal: el
   * catedrático del giro anterior se retira al comenzar este giro. El orden de
   * extracción determina el rol (1.º Presidente, 2.º Vocal 1, 3.º Vocal 2).
   * Al completarse el tercer integrante se fija el cupo de alumnos de la terna:
   * base + 1 si quedan sobrantes por repartir.
   */
  iniciarSorteoTesisCatedratico() {
    // Retirada del ganador del giro anterior y, con ella, de cualquier
    // participante que ya salió en una terna previa. Es la última barrera
    // antes de decidir: lo que quede en la ruleta está realmente disponible.
    if (this.profesorGanadorTemporalTesis) {
      this.profesoresSorteadosTesis.add(this.claveProfesor(this.profesorGanadorTemporalTesis));
    }
    this.purgarSorteadosTesis();

    if (this.alumnosTesis.length === 0) {
      Swal.fire('¡Sorteo Finalizado!', 'Ya no hay alumnos disponibles para conformar más jurados.', 'info'); 
      return; 
    }
    
    if (this.girandoTesisProfe || this.catedraticosTesisAsignados.length >= 3 || this.profesoresTesis.length === 0) return;
    
    this.girandoTesisProfe = true;
    
    // DECISIÓN OFICIAL (Web Crypto); la ruleta solo la representa.
    const indice = obtenerIndiceAleatorio(this.profesoresTesis.length);
    this.gradosRotacionTesisProfe = this.calcularRotacionExacta(this.gradosRotacionTesisProfe, this.profesoresTesis.length, indice);

    setTimeout(() => {
      this.girandoTesisProfe = false;
      const ganador = this.profesoresTesis[indice];
      // Defensa ante un estado inconsistente: si la lista cambió durante los
      // 4 s de animación, el índice podría apuntar fuera del arreglo.
      if (!ganador) { this.cdr.detectChanges(); return; }

      this.catedraticosTesisAsignados.push(ganador);
      // Queda marcado como sorteado en el ACTO: a partir de aquí ninguna
      // purga puede devolverlo a la ruleta, aunque la porción siga visible.
      this.profesoresSorteadosTesis.add(this.claveProfesor(ganador));
      this.profesorGanadorTemporalTesis = ganador;
      
      // Rol por posición: la longitud del jurado tras el `push` (1, 2 o 3)
      // menos uno da el índice del rol correspondiente.
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
        // Mismo acotado que en el jurado designado: el cupo no puede exceder
        // los alumnos que quedan en la ruleta.
        const cupoTeorico = this.cupoBaseTesis + (this.sobrantesTesis > 0 ? 1 : 0);
        this.cupoActualTesis = Math.max(1, Math.min(cupoTeorico, this.alumnosTesis.length));
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

  /**
   * Sortea, de uno en uno, los alumnos que examinará la terna conformada.
   *
   * @description Exige un jurado completo de tres catedráticos. Retira primero
   * al alumno retenido del giro anterior, sortea entre los restantes con
   * probabilidad uniforme y se detiene al alcanzar `cupoActualTesis`.
   */
  iniciarSorteoTesisAlumnoIndividual() {
    // Retirada del ganador retenido y de todo alumno ya sorteado en esta
    // sesión: el nuevo índice se elige solo entre alumnos realmente libres.
    if (this.alumnoGanadorTemporalTesis) {
      this.alumnosSorteadosTesis.add(this.claveAlumno(this.alumnoGanadorTemporalTesis));
    }
    this.purgarSorteadosTesis();

    if (this.catedraticosTesisAsignados.length < 3) { Swal.fire('Atención', 'Debes conformar el jurado de 3 catedráticos primero.', 'warning'); return; }
    if (this.girandoTesisAlum || this.alumnosTesisAsignados.length >= this.cupoActualTesis || this.alumnosTesis.length === 0) return;
    
    this.girandoTesisAlum = true;
    // DECISIÓN OFICIAL (Web Crypto); la ruleta solo la representa.
    const indice = obtenerIndiceAleatorio(this.alumnosTesis.length);
    this.gradosRotacionTesisAlum = this.calcularRotacionExacta(this.gradosRotacionTesisAlum, this.alumnosTesis.length, indice);

    setTimeout(() => {
      this.girandoTesisAlum = false;
      const ganador = this.alumnosTesis[indice];
      if (!ganador) { this.cdr.detectChanges(); return; }

      this.alumnosTesisAsignados.push(ganador);
      // Marcado inmediato: la porción sigue visible hasta el próximo giro,
      // pero el alumno ya no puede volver a ser elegido bajo ningún camino.
      this.alumnosSorteadosTesis.add(this.claveAlumno(ganador));
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

  /**
   * Persiste de forma ATÓMICA la terna de tesis con todo su grupo de alumnos.
   *
   * @description
   *  1. Retira de las ruletas a los últimos ganadores retenidos (catedrático y
   *     alumno): ya forman parte de la terna en curso y no deben volver a salir.
   *  2. Envía UNA sola petición (POST /asignaciones/terna) con el jurado y todos
   *     los alumnos. El backend los inserta en una única transacción MariaDB con
   *     un único `lote_id`: se guarda la terna entera o no se guarda nada.
   *  3. Éxito: se confirma al usuario, se consume un sobrante y se reinicia el
   *     jurado para conformar la siguiente terna.
   *  4. Error (red, 4xx o 5xx): se informa que no se guardaron cambios y el
   *     estado local NO avanza; la terna sigue lista para reintentar el guardado.
   * La bandera `guardandoTesis` impide un doble envío mientras la petición está
   * en curso, que registraría la misma terna dos veces.
   *//**
   * Abre un modal interactivo para ingresar manualmente los 3 jurados
   * designados por Coordinación sin necesidad de cargar un Excel de catedráticos.
   */
  abrirModalJuradoManual() {
    // Fijar el siguiente jurado es una TRANSICIÓN de terna: antes de nada se
    // depura la ruleta con los ya sorteados. Este método nunca vuelve a leer
    // ni a clonar la lista original importada del Excel; opera siempre sobre
    // `alumnosTesis`, que es el remanente vivo del sorteo.
    this.purgarSorteadosTesis();

    if (this.alumnosTesis.length === 0) {
      Swal.fire('Atención', 'No quedan alumnos disponibles para conformar otra terna.', 'warning');
      return;
    }

    if (this.alumnosTesisAsignados.length > 0) {
      Swal.fire('Atención', 'Guarda la terna en curso antes de fijar un jurado nuevo.', 'warning');
      return;
    }

    Swal.fire({
      title: '<strong>Jurado Designado (Terna)</strong>',
      html: `
        <div style="text-align: left; font-family: sans-serif; font-size: 0.95rem;">
          <p style="color: #666; margin-bottom: 15px;">Ingresa los nombres de los 3 catedráticos asignados para esta terna:</p>
          
          <label style="font-weight: bold; color: #003366; display: block; margin-bottom: 4px;">Presidente:</label>
          <input id="swal-presi" class="swal2-input" placeholder="Nombre completo del Presidente" style="margin: 0 0 12px 0; width: 100%; box-sizing: border-box;">
          
          <label style="font-weight: bold; color: #003366; display: block; margin-bottom: 4px;">Vocal 1:</label>
          <input id="swal-vocal1" class="swal2-input" placeholder="Nombre completo del Vocal 1" style="margin: 0 0 12px 0; width: 100%; box-sizing: border-box;">
          
          <label style="font-weight: bold; color: #003366; display: block; margin-bottom: 4px;">Vocal 2:</label>
          <input id="swal-vocal2" class="swal2-input" placeholder="Nombre completo del Vocal 2" style="margin: 0 0 12px 0; width: 100%; box-sizing: border-box;">
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '<i class="fas fa-check"></i> Fijar Jurado',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#003366',
      cancelButtonColor: '#6c757d',
      preConfirm: () => {
        const presi = (document.getElementById('swal-presi') as HTMLInputElement)?.value?.trim();
        const vocal1 = (document.getElementById('swal-vocal1') as HTMLInputElement)?.value?.trim();
        const vocal2 = (document.getElementById('swal-vocal2') as HTMLInputElement)?.value?.trim();

        if (!presi || !vocal1 || !vocal2) {
          Swal.showValidationMessage('Debes ingresar los nombres de los 3 integrantes del jurado.');
          return false;
        }

        if (
          presi.toLowerCase() === vocal1.toLowerCase() ||
          presi.toLowerCase() === vocal2.toLowerCase() ||
          vocal1.toLowerCase() === vocal2.toLowerCase()
        ) {
          Swal.showValidationMessage('Los 3 integrantes del jurado deben ser personas distintas.');
          return false;
        }

        return { presi, vocal1, vocal2 };
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const { presi, vocal1, vocal2 } = result.value;

        this.fijarJuradoDesignado([presi, vocal1, vocal2]);

        Swal.fire({
          title: '¡Jurado Registrado!',
          text: `Terna conformada con éxito.\nCupo asignado: ${this.cupoActualTesis} alumnos.\nProcede a sortear a los estudiantes en la ruleta inferior.`,
          icon: 'success',
          confirmButtonColor: '#003366'
        });
      }
    });
  }

  /**
   * Fija el jurado de la siguiente terna y calcula su cupo de alumnos.
   *
   * @description Es el punto de TRANSICIÓN entre ternas, extraído del diálogo
   * para que la lógica sea verificable sin DOM. No lee ni clona en ningún
   * momento el listado original importado del Excel: el cupo se calcula
   * siempre contra `alumnosTesis`, el remanente vivo del sorteo.
   *
   * @param nombres Los tres integrantes, en orden Presidente, Vocal 1, Vocal 2.
   */
  fijarJuradoDesignado(nombres: [string, string, string]) {
    // Depuración previa: nadie que ya haya salido puede integrar la terna
    // nueva ni seguir en la ruleta de alumnos.
    this.purgarSorteadosTesis();

    this.catedraticosTesisAsignados = nombres.map((nombre) => ({
      nombre_completo: nombre,
    }));

    // Garantiza el cálculo del reparto euclidiano
    this.calcularMatematicaTesis(3);

    // Fija el cupo exacto de alumnos a sortear para esta terna, acotado a los
    // alumnos que REALMENTE quedan: pedir más de los disponibles dejaría el
    // botón de guardar inalcanzable al agotarse la ruleta.
    const cupoTeorico = this.cupoBaseTesis + (this.sobrantesTesis > 0 ? 1 : 0);
    this.cupoActualTesis = Math.max(1, Math.min(cupoTeorico, this.alumnosTesis.length));

    this.alumnosTesisAsignados = [];
    this.cdr.detectChanges();
  }

  /**
   * Permite limpiar el jurado fijado si se cometió un error de digitación
   * antes de iniciar el sorteo de alumnos.
   */
  cancelarJuradoManual() {
    this.catedraticosTesisAsignados = [];
    this.cdr.detectChanges();
  }

  guardarTesisOficial() {
    // Semáforo contra el doble clic: sin él, dos pulsaciones seguidas
    // registran la misma terna en dos lotes distintos.
    if (this.guardandoTesis) return;

    if (this.catedraticosTesisAsignados.length !== 3) {
      Swal.fire('Atención', 'La terna debe tener exactamente 3 catedráticos antes de guardarse.', 'warning');
      return;
    }

    // Con `cupoActualTesis` en 0 (más ternas que alumnos) la plantilla mostraba
    // el botón de guardar sin ningún alumno sorteado y el backend respondía 422.
    if (this.alumnosTesisAsignados.length === 0) {
      Swal.fire('Atención', 'Debes sortear al menos un alumno para esta terna.', 'warning');
      return;
    }

    if (!this.eventoSeleccionado) {
      Swal.fire('Atención', 'Selecciona la modalidad antes de guardar.', 'warning');
      return;
    }

    // ===== CIERRE DEFINITIVO DE LA TERNA (antes de cualquier asincronía) =====
    // Aquí estaba el defecto: el método solo ponía a null
    // `alumnoGanadorTemporalTesis`, en lugar de retirar de la ruleta al alumno
    // que esa variable estaba reteniendo. Ese alumno seguía en `alumnosTesis`
    // y volvía a salir en la terna siguiente ocupando un cupo ajeno; con tres
    // ternas eso dejaba exactamente dos alumnos sin asignar al final.
    //
    // Ahora se registran TODOS los integrantes de la terna en los conjuntos de
    // sorteados y se purga la ruleta de forma síncrona, antes de enviar nada:
    // pase lo que pase con la petición, ninguno puede reaparecer.
    for (const alumno of this.alumnosTesisAsignados) {
      this.alumnosSorteadosTesis.add(this.claveAlumno(alumno));
    }
    for (const profesor of this.catedraticosTesisAsignados) {
      this.profesoresSorteadosTesis.add(this.claveProfesor(profesor));
    }
    this.purgarSorteadosTesis();

    this.guardandoTesis = true;

    // Copia del envío: si el usuario reintenta, se manda exactamente lo que se
    // cerró aquí y no lo que el estado tenga en ese momento.
    const juradoEnviado = [...this.catedraticosTesisAsignados];
    const alumnosEnviados = [...this.alumnosTesisAsignados];

    this.asignacionService
      .guardarTernaTesis(
        juradoEnviado,
        alumnosEnviados,
        this.eventoSeleccionado.id
      )
      .subscribe({
        next: () => {
          this.guardandoTesis = false;
          Swal.fire('¡Guardado!', 'El jurado y su grupo de alumnos han sido registrados correctamente.', 'success');

          // Se consume el sobrante que absorbió esta terna.
          if (this.sobrantesTesis > 0) this.sobrantesTesis--;

          this.alumnosTesisAsignados = [];
          this.catedraticosTesisAsignados = [];
          // El cupo pertenece a la terna que acaba de cerrarse: dejarlo vivo
          // permitiría sortear alumnos para un jurado que todavía no existe.
          this.cupoActualTesis = 0;

          this.calcularMatematicaTesis();
          if (this.alumnosTesis.length === 0) { Swal.fire('¡Finalizado!', 'Todos los tesistas han sido asignados.', 'success'); }
          this.cdr.detectChanges();
        },
        error: (err: any) => {
          this.guardandoTesis = false;
          // La terna NO se limpia: sigue en pantalla para reintentar el envío
          // con los mismos integrantes, que ya están fuera de la ruleta.
          Swal.fire(
            'No se pudo confirmar la terna',
            `No se pudo confirmar la terna, no se guardaron cambios. Puedes reintentar el guardado. ${mensajeParaUsuario(interpretarError(err))}`,
            'error'
          );
          this.cdr.detectChanges();
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