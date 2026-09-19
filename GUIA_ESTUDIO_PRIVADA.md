# Guía de estudio privada — Defensa de tesis

> **Sistema de Asignación Académica por Ruleta (UMG)**
> Angular 21 (standalone + Signals) · Node.js ≥ 20 · Express 5 · MariaDB (mysql2) · JWT · bcryptjs · Zod 4 · SheetJS
>
> Documento personal. Está en `.gitignore`: **no se versiona ni se sube a ningún repositorio.**
> Los números de línea corresponden al código tal como quedó tras la documentación JSDoc/TSDoc.

---

## Índice

- [0. La arquitectura en 60 segundos](#0-la-arquitectura-en-60-segundos)
- [A. El recorrido del dato (trazabilidad)](#a-el-recorrido-del-dato-trazabilidad)
  - [A.1 Login](#a1-login-del-submit-en-angular-a-la-firma-del-jwt)
  - [A.2 Carga y procesamiento del Excel](#a2-carga-y-procesamiento-del-excel)
  - [A.3 Sorteo y guardado en la base de datos](#a3-ejecución-del-sorteo-y-guardado-en-mariadb)
- [B. Desglose del algoritmo matemático (`sorteo.ts`)](#b-desglose-del-algoritmo-matemático-sorteots)
- [C. Mapa rápido: "Si el tribunal me pide abrir…"](#c-mapa-rápido-si-el-tribunal-me-pide-abrir)
- [D. Glosario técnico de defensa](#d-glosario-técnico-de-defensa)
- [E. Simulacro de preguntas difíciles](#e-simulacro-de-preguntas-difíciles-del-tribunal)
- [F. Limitaciones conocidas (para que no te sorprendan)](#f-limitaciones-conocidas-para-que-no-te-sorprendan)
- [G. Cifras y datos para memorizar](#g-cifras-y-datos-para-memorizar)

---

## 0. La arquitectura en 60 segundos

Si solo tienes un minuto para explicar el sistema, di esto:

> "Es una SPA en Angular que consume una API REST en Express organizada en capas. El **frontend** lee los Excel en el navegador, los sanea y ejecuta el sorteo. El **backend** no confía en nada de lo que recibe: autentica con JWT, autoriza por rol, valida cada petición con esquemas Zod estrictos y persiste en MariaDB a través de repositorios con consultas parametrizadas y transacciones. Toda operación sensible queda en un log de auditoría con identificador de petición."

```
┌───────────────────────── FRONTEND (Angular) ─────────────────────────┐
│ pages/ (componentes)  →  services/ (HTTP)  →  interceptors/ (token)  │
│ guards/ (UX de rutas)    core/ (Excel seguro, errores)  models/ (TS) │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS · JSON · Authorization: Bearer
┌───────────────────────────────▼──────────── BACKEND (Express) ───────┐
│ app.js: requestId → helmet → cors → json(10kb) → morgan → rateLimit  │
│ routes/      qué URL y qué cadena de middlewares                     │
│ middlewares/ requireAuth · requireRole · validate · errorHandler     │
│ controllers/ HTTP ⇄ servicio (req/res NO pasan de aquí)              │
│ services/    reglas de negocio + auditoría                           │
│ repositories/ ÚNICA capa con SQL (placeholders ?)                    │
│ config/db.js pool mysql2                                             │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
                     MariaDB: roles · usuarios · tipos_evento · asignaciones
```

**Regla de oro de las dependencias:** cada capa solo conoce a la inmediatamente inferior. Los controladores no ven SQL; los repositorios no ven `req`/`res`.

---

## A. El recorrido del dato (trazabilidad)

### A.1 Login: del submit en Angular a la firma del JWT

> Los tiempos son **orientativos** (orden de magnitud), no mediciones. El paso dominante es bcrypt, diseñado deliberadamente para ser lento.

#### Fase 1 — Navegador (Angular)

| # | Capa | Archivo : línea | Qué ocurre |
|---|------|-----------------|------------|
| 1 | Vista | `frontend/src/app/pages/login/login.html:10` | `<form (ngSubmit)="onLogin()">`. Los campos están enlazados con `[(ngModel)]` a `email` y `password`. |
| 2 | Componente | `pages/login/login.ts:62` `onLogin()` | Limpia `errorMessage`. Si falta un campo, corta. |
| 3 | Componente | `login.ts` (misma función) | Normaliza el correo (`trim().toLowerCase()`) y comprueba dominio `@miumg.edu.gt` / `@umg.edu.gt`. **Es ayuda de UX, no seguridad.** Pone `cargando = true` (evita doble envío). |
| 4 | Servicio | `services/auth.ts:66` `login()` | `http.post('<apiUrl>/auth/login', {email, password})`. Devuelve un Observable **frío**: aún no se envía nada hasta el `subscribe`. |
| 5 | Interceptor | `interceptors/auth-interceptor.ts:54` | `esPeticionALaApi()` (línea 27) compara **origen** resuelto con `new URL`. Como aún no hay token, la petición sale sin `Authorization`. |
| 6 | Navegador | — | Origen `localhost:4200` → `localhost:3000` es *cross-origin* y `Content-Type: application/json` no es "simple" ⇒ el navegador envía primero un **preflight `OPTIONS`**. |

#### Fase 2 — Servidor (Express)

| # | Capa | Archivo : línea | Qué ocurre |
|---|------|-----------------|------------|
| 7 | Middleware | `backend/src/middlewares/requestId.js:20` | Genera un UUID v4 → `req.id` y cabecera `X-Request-Id`. |
| 8 | Middleware | `backend/src/app.js:89` (helmet) | Añade cabeceras defensivas (CSP, nosniff, HSTS, `Referrer-Policy: no-referrer`…). |
| 9 | Middleware | `app.js:106` `cors(corsOptions)` → función `origin` en `app.js:50` | Origen en la lista blanca `CORS_ORIGINS` ⇒ para el `OPTIONS` responde **204** con `Access-Control-Allow-*` y `Max-Age: 600`. El navegador lanza entonces el `POST` real, que repite los pasos 7-9. |
| 10 | Middleware | `app.js:110` `express.json({limit: '10kb'})` | Parsea el JSON. Si pesa > 10 kB → error `entity.too.large` → 413. |
| 11 | Middleware | `app.js:137` `apiLimiter` | Límite general por IP (300 / 15 min por defecto). |
| 12 | Enrutador | `routes/index.js:22` → `routes/auth.routes.js:50` | `/api/v1` + `/auth` + `/login`. |
| 13 | Middleware | `middlewares/rateLimit.js:63` `loginLimiter` | 10 intentos fallidos / 15 min por IP (`skipSuccessfulRequests`). |
| 14 | Middleware | `middlewares/validate.js:31` + `validators/auth.validators.js:20` | Zod: `trim`, `toLowerCase`, formato email, máx. 100; contraseña 1-128. `.strict()` rechaza campos extra. Error → **422**. |
| 15 | Controlador | `controllers/auth.controller.js:24` | Llama al servicio con `req.body` ya saneado y el contexto `{ip, requestId}`. |
| 16 | Servicio | `services/auth.service.js:79` `login()` | Orquesta los tres pasos siguientes. |
| 17 | Repositorio | `repositories/usuarios.repository.js:27` `buscarPorEmailConHash` | `SELECT u.id, u.username, u.email, u.password_hash, u.rol_id, r.nombre AS rol_nombre FROM usuarios u LEFT JOIN roles r ... WHERE u.email = ? LIMIT 1`. El `?` lo sustituye mysql2 escapando el valor. |
| 18 | BD | `config/db.js:22` pool → **MariaDB** | Se toma una conexión del pool, se ejecuta y se devuelve. Resultado: la fila o `null`. |
| 19 | Utilidad | `utils/password.js:56` `verificarPassword` | `esHashBcrypt` (línea 20) exige 60 caracteres y prefijo `$2a$/$2b$/$2y$`; si no, `false` (bloquea contraseñas heredadas en claro). Después `bcrypt.compare`: extrae sal y coste del hash guardado, recalcula y compara. **≈ cientos de ms** con coste 12. |
| 20 | Servicio | `auth.service.js` | Si falla: auditoría `LOGIN_FALLIDO` y `AppError.unauthorized("Correo o contraseña incorrectos")` — mismo mensaje exista o no el correo. |
| 21 | Servicio | `auth.service.js:29` `firmarToken` | `jwt.sign({sub, email, rol, rol_id}, JWT_SECRET, {expiresIn: '8h', issuer})` → HS256. La librería añade `iat` y `exp`. |
| 22 | DTO | `dtos/usuario.dto.js:14` `aUsuarioDTO` | Lista blanca de campos: `password_hash` no puede salir. |
| 23 | Utilidad | `utils/respuesta.js` `ok()` | `{ success: true, data: { token, expiresIn, user } }` → **HTTP 200**. |

#### Fase 3 — Vuelta al navegador

| # | Capa | Archivo : línea | Qué ocurre |
|---|------|-----------------|------------|
| 24 | Servicio | `services/auth.ts` (`map` + `tap`) | `map` desenvuelve `data`; `tap` llama a `guardarSesion` (línea 137): `localStorage` (`auth_token`, `auth_session`) + `signal.set()`. |
| 25 | Componente | `login.ts` `next:` | `cargando=false`, borra la contraseña de memoria, `navigateByUrl(redirigir ?? '/dashboard')`. |
| 26 | Guard | `guards/auth-guard.ts:24` | `estaAutenticado()` → hay token ⇒ `true`. Se renderiza el Dashboard. |
| 27 | Siguiente petición | `auth-interceptor.ts:67` | Ahora sí: `req.clone({ setHeaders: { Authorization: 'Bearer <jwt>' } })`. |
| 28 | Backend | `middlewares/auth.js:53` `requireAuth` | `extraerToken` (línea 24) → `verificarToken` (`auth.service.js:51`) recalcula la firma HMAC, valida `exp` e `iss` → `req.user = {id, email, rol, rol_id}`. **Sin tocar la BD.** |

#### Camino de error (credenciales incorrectas)

`AuthService.login` lanza 401 → `asyncHandler` lo pasa a `next(err)` → `errorHandler.js:85` → `normalizar` lo reconoce como `AppError` → `fail("UNAUTHORIZED", mensaje, undefined, requestId)` → **401** → en Angular el interceptor ve `status === 401` (línea 74), llama a `logout()` y navega a `/login` → relanza el error → `login.ts` muestra "Correo o contraseña incorrectos".

---

### A.2 Carga y procesamiento del Excel

> **Idea clave para la defensa:** el Excel **nunca se sube al servidor**. Se procesa íntegramente en el navegador. Al backend solo llegan los resultados del sorteo, y el backend los vuelve a validar (defensa en profundidad).

| # | Capa | Archivo : línea | Qué ocurre |
|---|------|-----------------|------------|
| 1 | Vista | `pages/sorteo/sorteo.html:47` / `:54` | `<input type="file" (change)="leerExcel($event, 'profesores' | 'alumnos')" accept=".xlsx, .xls">`. |
| 2 | Componente | `pages/sorteo/sorteo.ts:266` `leerExcel()` | Punto de entrada. |
| 3 | Utilidad pura | `core/excel-seguro.ts:54` `validarArchivoExcel` (llamada en `sorteo.ts:270`) | Sobre **metadatos**, antes de leer un byte: exactamente 1 archivo · extensión `.xlsx/.xls` · tamaño > 0 · ≤ 5 MB · MIME permitido (señal secundaria, falsificable). |
| 4 | Componente | `sorteo.ts` | `normalizarCelda(file.name, 255)` y control de **archivo duplicado** (mismo nombre en ambas listas). |
| 5 | Navegador | `sorteo.ts` (`new FileReader`) | Registra `onerror` y `onload` (línea 293) y dispara `readAsBinaryString` (línea 407). Lectura **asíncrona**. |
| 6 | Librería | `sorteo.ts:298` `XLSX.read(bstr, {type:'binary'})` | Parseo dentro de `try/catch`: un archivo manipulado no rompe la app. |
| 7 | Librería | `sorteo.ts:311` `sheet_to_json(ws, {header: 1})` | Primera hoja → matriz `unknown[][]` (el tipo `unknown` obliga a validar). |
| 8 | Utilidad | `excel-seguro.ts:219` `extraerProfesores` / `:254` `extraerAlumnos` | Delegan en los tres pasos siguientes. |
| 9 | Utilidad | `excel-seguro.ts:171` `acotarHoja` | Descarta filas vacías; recorta a **2 000 filas** y **10 columnas** (anti-DoS del navegador). Marca `truncado`. |
| 10 | Utilidad | `excel-seguro.ts:192` `quitarEncabezado` | Heurística: si la primera celda contiene "nombre", "carnet", "catedratico", "area"… es encabezado y se elimina. |
| 11 | Utilidad | `excel-seguro.ts:113` `normalizarCelda` | Por celda: nulos/objetos → `''` · caracteres de control → espacio · prefijo `= + - @` → antepone `'` (línea 131, **anti inyección de fórmulas**) · colapsa espacios · trunca (100 nombre / 50 carnet). |
| 12 | Utilidad | `excel-seguro.ts` | Profesor sin nombre o alumno sin carnet → `descartadas++`. Alumno sin nombre → `'Desconocido'`. `id = validas.length + 1` (secuencia 1..n contigua). |
| 13 | Componente | `sorteo.ts:418` `avisarFilasIgnoradas` | Avisa de filas descartadas o truncado, para que nadie sortee con menos participantes sin saberlo. |
| 14 | Componente | `sorteo.ts` (rama por modalidad) | **Tesis (id 3):** `profesoresTesis`/`alumnosTesis`, baja `matematicaTesisCalculada` y llama a `calcularMatematicaTesis`. **Privado (id 1):** guarda `profesoresBaseNormal` y espera a `seleccionarArea`. **Seminario (id 2):** Fisher-Yates de identificadores (líneas 365-369) y `calcularMatematicaNormal`. |

**Por qué no se escapa HTML en `normalizarCelda`:** los valores se tratan como **texto**. Angular interpola `{{ }}` escapando automáticamente, y los diálogos SweetAlert usan `text:` y nunca `html:` (ver comentario en `sorteo.ts`, método `iniciarSorteoTesisCatedratico`). Escapar dos veces mostraría `&lt;` en pantalla.

---

### A.3 Ejecución del sorteo y guardado en MariaDB

#### Método Normal (Privado / Seminario) — relación 1 catedrático : N alumnos

| # | Archivo : línea | Qué ocurre |
|---|-----------------|------------|
| 1 | `sorteo.ts:551` `seleccionarArea` *(solo Privado)* | Bloqueada si hay ganador sin guardar. Restaura `profesoresNormal` desde la base, Fisher-Yates (557-561) y `calcularMatematicaNormal`. |
| 2 | `sorteo.ts:579` `calcularMatematicaNormal` | `cupoBase = floor(A/P)` (581), `sobrantes = A mod P` (582). |
| 3 | `sorteo.ts:601` `iniciarSorteoCatedraticosNormal` | Guardas → `indice = floor(random·n)` (613) → `calcularRotacionExacta` → CSS gira 4 s → `setTimeout(4000)` fija el ganador, número de grupo correlativo y `cupoActual = base + (sobrantes>0 ? 1 : 0)` (628). |
| 4 | `sorteo.ts:649` `iniciarSorteoAlumnosNormal` (repetido) | Retira al ganador temporal anterior (`splice`, 653) → sortea (661) → `push` a `alumnosAsignadosNormal` → al llenar el cupo, `sobrantes--`. |
| 5 | `sorteo.ts:694` `guardarTernaNormal` | Retira al último retenido, compone `"Grupo N de Área - Nombre"` o `"Terna #N - Nombre"` y llama al servicio (710). |
| 6 | `services/asignacion.ts:45` `guardarTerna` | Cuerpo `{es_tesis:false, profesor_nombre, alumnos:[{carnet, nombre_completo}], tipo_evento_id}`. `aAlumnoAsignacion` (148) elimina campos auxiliares (`id`). |
| 7 | `auth-interceptor.ts:67` | Añade `Authorization: Bearer`. |

#### Método Tesis — relación 3 catedráticos : N alumnos

| # | Archivo : línea | Qué ocurre |
|---|-----------------|------------|
| 1 | `sorteo.ts:756` `calcularMatematicaTesis` | **Una sola vez**: `T = ceil(P/3)` (758), `cupoBase = floor(A/T)` (760), `sobrantes = A mod T` (761). |
| 2 | `sorteo.ts:776` `iniciarSorteoTesisCatedratico` ×3 | Retira retenido (780) → sortea (793) → rol por posición: Presidente, Vocal 1, Vocal 2. Al 3.º: `cupoActualTesis = base + (sobrantes>0?1:0)` (819). |
| 3 | `sorteo.ts:839` `iniciarSorteoTesisAlumnoIndividual` ×cupo | Exige jurado completo, retira retenido (843), sortea (851). |
| 4 | `sorteo.ts:900` `guardarTesisOficial` | Retira retenidos (905, 911). **Un POST por alumno** (919), en paralelo; contador `guardados`. Al completar todas: `sobrantesTesis--` y reinicio del jurado. |
| 5 | `services/asignacion.ts:74` `guardarTesis` | Cuerpo `{es_tesis:true, alumno:{carnet, nombre_completo}, profesores:[3 × {nombre_completo}], tipo_evento_id}`. |

#### Backend — `POST /api/v1/asignaciones` (común a ambos métodos)

| # | Capa | Archivo : línea | Qué ocurre |
|---|------|-----------------|------------|
| 1 | Middleware | `app.js:137` `apiLimiter` | Límite de tasa general. |
| 2 | Middleware | `routes/asignaciones.routes.js:22` `router.use(requireAuth)` | Token válido o 401. |
| 3 | Middleware | `asignaciones.routes.js:121` `requireRole(ROLES.ADMIN)` (`auth.js:88`) | Rol del token ≠ `admin` ⇒ auditoría `ACCESO_DENEGADO` + **403**. |
| 4 | Middleware | `validate({ body: crearAsignacionSchema })` → `validators/asignaciones.validators.js:84` | **Unión discriminada** por `es_tesis`. Tesis: `profesores.length === 3`. Terna: 1..`MAX_ALUMNOS_POR_LOTE` (100). Textos con `trim` y máximos 50/100 alineados con las columnas. `.strict()`. Error → **422**. |
| 5 | Controlador | `controllers/asignaciones.controller.js:49` `crear` | `AsignacionesService.registrar(req.body, contextoAuditoria(req))`. |
| 6 | Servicio | `services/asignaciones.service.js:63` `registrar` | `resolverTipoEvento` (34): el enviado o 3/1 por defecto. `asegurarModalidadValida` (45) → `TiposEventoRepository.existe` (`SELECT id FROM tipos_evento WHERE id = ? LIMIT 1`) o **422**. Repite las reglas de 3 catedráticos / tope de lote (defensa en profundidad). |
| 7 | Repositorio | `repositories/asignaciones.repository.js:83` `crearAsignacionesTerna` / `:35` `crearAsignacionesTesis` | `pool.getConnection()` → `beginTransaction()` → bucle de `INSERT INTO asignaciones (profesor_nombre, alumno_carnet, alumno_nombre, tipo_evento_id) VALUES (?, ?, ?, ?)` → `commit()`. Si algo falla: `rollback()` y relanza. `finally`: `release()`. En tesis, `profesor_nombre = "Nombre (Presidente|Vocal 1|Vocal 2)"`. |
| 8 | BD | MariaDB | `fecha_asignacion` la pone `DEFAULT CURRENT_TIMESTAMP`. Las FK (`tipo_evento_id → tipos_evento.id`) se validan en el motor. |
| 9 | Servicio | `asignaciones.service.js` | `logger.auditoria({accion: "ASIGNACIONES_CREADAS", usuarioId, ip, requestId, detalles})`. |
| 10 | Controlador | `asignaciones.controller.js` | **201** `{ success: true, data: { registros, tipo_evento_id, modo } }`. |
| 11 | Frontend | `sorteo.ts` `next:` | Solo tras la confirmación: contador de área, exclusión del catedrático, recálculo. Si hay error, el estado local **no avanza** (se puede reintentar). |

---

## B. Desglose del algoritmo matemático (`sorteo.ts`)

### B.1 Fundamento: la división euclidiana

Para dos enteros A (alumnos) y G (grupos) con G > 0 existen **únicos** q y r tales que:

```
A = G · q + r        con 0 ≤ r < G
q = floor(A / G)     ← cupoBase
r = A mod G          ← sobrantes
```

**Estrategia de reparto:** todos los grupos reciben q; los r alumnos sobrantes se entregan **de uno en uno** a los primeros r grupos sorteados. Resultado:

- La suma cuadra exactamente: `r·(q+1) + (G−r)·q = G·q + r = A`. ✔
- **Ningún grupo difiere de otro en más de 1 alumno** (es el reparto de máxima equidad posible con enteros).

**Por qué no simplemente `Math.round(A/G)`:** con A=10, G=3 daría 3 por grupo = 9 → queda un alumno sin asignar. Con `ceil` daría 4·3 = 12 → sobran plazas y el último grupo quedaría con 2. La división euclidiana es la única que garantiza suma exacta y diferencia máxima de 1.

### B.2 Método Normal — `calcularMatematicaNormal()` (línea 579)

```ts
if (this.profesoresNormal.length > 0 && this.alumnosNormal.length > 0) {   // evita dividir entre 0
  this.cupoBaseNormal  = Math.floor(this.alumnosNormal.length / this.profesoresNormal.length); // q
  this.sobrantesNormal = this.alumnosNormal.length % this.profesoresNormal.length;             // r
} else { this.cupoBaseNormal = 0; this.sobrantesNormal = 0; }
```

Y al elegir catedrático (línea 628):

```ts
this.cupoActualNormal = this.cupoBaseNormal + (this.sobrantesNormal > 0 ? 1 : 0);
```

**Particularidad:** tras cada guardado se **recalcula con los restantes** (alumnos y catedráticos que quedan). Es matemáticamente equivalente al reparto global:

| Ronda | Alumnos restantes | Catedráticos restantes | q | r | Cupo del grupo |
|:-----:|:-----------------:|:----------------------:|:-:|:-:|:--------------:|
| 1 | 17 | 5 | 3 | 2 | **4** |
| 2 | 13 | 4 | 3 | 1 | **4** |
| 3 | 9 | 3 | 3 | 0 | **3** |
| 4 | 6 | 2 | 3 | 0 | **3** |
| 5 | 3 | 1 | 3 | 0 | **3** |
| | | | | **Total** | **17** ✔ |

El `sobrantesNormal--` que ocurre al llenarse el cupo (en `iniciarSorteoAlumnosNormal`) actualiza la vista inmediatamente; el recálculo posterior al guardado confirma el mismo valor.

### B.3 Método Tesis — `calcularMatematicaTesis()` (línea 756)

```ts
if (!this.matematicaTesisCalculada && P > 0 && A > 0) {
  this.cantidadTernasTesis = Math.ceil(P / 3);        // T: cada jurado consume 3 docentes
  if (this.cantidadTernasTesis === 0) this.cantidadTernasTesis = 1;  // defensivo (inalcanzable si P>0)
  this.cupoBaseTesis  = Math.floor(A / T);            // q
  this.sobrantesTesis = A % T;                        // r
  this.matematicaTesisCalculada = true;               // se calcula UNA vez
}
```

- Aquí los "grupos" son **ternas**, no catedráticos.
- **No se recalcula** tras cada guardado (bandera). En su lugar se consume `sobrantesTesis--` al guardar cada terna, y el cupo de la terna en curso se fija al completarse el 3.er catedrático (línea 819).
- La bandera se baja solo cuando se carga una **nueva lista de catedráticos**.

**Ejemplo:** P = 9, A = 20 → T = 3, q = 6, r = 2 → ternas de **7, 7 y 6** (= 20 ✔).

**¿Por qué `ceil` y no `floor` para las ternas?** Para que ningún docente quede fuera del cálculo. **Pero ojo** (ver sección F): si P no es múltiplo de 3, la última terna no puede completarse.

### B.4 Selección del ganador: probabilidad uniforme

```ts
const indice = Math.floor(Math.random() * lista.length);   // líneas 613, 661, 793, 851
```

- `Math.random()` ∈ [0, 1). Al multiplicar por n se obtiene [0, n); `floor` produce {0, 1, …, n−1}.
- Cada entero corresponde a un subintervalo de longitud 1/n ⇒ **P(índice = k) = 1/n**.
- No existe el "sesgo de módulo" típico de `rand() % n` con enteros, porque se parte de un real uniforme (el sesgo residual por la resolución de 2⁵³ del double es despreciable).
- **Esto es lo que determina la equidad del sorteo.** Cada selección equivale, de hecho, a un paso del algoritmo de Fisher-Yates: elegir uniformemente uno de los elementos restantes y retirarlo.

### B.5 Fisher-Yates (variante Durstenfeld) — líneas 365-369 y 557-561

```ts
let numerosDisponibles = Array.from({length: n}, (_, i) => i + 1);   // [1, 2, …, n]
for (let i = numerosDisponibles.length - 1; i > 0; i--) {             // de la última a la 2.ª posición
    const j = Math.floor(Math.random() * (i + 1));                    // j uniforme en [0, i]
    [numerosDisponibles[i], numerosDisponibles[j]] = [numerosDisponibles[j], numerosDisponibles[i]]; // swap
}
this.profesoresNormal = base.map((p, index) => ({ ...p, id: numerosDisponibles[index] }));
```

**Qué hace exactamente en este sistema** (dilo con precisión, el tribunal puede abrir el código):
asigna a cada catedrático un **identificador interno aleatorio, único y sin colisiones** (una permutación de 1..n). La ruleta muestra el **nombre**, no ese número; y cuando un catedrático gana, su `id` se sustituye por el **número de grupo correlativo** (línea 623). La equidad del sorteo la da la selección uniforme por índice (B.4); Fisher-Yates garantiza que la numeración interna tampoco introduzca ningún orden predecible.

#### Por qué es correcto (demostración)

- En la iteración i hay (i+1) elecciones posibles de j.
- Número total de ejecuciones distintas: `n · (n−1) · … · 2 = n!`
- Cada ejecución produce una permutación **distinta** y existen exactamente n! permutaciones ⇒ **biyección** ⇒ cada permutación tiene probabilidad **1/n!**. Uniforme.
- Complejidad: **O(n)** tiempo, **O(1)** memoria adicional (intercambio in-situ).

#### Por qué NO `array.sort(() => Math.random() - 0.5)`

Respuesta formal en tres argumentos:

1. **Viola el contrato del comparador.** ECMAScript exige que la función de comparación sea *consistente* (misma respuesta para el mismo par) y transitiva. Un comparador aleatorio no lo es; la especificación declara entonces el orden resultante **"implementation-defined"**: depende del algoritmo interno del motor (TimSort en V8, otro en SpiderMonkey). El resultado no es portable ni auditable.

2. **Es matemáticamente imposible que sea uniforme** (argumento de conteo):
   - Un sort basado en comparaciones con k comparaciones aleatorias binarias tiene **2ᵏ** caminos equiprobables.
   - Para que las n! permutaciones fueran equiprobables, n! debería dividir a 2ᵏ.
   - Para n ≥ 3, n! es múltiplo de 3, y **ninguna potencia de 2 es múltiplo de 3**. ⇒ Imposible. ∎
   - En la práctica, los elementos tienden a quedarse cerca de su posición original (sesgo medible con simulación).

3. **Es menos eficiente:** O(n log n) frente a O(n).

> **Si insisten con "¿y cómo sabe que no hay sesgo?":** "Por construcción: el número de caminos de ejecución es exactamente n! y cada uno genera una permutación distinta. Además es empíricamente verificable con una prueba de chi-cuadrado sobre, por ejemplo, 600 000 barajados de 3 elementos: cada una de las 6 permutaciones debería aparecer ≈ 100 000 veces."

### B.6 Geometría de la ruleta — `calcularRotacionExacta()` (línea 528)

```ts
const angulo = 360 / totalElementos;                                  // α
const anguloCentroPorcion = (indiceGanador * angulo) + (angulo / 2);  // c = i·α + α/2
const modObjetivo = (360 - anguloCentroPorcion) % 360;                // R ≡ 360 − c (mod 360)
const vueltasBase = (Math.floor(Math.random() * 4) + 5) * 360;        // 5 a 8 vueltas completas
let diferencia = modObjetivo - (rotacionActual % 360);
if (diferencia < 0) diferencia += 360;                                // siempre girar hacia delante
return rotacionActual + vueltasBase + diferencia;
```

- La **aguja** está fija arriba (0°) — `sorteo.css`, clase `.aguja`. El `conic-gradient` también empieza en 0° y avanza en sentido horario.
- Girar R grados lleva el centro c a `(c + R) mod 360`. Para que valga 0: `R ≡ 360 − c`.
- La rotación es **acumulativa** (el `transform` nunca vuelve a 0), por eso se trabaja con `rotacionActual % 360`.
- Las vueltas extra son múltiplos de 360: **no cambian la posición final**, solo el efecto visual.
- La transición CSS dura **4 s** (`cubic-bezier(0.15, 0.85, 0.15, 1)`), sincronizada con los `setTimeout(…, 4000)`.

> **Frase clave:** "El ganador se decide **antes** de girar. La animación comunica el resultado; no lo produce."

### B.7 Retención de ganadores temporales

**Problema que resuelve:** si el ganador se eliminara del arreglo en el mismo instante en que la ruleta se detiene, Angular volvería a dibujar la ruleta con n−1 porciones y la porción ganadora **desaparecería bajo la aguja** mientras el público lee el resultado (los ángulos de todas las porciones cambian).

**Solución:** retirada **diferida**.

```ts
// Al comenzar el SIGUIENTE giro (o al guardar):
if (this.alumnoGanadorTemporalNormal) {
  const idx = this.alumnosNormal.findIndex(a => a.id === this.alumnoGanadorTemporalNormal!.id);
  if (idx !== -1) this.alumnosNormal.splice(idx, 1);
  this.alumnoGanadorTemporalNormal = null;
}
// …y solo DESPUÉS se sortea el nuevo índice.
```

Propiedades que debes saber defender:

1. **Nadie sale dos veces:** la retirada ocurre *antes* de calcular el nuevo índice, así que el sorteo siempre es sobre los no asignados.
2. **Búsqueda por `id` y no por posición:** entre giros la posición podría no coincidir; el `id` (1..n generado en `excel-seguro.ts`) es único.
3. **Búsqueda por `id` y no por nombre/carnet:** el Excel puede traer nombres repetidos.
4. **`if (idx !== -1)`:** idempotente; si ya se retiró, no borra a otro por accidente.
5. El mismo patrón se aplica en 4 lugares: alumnos Normal (653, 699), catedráticos Tesis (780, 905), alumnos Tesis (843, 911).

### B.8 Exclusión de docentes ya asignados

| Modalidad | Dónde | Mecanismo |
|-----------|-------|-----------|
| Privado | `guardarTernaNormal`, líneas 719-721 | `filter` por `nombre_completo` en `profesoresNormal` **y** en `profesoresBaseNormal`. La base es la que repuebla la ruleta al cambiar de área ⇒ un catedrático no encabeza dos grupos de áreas distintas. |
| Seminario | línea 719 | `filter` en `profesoresNormal`. |
| Tesis | `splice` por `id` (780, 905) | Cada catedrático extraído se retira definitivamente de `profesoresTesis`. |

**¿Por qué en Normal se filtra por nombre y no por `id`?** Porque al ganar, el `id` del catedrático se sobrescribe con el número de grupo (`profeGanador.id = numeroGrupoOrdenado`), que puede coincidir con el `id` aleatorio de otro docente. Filtrar por `id` podría eliminar a la persona equivocada.

### B.9 Guardas de concurrencia de la interfaz

`girandoNormalProfe`, `girandoNormalAlum`, `girandoTesisProfe`, `girandoTesisAlum` funcionan como **semáforos**: mientras valen `true`, un segundo clic retorna sin hacer nada y el botón está `[disabled]` en la plantilla. Evitan dos sorteos solapados sobre el mismo arreglo.

---

## C. Mapa rápido: "Si el tribunal me pide abrir…"

### Backend

| Qué me piden mostrar | Archivo exacto → función (línea) |
|---|---|
| Dónde **arranca** el servidor | `backend/server.js` → `iniciar()` (35) |
| Dónde se **ensambla** la app y el orden de middlewares | `backend/src/app.js` → `crearApp()` (76) |
| Dónde se **conecta MariaDB** | `backend/src/config/db.js` → `mysql.createPool` (22), `verificarConexion()` (43) |
| Dónde se **validan las variables de entorno** / longitud mínima del secreto JWT | `backend/src/config/env.js` → `envSchema` (42), `MIN_JWT_SECRET_LENGTH` (13) |
| Dónde se **configura CORS** (lista blanca) | `backend/src/app.js` → `corsOptions` (41), `origin()` (50) |
| Dónde se configuran las **cabeceras Helmet** | `backend/src/app.js` → `app.use(helmet(...))` (89) |
| Dónde se **definen los endpoints** (índice) | `backend/src/routes/index.js` (22-25) |
| Endpoint de **login** | `backend/src/routes/auth.routes.js` → `router.post("/login")` (50) |
| Endpoints de **asignaciones** | `backend/src/routes/asignaciones.routes.js` → GET (58), POST (121), DELETE lote (169), DELETE alumno (217) |
| Dónde se **valida el token** (middleware) | `backend/src/middlewares/auth.js` → `requireAuth()` (53), `extraerToken()` (24) |
| Dónde se **verifica la firma** del JWT | `backend/src/services/auth.service.js` → `verificarToken()` (51) |
| Dónde se **firma** el JWT (claims) | `backend/src/services/auth.service.js` → `firmarToken()` (29) |
| Dónde se **comprueba el rol** | `backend/src/middlewares/auth.js` → `requireRole()` (88) |
| Lógica de **login** (negocio) | `backend/src/services/auth.service.js` → `login()` (79) |
| Dónde se **compara la contraseña con bcrypt** | `backend/src/utils/password.js` → `verificarPassword()` (56) |
| Dónde se **genera el hash** / rounds | `backend/src/utils/password.js` → `hashPassword()` (40); rounds en `env.js` `BCRYPT_ROUNDS` |
| **Consulta SQL del login** | `backend/src/repositories/usuarios.repository.js` → `buscarPorEmailConHash()` (27) |
| **Transacción** de guardado | `backend/src/repositories/asignaciones.repository.js` → `crearAsignacionesTesis()` (35), `crearAsignacionesTerna()` (83) |
| Dónde se **validan las entradas** (middleware genérico) | `backend/src/middlewares/validate.js` → `validate()` (31) |
| **Esquema** del login | `backend/src/validators/auth.validators.js` → `loginSchema` (20) |
| **Esquema** de asignaciones (unión discriminada) | `backend/src/validators/asignaciones.validators.js` → `crearAsignacionSchema` (84) |
| **Regla de 3 catedráticos** (servidor) | `validators/asignaciones.validators.js` → `asignacionTesisSchema` (44) y `services/asignaciones.service.js` → `registrar()` (63) |
| **Manejo centralizado de errores** | `backend/src/middlewares/errorHandler.js` → `errorHandler()` (85), `normalizar()` (35) |
| **Rate limiting** | `backend/src/middlewares/rateLimit.js` → `apiLimiter` (47), `loginLimiter` (63) |
| **DTO** (evitar fuga de `password_hash`) | `backend/src/dtos/usuario.dto.js` → `aUsuarioDTO()` (14) |
| **Auditoría / redacción** de logs | `backend/src/config/logger.js` → `redactar()`, `logger.auditoria` |
| **Esquema de BD** | `backend/database_schema.sql` → `usuarios` (23), `asignaciones` (61) |
| **Pruebas** con repositorios simulados | `backend/tests/helpers/entorno.js` (≈67) |

### Frontend

| Qué me piden mostrar | Archivo exacto → función (línea) |
|---|---|
| Dónde se **sanitiza el Excel** (celda) | `frontend/src/app/core/excel-seguro.ts` → `normalizarCelda()` (113); fórmulas en (131) |
| Dónde se **valida el archivo** (tamaño, extensión) | `core/excel-seguro.ts` → `validarArchivoExcel()` (54) |
| Dónde se **lee el Excel** | `pages/sorteo/sorteo.ts` → `leerExcel()` (266); `XLSX.read` (298) |
| Dónde se **calculan las ternas** de tesis | `pages/sorteo/sorteo.ts` → `calcularMatematicaTesis()` (756), `Math.ceil` en (758) |
| Dónde se calculan **cupoBase y sobrantes** (Normal) | `pages/sorteo/sorteo.ts` → `calcularMatematicaNormal()` (579-582) |
| Dónde está **Fisher-Yates** | `pages/sorteo/sorteo.ts` → `leerExcel()` (365-369) y `seleccionarArea()` (557-561) |
| Dónde se **elige el ganador** | `pages/sorteo/sorteo.ts` → `Math.floor(Math.random() * n)` en (613, 661, 793, 851) |
| **Geometría** de la ruleta | `pages/sorteo/sorteo.ts` → `calcularRotacionExacta()` (528), `obtenerFondoRuleta()` (501) |
| **Retención** de ganadores | `pages/sorteo/sorteo.ts` → `iniciarSorteoAlumnosNormal()` (649) |
| **Guardado** de ternas / tesis | `pages/sorteo/sorteo.ts` → `guardarTernaNormal()` (694), `guardarTesisOficial()` (900) |
| Dónde se **adjunta el token** | `interceptors/auth-interceptor.ts` → `authInterceptor` (54), `req.clone` (67) |
| Protección anti-fuga del token a terceros | `interceptors/auth-interceptor.ts` → `esPeticionALaApi()` (27) |
| Dónde se **registra el interceptor** | `app/app.config.ts` → `provideHttpClient(withFetch(), withInterceptors([...]))` (22) |
| **Guard** de rutas | `guards/auth-guard.ts` → `authGuard` (24); uso en `app.routes.ts` (26-28) |
| Dónde se **guarda el token** | `services/auth.ts` → `guardarSesion()` (137), `localStorage.setItem` (145) |
| **Login** en el componente | `pages/login/login.ts` → `onLogin()` (62) |
| **Llamadas HTTP** de asignaciones | `services/asignacion.ts` → `guardarTerna()` (45), `guardarTesis()` (74) |
| **Traducción de errores** HTTP | `core/api-error.ts` → `interpretarError()` (68) |
| **Interfaces tipadas** del contrato API | `models/api.ts` |
| **Agrupación** de reportes y exportación de actas | `pages/reportes/reportes.ts` → `cargarDatos()` (64), `exportarSorteoBatch()` (111) |

---

## D. Glosario técnico de defensa

### D.1 Arquitectura multicapa y Patrón Repositorio

**Arquitectura multicapa (layered architecture):** organización del sistema en capas con responsabilidades únicas y dependencias en un solo sentido: `routes → middlewares → controllers → services → repositories → db`.

**Patrón Repositorio:** abstracción que encapsula el acceso a datos detrás de operaciones con significado de negocio (`buscarPorEmailConHash`, `crearAsignacionesTerna`), ocultando el SQL y el driver.

**Respuesta modelo:**
> "Separé el sistema en capas para desacoplar el protocolo HTTP de las reglas de negocio y estas del almacenamiento. Express vive solo en rutas, middlewares y controladores: `req` y `res` nunca llegan al servicio. El SQL vive solo en los repositorios: ningún servicio importa el pool. La evidencia práctica es la batería de pruebas: en `tests/helpers/entorno.js` sustituyo los repositorios por dobles en memoria y ejecuto 40 pruebas de la API completa sin MariaDB. Si mañana migro a PostgreSQL, solo reescribo repositorios."

### D.2 DTOs e interfaces tipadas

**DTO (Data Transfer Object):** objeto que define el **contrato de salida** de la API, independiente de la estructura de la tabla. En el backend son funciones de proyección con **lista blanca de campos** (`aUsuarioDTO`).

**Interfaces TypeScript:** contratos de forma verificados **en compilación** (`models/api.ts`: `ApiResponse<T>`, `LoginData`, `CrearAsignacionTesisRequest`…). Los tipos literales (`es_tesis: true` / `false`) modelan la unión discriminada también en el cliente.

**Respuesta modelo:**
> "El DTO protege contra la fuga accidental de datos: aunque la fila del login contiene `password_hash`, el DTO enumera campo a campo lo que sale, así que una columna sensible nueva nunca se filtra sola. En el frontend, las interfaces garantizan en compilación que envío exactamente el contrato. Pero los tipos de TypeScript **desaparecen en tiempo de ejecución**, por eso el backend no confía en ellos y revalida todo con Zod."

### D.3 Bcrypt, factor de coste ("rounds") y sal

- **Sal (salt):** 16 bytes (128 bits) aleatorios generados por bcrypt para **cada** contraseña e incrustados en el hash. Dos usuarios con la misma contraseña tienen hashes distintos ⇒ inutiliza las **tablas arcoíris** y los ataques en paralelo a toda la tabla.
- **Factor de coste (lo que se suele llamar "rounds"):** exponente logarítmico. `BCRYPT_ROUNDS = 12` ⇒ **2¹² = 4 096** iteraciones de la expansión de clave de Blowfish. Cada +1 **duplica** el tiempo. Validado entre 10 y 15 en `env.js`.
- **Formato:** `$2b$12$` + 22 caracteres de sal + 31 de hash = **60 caracteres**.
- **Límite:** bcrypt solo usa los primeros **72 bytes** (por eso el tope de 128 caracteres en el validador tiene sentido como anti-DoS).

**¿Por qué no SHA-256 o MD5?**
> "Porque son funciones hash **rápidas**, diseñadas para verificar integridad de grandes volúmenes de datos. Una GPU calcula miles de millones de SHA-256 o MD5 por segundo, lo que convierte un diccionario en una contraseña rota en minutos. MD5, además, tiene colisiones prácticas desde 2004. Ninguna incorpora sal ni factor de trabajo por diseño. Bcrypt es una función de **derivación de clave adaptativa**: lenta a propósito, con sal integrada, y con un coste que puedo aumentar a medida que el hardware mejora sin cambiar el algoritmo. La comparación con `bcrypt.compare` es además de tiempo constante. La recomendación actual de OWASP pone Argon2id en primer lugar; bcrypt sigue siendo aceptable y es la opción con mejor soporte en el ecosistema Node."

**Nota técnica:** el proyecto usa `bcryptjs` (implementación en JavaScript puro, sin compilación nativa); es compatible con los hashes de `bcrypt` nativo.

### D.4 JWT: claims y firma simétrica

**Estructura:** `base64url(header) . base64url(payload) . base64url(firma)`

- **Header:** `{"alg":"HS256","typ":"JWT"}`
- **Payload (claims):**
  - *Registrados (RFC 7519):* `sub` (sujeto = id de usuario, string), `iss` (emisor = `tesis-ruleta-api`), `iat` (emitido en), `exp` (expira; 8 h).
  - *Privados:* `email`, `rol`, `rol_id`.
- **Firma simétrica HS256:** `HMAC-SHA256(header + "." + payload, JWT_SECRET)`. La **misma clave** firma y verifica.

**Codificado ≠ cifrado:** cualquiera puede decodificar el payload en jwt.io. La seguridad está en que **no se puede modificar** sin invalidar la firma. Por eso el payload no lleva nada confidencial.

**Simétrica (HS256) vs asimétrica (RS256/ES256):**
> "Elegí HS256 porque el mismo servicio emite y verifica los tokens: no hay terceros que necesiten validar sin poder firmar. RS256 tiene sentido cuando varios microservicios verifican con la clave pública y solo el servidor de identidad posee la privada. El secreto se exige de al menos 32 caracteres y se rechazan valores de ejemplo al arrancar (`env.js`)."

**Validaciones en `verificarToken`:** firma, `exp` (caducidad) e `iss` (emisor). `jsonwebtoken` v9 rechaza el algoritmo `none` y, con un secreto de tipo string, solo admite la familia HMAC.

### D.5 CORS y preflight

**CORS (Cross-Origin Resource Sharing):** mecanismo **del navegador** que, por la política del mismo origen, bloquea que JavaScript de `localhost:4200` lea respuestas de `localhost:3000` salvo que el servidor lo autorice con cabeceras `Access-Control-Allow-*`.

**Preflight:** petición `OPTIONS` automática que el navegador envía **antes** de una petición "no simple". Aquí se dispara por dos motivos: `Content-Type: application/json` y la cabecera `Authorization`.

```
OPTIONS /api/v1/auth/login
Origin: http://localhost:4200
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type
─────────────────────────────────────────────────────────
204 No Content
Access-Control-Allow-Origin: http://localhost:4200   ← origen exacto, nunca "*"
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600                          ← cachea el preflight 10 min
```

**Matiz importante:** CORS **no es autenticación** ni protege contra `curl` o Postman (no envían `Origin`). Protege a los **usuarios del navegador**. Por eso el sistema permite peticiones sin `Origin` y la seguridad real la ponen JWT + roles. `env.js` prohíbe `*` en `CORS_ORIGINS`.

### D.6 Helmet

Middleware que establece cabeceras HTTP de seguridad. Las relevantes aquí:

| Cabecera | Protege contra |
|---|---|
| `Content-Security-Policy` (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) | Carga de scripts/objetos externos; incrustación en iframes |
| `X-Content-Type-Options: nosniff` | *MIME sniffing* (interpretar un JSON como script) |
| `Strict-Transport-Security` | Degradación a HTTP (fuerza HTTPS en el navegador) |
| `X-Frame-Options` | *Clickjacking* |
| `Referrer-Policy: no-referrer` | Filtrado de URLs internas a terceros |
| `Cross-Origin-Resource-Policy: same-site` | Lectura de recursos desde otros sitios |
| `X-Powered-By` (eliminada con `app.disable`) | *Fingerprinting* de la tecnología del servidor |

### D.7 Interceptores HTTP (Angular)

**Definición:** función que se ejecuta en **cada** petición de `HttpClient`, entre el servicio y la red, con acceso a la petición saliente y a la respuesta entrante (patrón *Chain of Responsibility*).

**En este sistema (`authInterceptor`):**
1. **Salida:** adjunta `Authorization: Bearer <token>` **solo** si el destino es la API propia (comparación de origen con `new URL`, no `startsWith`, para no filtrar el token a `https://atacante.com/?x=http://localhost:3000`).
2. **Entrada:** ante un **401** cierra sesión y redirige a `/login`.
3. `HttpRequest` es **inmutable** ⇒ se usa `req.clone()`.

> "Centralizar esto evita que cada servicio manipule la cabecera por su cuenta: un solo punto de cambio y un solo punto de auditoría."

### D.8 Guards (Angular)

**Definición:** función `CanActivateFn` que el router evalúa antes de activar una ruta; devuelve `true` o un `UrlTree` de redirección.

**Posición a defender (muy importante):**
> "El guard es una medida de **experiencia de usuario, no de seguridad**. Todo lo que se ejecuta en el navegador es manipulable: cualquiera puede saltarse el guard desde las DevTools. Lo único que conseguiría es una pantalla vacía, porque cada endpoint exige en el servidor un token válido y el rol adecuado. La autorización vive en el backend."

### D.9 Otros términos que pueden salir

| Término | Definición breve |
|---|---|
| **Inyección SQL** | Alterar una consulta concatenando entrada del usuario. Mitigación: placeholders `?` (mysql2 escapa cada valor), `multipleStatements: false`, validación Zod previa. |
| **Transacción / ACID** | Grupo de sentencias atómico: `beginTransaction → commit` o `rollback`. Garantiza que un jurado se guarda completo o no se guarda. |
| **Pool de conexiones** | Conjunto reutilizable de conexiones abiertas; evita el coste de abrir TCP + autenticación en cada petición. |
| **Stateless** | El servidor no guarda sesión; toda la identidad viaja en el JWT. Escala horizontalmente sin sesión compartida. |
| **Rate limiting** | Límite de peticiones por IP y ventana de tiempo; mitiga fuerza bruta y abuso. |
| **Enumeración de usuarios** | Deducir qué correos existen por diferencias en la respuesta. Mitigación: mismo mensaje y código para ambos fallos. |
| **Fail-fast** | Abortar al arrancar si la configuración es inválida o no hay BD, en vez de fallar después con usuarios conectados. |
| **Defensa en profundidad** | Varias capas de control independientes (validación en cliente, Zod, servicio, restricciones de BD). |
| **Unión discriminada** | Tipo que es A **o** B según el valor de un campo (`es_tesis`). |
| **Signals (Angular)** | Primitiva reactiva: `computed` se recalcula sola cuando cambia la señal de la que depende. |
| **Observable frío** | No ejecuta nada (no hace la petición HTTP) hasta que alguien se suscribe. |
| **CSV / Formula injection** | Celda que empieza por `=`, `+`, `-`, `@` y se ejecuta como fórmula al abrir el archivo. Mitigación: anteponer `'`. |
| **Graceful shutdown** | Apagado ordenado: dejar de aceptar conexiones, terminar las activas, cerrar el pool. |
| **`requestId`** | UUID por petición que enlaza la respuesta de error del usuario con la traza del servidor sin exponer detalles internos. |

---

## E. Simulacro de preguntas difíciles del tribunal

### Pregunta 1 — "El sorteo se ejecuta en el navegador. ¿Qué impide que un administrador abra la consola y manipule el resultado antes de guardar?"

**Por qué es capciosa:** es cierta. Si respondes "nada puede manipularlo", pierdes credibilidad.

**Respuesta formal:**
> "Es una observación correcta y fue una decisión de diseño consciente. El sorteo es un **acto presencial y público**: se proyecta la ruleta ante los interesados, y la animación está construida para detenerse exactamente sobre el índice elegido, de modo que el resultado visible es el resultado guardado. El backend no puede verificar *cómo* se obtuvo el resultado, pero sí garantiza cuatro cosas: que solo un usuario con rol `admin` autenticado puede registrar (403 en otro caso), que el cuerpo cumple estrictamente el contrato (3 catedráticos, límites de lote, modalidad existente), que la escritura es atómica, y que queda un **registro de auditoría** con usuario, IP, `requestId` y hora. Como trabajo futuro, la evolución natural es trasladar la generación aleatoria al servidor con `crypto.randomInt` y publicar un compromiso criptográfico de la semilla antes del sorteo para hacerlo verificable por terceros."

### Pregunta 2 — "¿`Math.random()` es criptográficamente seguro? ¿Por qué no lo usó?"

**Respuesta formal:**
> "No lo es. En V8, `Math.random` es un generador pseudoaleatorio (xorshift128+) cuyo estado interno podría inferirse observando suficientes salidas. Lo considero adecuado para este caso porque el modelo de amenaza no es un adversario que observa miles de salidas para predecir la siguiente: es un sorteo presencial con pocas extracciones. La propiedad que necesito es **uniformidad estadística**, y `Math.random` la cumple. Si el requisito fuera resistencia a predicción, cambiaría la fuente por `crypto.getRandomValues` en el navegador; el algoritmo de reparto y de Fisher-Yates no cambiaría, solo el origen del número."

### Pregunta 3 — "Usted afirma que no hay sesgo. ¿Por qué Fisher-Yates y no `sort(() => Math.random() - 0.5)`? Demuéstrelo."

**Respuesta formal:**
> "Hay dos razones, una de especificación y otra matemática. Primero, ECMAScript exige que el comparador sea consistente; uno aleatorio no lo es y el orden resultante queda *implementation-defined*, distinto en cada motor. Segundo, un ordenamiento por comparaciones con k comparaciones aleatorias tiene 2ᵏ resultados equiprobables; para ser uniforme, n! tendría que dividir a 2ᵏ, y para n ≥ 3 eso es imposible porque n! es múltiplo de 3 y ninguna potencia de 2 lo es. Fisher-Yates, en cambio, genera exactamente n·(n−1)·…·2 = n! caminos, cada uno con una permutación distinta: la distribución es uniforme por construcción y en O(n)."
>
> **Precisión que conviene añadir si abren el código:** "En el sistema, Fisher-Yates asigna los identificadores internos de los catedráticos; la elección de cada ganador se hace con `floor(random·n)` sobre los elementos restantes, que es precisamente el paso elemental de Fisher-Yates, con probabilidad 1/n para cada participante."

### Pregunta 4 — "Si JWT es *stateless*, ¿cómo invalida un token cuando el usuario cierra sesión o cuando le quitan el rol de administrador?"

**Por qué es capciosa:** la respuesta honesta es "no se invalida en el servidor".

**Respuesta formal:**
> "Es la contrapartida conocida de los tokens sin estado. Al cerrar sesión, el cliente borra el token y el interceptor deja de enviarlo, pero un token copiado seguiría siendo válido hasta su expiración. Lo mitigo con una caducidad acotada de 8 horas, un secreto robusto y rotable, y releyendo el perfil desde la base de datos en `/auth/me`. Reconozco que la autorización por rol (`requireRole`) usa el claim del token, por lo que un cambio de rol surte efecto al expirar. Para revocación inmediata, las opciones son una **lista de revocación** por `jti` en una caché como Redis, o **tokens de acceso cortos (15 min) con refresh token** almacenado y revocable en servidor. No lo implementé porque añade estado y una dependencia de infraestructura desproporcionada para el volumen de usuarios del sistema."

### Pregunta 5 — "¿Por qué guarda el token en `localStorage` si cualquier XSS puede robarlo? ¿No era mejor una cookie `httpOnly`?"

**Respuesta formal:**
> "Una cookie `httpOnly` es preferible frente a XSS porque JavaScript no puede leerla, y lo documenté así en `services/auth.ts`. Pero cambia el modelo: introduce el riesgo de **CSRF**, que obliga a `SameSite` y a tokens anti-CSRF, y requiere que el backend gestione cookies. Opté por Bearer en cabecera y atacé la **causa** del XSS en lugar de solo su consecuencia: todas las celdas del Excel se tratan como texto plano, Angular escapa la interpolación por defecto, los diálogos usan `text:` y nunca `html:`, la API envía CSP restrictiva, y el interceptor solo adjunta el token a la API propia comparando el origen. Si una auditoría futura lo exigiera, la migración a cookie `httpOnly` + `SameSite=Strict` afecta solo al servicio de autenticación y al interceptor, gracias a que están centralizados."

### Pregunta 6 — "¿Cómo garantiza que no hay inyección SQL? ¿Usa sentencias preparadas?"

**Por qué es capciosa:** con mysql2, `pool.query(sql, [valores])` **no** es un *prepared statement* del servidor; es escape en el cliente. `pool.execute` sí lo sería.

**Respuesta formal:**
> "Ningún valor del usuario se concatena en el texto SQL: todas las consultas usan marcadores `?` y el driver mysql2 escapa cada valor según su tipo antes de enviarlo, de modo que `' OR '1'='1` se almacena como texto literal. Para ser preciso, uso `query` con parámetros, que realiza el escape en el cliente; `execute` usaría sentencias preparadas del servidor. Ambas protegen contra inyección. Además hay tres capas adicionales: `multipleStatements: false` impide apilar sentencias con `;`, Zod valida tipo, formato y longitud antes de llegar al repositorio (un `id` no numérico nunca alcanza la consulta, la fecha exige una expresión regular anclada), y el SQL está confinado a la capa de repositorios, lo que hace la revisión exhaustiva y sencilla."

### Pregunta 7 — "¿Qué ocurre si se cae la red o el servidor a mitad del guardado de una tesis? ¿Puede quedar un jurado incompleto en la base de datos?"

**Respuesta formal:**
> "A nivel de **cada alumno**, no: el repositorio abre una transacción, inserta las tres filas del jurado —Presidente, Vocal 1 y Vocal 2— y hace `commit`; si cualquiera falla hace `rollback`, y el `finally` libera la conexión. Nunca queda un alumno con uno o dos miembros de jurado. Ahora bien, el frontend envía **una petición por alumno** de la terna, de modo que un corte a mitad puede dejar a unos alumnos del grupo registrados y a otros no. Ese caso no pasa inadvertido: la interfaz avisa de que revise el reporte, cada escritura queda auditada, y el módulo de reportes permite eliminar el lote y repetirlo. La mejora directa es un endpoint que reciba la terna completa con todos sus alumnos y los inserte en una única transacción, igual que ya hace el método de privado y seminario."

---

## F. Limitaciones conocidas (para que no te sorprendan)

> Conocer las debilidades de tu propio sistema y proponer la solución es lo que distingue una defensa sólida. No las menciones por iniciativa si no hace falta, pero **nunca las niegues** si te las señalan.

| # | Limitación | Dónde | Respuesta / mejora propuesta |
|---|---|---|---|
| 1 | **Tesis con catedráticos no múltiplo de 3.** `T = ceil(P/3)`: con P = 7 se planifican 3 ternas, pero la 3.ª solo tendría 1 docente; el sorteo se detiene y los alumnos de ese cupo quedan sin asignar. | `sorteo.ts:758` y guarda de `profesoresTesis.length === 0` | Validar al cargar que P sea múltiplo de 3 (o usar `floor(P/3)` y avisar de los docentes sobrantes). |
| 2 | **Fórmulas con espacio inicial.** `" =SUMA(1)"` no se neutraliza: la comprobación del prefijo ocurre antes del `trim`. Verificado ejecutando la función. | `excel-seguro.ts:131` | Aplicar el `trim` (o la comprobación) después del colapso de espacios. |
| 3 | **Revocación de JWT / cambio de rol** efectivo solo al expirar (8 h). | `middlewares/auth.js` (usa claim `rol`) | Lista de revocación por `jti` o access token corto + refresh token. |
| 4 | **Diferencia de tiempo en login:** si el correo no existe, no se ejecuta bcrypt y la respuesta es más rápida (enumeración por temporización, teórica). | `auth.service.js:79` (cortocircuito `&&`) | Comparar contra un hash ficticio cuando el usuario no existe. Mitigado hoy por el rate limit de login. |
| 5 | **Lote identificado por minuto.** Dos guardados en el mismo minuto se agrupan como un lote; y `DATE_FORMAT(columna)` en el `WHERE` impide usar el índice sobre `fecha_asignacion`. | `asignaciones.repository.js` (`contarPorFechaLote`…) | Columna `lote_id` (UUID) generada por guardado. |
| 6 | **Guardado de tesis no atómico por terna** (N peticiones). | `sorteo.ts:900` | Endpoint que reciba la terna completa en una transacción. |
| 7 | **Modelo desnormalizado:** nombres como texto, sin FK a alumnos/profesores ni restricción "un alumno, un evento por periodo". | `database_schema.sql` (documentado en la sección "PROPUESTA FUTURA") | Modelo normalizado con `UNIQUE (alumno_id, periodo_id)`. |
| 8 | **Nombres duplicados de catedráticos** en el Método Normal: el `filter` por nombre retiraría a ambos. | `sorteo.ts:719` | Excluir por un identificador estable en lugar del nombre. |
| 9 | **Sorteo en el cliente** y `Math.random` no criptográfico. | `sorteo.ts` | Ver preguntas 1 y 2. |

---

## G. Cifras y datos para memorizar

| Dato | Valor | Dónde |
|---|---|---|
| Coste bcrypt | 12 (2¹² = 4 096 iteraciones); rango permitido 10-15 | `env.js` `BCRYPT_ROUNDS` |
| Longitud hash bcrypt | 60 caracteres; sal de 128 bits | `password.js` `esHashBcrypt` |
| Caducidad JWT | 8 h | `env.js` `JWT_EXPIRES_IN` |
| Secreto JWT mínimo | 32 caracteres | `env.js` `MIN_JWT_SECRET_LENGTH` |
| Algoritmo JWT | HS256 (HMAC-SHA256) | `auth.service.js` |
| Límite login | 10 intentos fallidos / 15 min por IP | `env.js`, `rateLimit.js` |
| Límite general | 300 peticiones / 15 min por IP | `env.js`, `rateLimit.js` |
| Tamaño máximo de cuerpo JSON | 10 kB | `env.js` `JSON_BODY_LIMIT` |
| Alumnos por lote (terna) | máx. 100 | `env.js` `MAX_ALUMNOS_POR_LOTE` |
| Contraseña | 1-128 caracteres | `auth.validators.js` |
| Excel: tamaño / filas / columnas | 5 MB / 2 000 / 10 | `excel-seguro.ts` |
| Longitud nombre / carnet | 100 / 50 | validadores y `excel-seguro.ts` |
| Preflight cacheado | 600 s | `app.js` `maxAge` |
| Pool MariaDB | 10 conexiones por defecto | `env.js` `DB_CONNECTION_LIMIT` |
| Animación de la ruleta | 4 s, 5-8 vueltas | `sorteo.css`, `calcularRotacionExacta` |
| Apagado forzado | 10 s | `server.js` |
| Pruebas automatizadas | Backend 40 · Frontend 50 (todas en verde) | `npm test` / `ng test` |
| Códigos HTTP usados | 200, 201, 204 (preflight), 400, 401, 403, 404, 409, 413, 422, 429, 500, 503 | `AppError.js`, `health.routes.js` |

### Diferencias de códigos HTTP que suelen preguntar

- **401 vs 403:** 401 = "no sé quién eres" (sin token o token inválido). 403 = "sé quién eres, pero no tienes permiso" (rol insuficiente).
- **400 vs 422:** 400 = el JSON está mal formado (no se puede parsear). 422 = el JSON es válido pero su contenido no cumple las reglas.
- **201 vs 200:** 201 indica que se **creó** un recurso (POST de asignaciones).

---

*Última revisión: 12/09/2026. Si modificas el código, actualiza los números de línea de la sección C.*
