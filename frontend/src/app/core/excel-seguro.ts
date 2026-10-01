/**
 * @fileoverview Validación y normalización de archivos Excel.
 *
 * PREMISA: un archivo subido por el usuario es entrada NO CONFIABLE. Una celda
 * puede contener marcado HTML, fórmulas, miles de caracteres o valores nulos.
 * Todo lo que salga de aquí debe ser texto plano, acotado y con forma conocida,
 * porque después se muestra en pantalla y se envía al backend.
 *
 * Este módulo no conoce Angular ni el DOM: es lógica pura y testeable.
 */

/** Extensiones admitidas. */
const EXTENSIONES_PERMITIDAS = ['.xlsx', '.xls'] as const;

/**
 * Tipos MIME que declaran los navegadores para hojas de cálculo.
 * Se usan solo como señal adicional: el MIME lo propone el cliente y se puede
 * falsear, así que la extensión y el tamaño son los controles que mandan.
 */
const MIME_PERMITIDOS = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  '',
];

/** Tamaño máximo aceptado: 5 MB. Un listado de clase no se acerca a esa cifra. */
export const TAMANO_MAXIMO_BYTES = 5 * 1024 * 1024;

/** Número máximo de filas de datos que se procesan. */
export const MAX_FILAS = 2000;

/** Número máximo de columnas que se leen de cada fila. */
export const MAX_COLUMNAS = 10;

/** Longitud máxima de un campo de texto, alineada con las columnas del backend. */
const MAX_LONGITUD_NOMBRE = 100;
const MAX_LONGITUD_CARNET = 50;

/** Resultado de una validación. */
export interface ResultadoValidacion {
  valido: boolean;
  error?: string;
}

/**
 * Comprueba que el usuario haya seleccionado exactamente un archivo admisible.
 *
 * @param archivos Lista de archivos del input.
 * @returns Resultado con el motivo del rechazo si no es válido.
 */
// Los controles se ordenan del más barato al más costoso y todos se aplican
// sobre metadatos del archivo (nombre, tamaño, tipo), antes de leer su contenido.
export function validarArchivoExcel(archivos: FileList | null): ResultadoValidacion {
  if (!archivos || archivos.length === 0) {
    return { valido: false, error: 'No se seleccionó ningún archivo.' };
  }

  // Un único archivo por carga: evita ambigüedad sobre cuál se procesa.
  if (archivos.length > 1) {
    return { valido: false, error: 'Selecciona un solo archivo a la vez.' };
  }

  const archivo = archivos[0];
  const nombre = (archivo.name || '').toLowerCase();

  const extensionValida = EXTENSIONES_PERMITIDAS.some((ext) => nombre.endsWith(ext));
  if (!extensionValida) {
    return {
      valido: false,
      error: `Formato no admitido. Usa un archivo ${EXTENSIONES_PERMITIDAS.join(' o ')}.`,
    };
  }

  if (archivo.size === 0) {
    return { valido: false, error: 'El archivo está vacío.' };
  }

  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    const mb = (TAMANO_MAXIMO_BYTES / 1024 / 1024).toFixed(0);
    return { valido: false, error: `El archivo supera el tamaño máximo de ${mb} MB.` };
  }

  // El MIME es orientativo: algunos navegadores lo dejan vacío o genérico.
  if (archivo.type && !MIME_PERMITIDOS.includes(archivo.type)) {
    return {
      valido: false,
      error: 'El contenido del archivo no parece una hoja de cálculo válida.',
    };
  }

  return { valido: true };
}

/**
 * Caracteres que se eliminan antes de analizar el contenido de la celda:
 *  - Controles C0 (U+0000–U+001F, incluidos tabulador, CR y LF) y DEL (U+007F).
 *  - Controles C1 (U+0080–U+009F).
 *  - Invisibles de formato (espacios de ancho cero U+200B–U+200D, U+2060 y el
 *    BOM U+FEFF): no los elimina `trim()` y permitirían ocultar un '=' detrás
 *    de un carácter "vacío" que el usuario no ve.
 * Se sustituyen por un espacio (y no por nada) para no pegar palabras que el
 * control separaba; el colapso posterior de espacios los hace desaparecer.
 */
// eslint-disable-next-line no-control-regex -- se eliminan a propósito.
const CARACTERES_INVISIBLES = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Prefijos que una hoja de cálculo interpreta como inicio de fórmula
 * (OWASP "CSV Injection"). El tabulador y el retorno de carro, que OWASP
 * también lista, ya no pueden aparecer al inicio: se eliminan antes.
 */
const PREFIJO_FORMULA = /^[=+\-@]/;

/**
 * Convierte el valor de una celda en texto plano seguro para mostrar y enviar.
 *
 * Qué hace, y por qué:
 *  - Descarta nulos y objetos: una celda puede traer cualquier cosa.
 *  - Elimina caracteres de control e invisibles, que corrompen la vista y los
 *    logs y pueden camuflar un prefijo de fórmula.
 *  - Colapsa espacios y recorta ANTES de comprobar el prefijo de fórmula.
 *  - Neutraliza el prefijo de fórmula (=, +, -, @) anteponiendo un apóstrofo:
 *    si el texto se reexporta a Excel, una celda que empieza por '=' se
 *    ejecutaría como fórmula (inyección de fórmulas / CSV injection).
 *  - Trunca a una longitud máxima.
 *
 * No se escapa HTML aquí a propósito: el valor se entrega como TEXTO. Angular
 * lo interpola de forma segura y los diálogos usan `text:`, nunca `html:`.
 *
 * @param valor Contenido bruto de la celda.
 * @param maxLongitud Longitud máxima resultante.
 * @returns Texto normalizado, posiblemente vacío.
 */
export function normalizarCelda(valor: unknown, maxLongitud = MAX_LONGITUD_NOMBRE): string {
  if (valor === null || valor === undefined) return '';

  // Solo aceptamos primitivas; un objeto o arreglo se considera celda inválida.
  if (typeof valor === 'object') return '';

  // Pipeline de saneamiento. El ORDEN es parte del control de seguridad:
  //  (1) invisibles y controles -> espacio,
  //  (2) colapso de espacios y recorte,
  //  (3) neutralización de fórmulas sobre el texto YA recortado,
  //  (4) truncado.
  // Si (3) se hiciera antes que (2), una celda como "   =SUM(A1:A2)" o
  // "\t+1234" no empezaría por '=' / '+' al comprobarla y el recorte
  // posterior dejaría la fórmula expuesta al inicio.
  let texto = String(valor)
    .replace(CARACTERES_INVISIBLES, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Rompe el prefijo de fórmula anteponiendo un apóstrofo, como hace Excel.
  if (PREFIJO_FORMULA.test(texto)) {
    texto = `'${texto}`;
  }

  // El truncado conserva el inicio de la cadena, así que nunca elimina el
  // apóstrofo recién añadido.
  if (texto.length > maxLongitud) {
    texto = texto.slice(0, maxLongitud);
  }

  return texto;
}

/** Catedrático leído de un Excel, ya normalizado. */
export interface ProfesorExcel {
  id: number;
  nombre_completo: string;
  area: string;
}

/** Alumno leído de un Excel, ya normalizado. */
export interface AlumnoExcel {
  id: number;
  carnet: string;
  nombre_completo: string;
}

/** Resultado de procesar una hoja. */
export interface ResultadoFilas<T> {
  filas: T[];
  descartadas: number;
  truncado: boolean;
}

/**
 * Recorta la matriz de la hoja a un tamaño manejable y descarta filas vacías.
 *
 * @param datos Matriz cruda devuelta por la librería de hojas de cálculo.
 * @returns Filas acotadas en número y en columnas.
 */
function acotarHoja(datos: unknown[][]): { filas: unknown[][]; truncado: boolean } {
  const utiles = (Array.isArray(datos) ? datos : []).filter(
    (fila) => Array.isArray(fila) && fila.length > 0,
  );

  const truncado = utiles.length > MAX_FILAS;

  // Acotamos filas y columnas: una hoja manipulada podría declarar millones de
  // celdas y bloquear la pestaña del navegador.
  const filas = utiles
    .slice(0, MAX_FILAS)
    .map((fila) => fila.slice(0, MAX_COLUMNAS));

  return { filas, truncado };
}

/** Palabras clave que delatan una fila de encabezado. */
const PALABRAS_ENCABEZADO = [
  'nombre',
  'carnet',
  'catedratico',
  'catedrático',
  'docente',
  'alumno',
  'estudiante',
  'area',
  'área',
  'registro',
  'carne',
];

/**
 * Normaliza un título de columna para compararlo: recorta, pasa a minúsculas y
 * elimina las tildes.
 *
 * El `trim()` es imprescindible: un encabezado escrito como `" Carnet "` (con
 * espacios, como los genera la propia plantilla del sistema) no coincidiría
 * con ninguna palabra clave si se comparase en crudo.
 *
 * @param valor Contenido de la celda de encabezado.
 * @returns Texto comparable, posiblemente vacío.
 */
function normalizarTitulo(valor: unknown): string {
  if (typeof valor !== 'string' && typeof valor !== 'number') return '';
  return String(valor)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Indica si un título de columna coincide con alguna palabra clave conocida.
 * @param titulo Título ya normalizado.
 */
function pareceTituloDeColumna(titulo: string): boolean {
  return PALABRAS_ENCABEZADO.some((palabra) => titulo.includes(normalizarTitulo(palabra)));
}

/**
 * Indica si la fila recibida es un encabezado de columnas.
 *
 * @description Antes solo se miraba la PRIMERA celda: una hoja cuyo encabezado
 * empezara por otra columna (p. ej. `Nombre | Carnet`) o que tuviera la
 * primera celda vacía pasaba por fila de datos y el título acababa sorteado
 * como si fuera un alumno.
 *
 * Ahora se miran todas, pero con dos condiciones que evitan el error opuesto
 * (confundir un dato con un título):
 *  - TODAS las celdas con contenido deben parecer títulos. Basta con que una
 *    no lo parezca (un carnet, un nombre propio) para tratar la fila como
 *    datos.
 *  - Un encabezado de una sola columna solo se acepta si está en la primera
 *    posición, como en la plantilla de catedráticos. Así una fila como
 *    `['', 'Sin Carnet']` sigue siendo un dato incompleto que se descarta, y
 *    no un encabezado que se ignora en silencio.
 *
 * @param fila Primera fila de la hoja.
 * @returns true si la fila es un encabezado de columnas.
 */
function esFilaEncabezado(fila: unknown[]): boolean {
  const conContenido: Array<{ titulo: string; indice: number }> = [];

  fila.forEach((celda, indice) => {
    const titulo = normalizarTitulo(celda);
    if (titulo) conContenido.push({ titulo, indice });
  });

  if (conContenido.length === 0) return false;
  if (!conContenido.every(({ titulo }) => pareceTituloDeColumna(titulo))) return false;

  return conContenido.length > 1 || conContenido[0].indice === 0;
}

/** Posición de cada dato dentro de la fila. */
interface MapaColumnas {
  carnet: number;
  nombre: number;
}

/**
 * Deduce en qué columna está cada dato a partir del encabezado.
 *
 * @description Resuelve el caso de las columnas en orden distinto: si el
 * encabezado dice `Nombre | Carnet`, el carnet se lee de la columna 1 y el
 * nombre de la 0. Sin esto, la lista entera quedaba invertida (nombres en el
 * campo del carnet) y el acta salía ilegible.
 *
 * Cuando la hoja no trae encabezado, o sus títulos no se reconocen, se
 * conserva el orden histórico: carnet en la primera columna, nombre en la
 * segunda.
 *
 * @param encabezado Fila de títulos, o null si la hoja no la tiene.
 * @returns Índices de columna a usar.
 */
function deducirColumnasAlumno(encabezado: unknown[] | null): MapaColumnas {
  const mapa: MapaColumnas = { carnet: 0, nombre: 1 };
  if (!encabezado) return mapa;

  let carnet = -1;
  let nombre = -1;

  encabezado.forEach((celda, indice) => {
    const titulo = normalizarTitulo(celda);
    if (!titulo) return;

    // "carne" cubre también "carné" una vez quitadas las tildes.
    if (carnet === -1 && (titulo.includes('carnet') || titulo.includes('carne') || titulo.includes('registro'))) {
      carnet = indice;
      return;
    }
    if (nombre === -1 && (titulo.includes('nombre') || titulo.includes('alumno') || titulo.includes('estudiante'))) {
      nombre = indice;
    }
  });

  if (carnet !== -1) mapa.carnet = carnet;
  if (nombre !== -1) mapa.nombre = nombre;

  // Si ambos títulos apuntasen a la misma columna, el nombre se toma de la
  // siguiente para no duplicar el mismo valor en los dos campos.
  if (mapa.carnet === mapa.nombre) mapa.nombre = mapa.carnet + 1;

  return mapa;
}

/**
 * Deduce en qué columna está el nombre del catedrático.
 * @param encabezado Fila de títulos, o null si la hoja no la tiene.
 * @returns Índice de la columna del nombre.
 */
function deducirColumnaProfesor(encabezado: unknown[] | null): number {
  if (!encabezado) return 0;

  const indice = encabezado.findIndex((celda) => {
    const titulo = normalizarTitulo(celda);
    return (
      Boolean(titulo) &&
      (titulo.includes('nombre') || titulo.includes('catedratico') || titulo.includes('docente'))
    );
  });

  return indice === -1 ? 0 : indice;
}

/**
 * Separa el encabezado (si existe) del cuerpo de datos.
 *
 * @param filas Filas ya acotadas.
 * @returns Encabezado detectado y filas de datos.
 */
function separarEncabezado(filas: unknown[][]): {
  encabezado: unknown[] | null;
  datos: unknown[][];
} {
  if (filas.length === 0) return { encabezado: null, datos: filas };

  if (esFilaEncabezado(filas[0])) {
    return { encabezado: filas[0], datos: filas.slice(1) };
  }

  return { encabezado: null, datos: filas };
}

/**
 * Convierte una hoja en la lista de catedráticos del sorteo.
 * Se espera una columna: nombre.
 *
 * @param datos Matriz cruda de la hoja.
 * @returns Catedráticos normalizados y recuento de filas descartadas.
 */
export function extraerProfesores(datos: unknown[][]): ResultadoFilas<ProfesorExcel> {
  const { filas, truncado } = acotarHoja(datos);
  const { encabezado, datos: cuerpo } = separarEncabezado(filas);
  const columnaNombre = deducirColumnaProfesor(encabezado);

  const validas: ProfesorExcel[] = [];
  const nombresVistos = new Set<string>();
  let descartadas = 0;

  for (const fila of cuerpo) {
    // Se prueba primero la columna deducida del encabezado y, si esa celda
    // está vacía, la primera columna con contenido: así una hoja con una
    // columna de numeración a la izquierda tampoco se pierde.
    let nombre = normalizarCelda(fila[columnaNombre], MAX_LONGITUD_NOMBRE);
    if (!nombre) {
      const alternativa = fila.find((celda) => normalizarCelda(celda, MAX_LONGITUD_NOMBRE) !== '');
      nombre = normalizarCelda(alternativa, MAX_LONGITUD_NOMBRE);
    }

    // Una fila sin nombre no representa a nadie: se descarta y se informa.
    if (!nombre) {
      descartadas++;
      continue;
    }

    // Un catedrático repetido en la hoja aparecería dos veces en la ruleta y
    // podría integrar dos jurados distintos. Se conserva la primera aparición.
    const clave = nombre.toLowerCase();
    if (nombresVistos.has(clave)) {
      descartadas++;
      continue;
    }
    nombresVistos.add(clave);

    // El `id` se deriva de las filas VÁLIDAS (no del número de fila del Excel),
    // lo que garantiza una secuencia 1..n contigua y sin huecos ni duplicados.
    validas.push({
      id: validas.length + 1,
      nombre_completo: nombre,
      area: '',
    });
  }

  return { filas: validas, descartadas, truncado };
}

/**
 * Convierte una hoja en la lista de alumnos del sorteo.
 * Se esperan dos columnas: carnet y nombre.
 *
 * @param datos Matriz cruda de la hoja.
 * @returns Alumnos normalizados y recuento de filas descartadas.
 */
export function extraerAlumnos(datos: unknown[][]): ResultadoFilas<AlumnoExcel> {
  const { filas, truncado } = acotarHoja(datos);
  const { encabezado, datos: cuerpo } = separarEncabezado(filas);
  const columnas = deducirColumnasAlumno(encabezado);

  const validas: AlumnoExcel[] = [];
  const carnetsVistos = new Set<string>();
  let descartadas = 0;

  for (const fila of cuerpo) {
    const carnet = normalizarCelda(fila[columnas.carnet], MAX_LONGITUD_CARNET);

    // El carnet es el identificador del alumno: sin él la fila no sirve.
    if (!carnet) {
      descartadas++;
      continue;
    }

    // Un carnet repetido sacaría al mismo alumno dos veces en la ruleta y, al
    // guardar una terna de tesis, el backend rechazaría el lote completo con
    // un 422 por carnet duplicado. Se conserva la primera aparición.
    const clave = carnet.toLowerCase();
    if (carnetsVistos.has(clave)) {
      descartadas++;
      continue;
    }
    carnetsVistos.add(clave);

    // El nombre sí admite un valor por defecto, como en la versión anterior.
    const nombre = normalizarCelda(fila[columnas.nombre], MAX_LONGITUD_NOMBRE) || 'Desconocido';

    validas.push({
      id: validas.length + 1,
      carnet,
      nombre_completo: nombre,
    });
  }

  return { filas: validas, descartadas, truncado };
}
