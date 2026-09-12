# Sistema Web para la Asignación y Gestión de Evaluadores de Tesis, Examenes Privados y Seminario mediante Algoritmo de Distribución Aleatoria Equitativa

**Trabajo de graduación — Ingeniería en Sistemas**
Universidad Mariano Gálvez de Guatemala (UMG)

---

## Tabla de contenido

1. [Descripción técnica de la solución](#1-descripción-técnica-de-la-solución)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Seguridad y buenas prácticas](#3-seguridad-y-buenas-prácticas)
4. [Núcleo algorítmico](#4-núcleo-algorítmico)
5. [Guía de instalación y despliegue local](#5-guía-de-instalación-y-despliegue-local)
6. [Métricas de calidad y pruebas](#6-métricas-de-calidad-y-pruebas)
7. [Estructura de directorios](#7-estructura-de-directorios)
8. [Autoría](#8-autoría)

---

## 1. Descripción técnica de la solución

### 1.1 Planteamiento del problema

La conformación de tribunales evaluadores (ternas) para exámenes privados,
seminarios y defensas de tesis se realiza tradicionalmente de forma manual. Ese
procedimiento presenta tres deficiencias verificables:

1. **Ausencia de imparcialidad demostrable.** No existe evidencia de que la
   asignación entre catedrático y estudiante sea independiente de la voluntad
   de quien la ejecuta.
2. **Distribución desigual de la carga académica.** El reparto manual tiende a
   concentrar estudiantes en unos evaluadores y a dejar a otros con carga
   mínima.
3. **Trazabilidad nula.** No queda registro de quién ejecutó la asignación, en
   qué momento ni con qué resultado.

### 1.2 Solución propuesta

Aplicación web cliente-servidor que automatiza la conformación de tribunales
mediante un **algoritmo de distribución aleatoria equitativa**. El sistema:

- Calcula de forma determinista el cupo de estudiantes que corresponde a cada
  tribunal, repartiendo el residuo de la división de manera uniforme.
- Ejecuta la selección mediante un muestreo aleatorio uniforme sin reemplazo,
  representado visualmente como una ruleta para dar transparencia al acto.
- Registra cada asignación en una transacción atómica sobre base de datos
  relacional, con pista de auditoría del usuario responsable.
- Genera actas oficiales exportables a formato Excel.

### 1.3 Modalidades soportadas

| Modalidad | Estructura | Cardinalidad |
|---|---|---|
| Examen Privado | Un catedrático evalúa a un grupo de estudiantes, segmentado por área de especialidad | 1:N |
| Seminario | Un catedrático evalúa a un grupo de estudiantes, sin segmentación por área | 1:N |
| Tesis | Tres catedráticos (Presidente, Vocal 1, Vocal 2) evalúan a cada estudiante | 3:1 |

### 1.4 Arquitectura general

Arquitectura de **tres capas físicas** con separación estricta de
responsabilidades:

```
┌──────────────────────┐      HTTPS / JSON       ┌──────────────────────┐
│   Cliente (SPA)      │  ──────────────────▶    │   Servidor (API)     │
│   Angular 21         │   Bearer JWT            │   Node.js + Express  │
│   Navegador          │  ◀──────────────────    │   REST /api/v1       │
└──────────────────────┘                         └──────────┬───────────┘
                                                            │ SQL parametrizado
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  MariaDB             │
                                                 │  tesis_ruleta        │
                                                 └──────────────────────┘
```

La API no sirve vistas: expone exclusivamente recursos REST versionados. El
cliente es una aplicación de página única (SPA) que consume esos recursos.

---

## 2. Stack tecnológico

### 2.1 Backend

| Componente | Tecnología | Versión | Función |
|---|---|---|---|
| Entorno de ejecución | Node.js | 22.13.1 | Motor del servidor |
| Framework HTTP | Express | 5.2.x | Enrutamiento y middlewares |
| Base de datos | MariaDB | 10.x+ | Persistencia relacional |
| Driver | `mysql2` | 3.x | Conexión con consultas preparadas |
| Autenticación | `jsonwebtoken` | 9.x | Emisión y verificación de JWT |
| Cifrado de contraseñas | `bcryptjs` | 3.x | Derivación de clave con sal |
| Validación | `zod` | 4.x | Esquemas estrictos de entrada |
| Cabeceras de seguridad | `helmet` | 8.x | CSP, HSTS, nosniff, frameguard |
| Limitación de tasa | `express-rate-limit` | 8.x | Mitigación de fuerza bruta |
| Documentación | `swagger-jsdoc` + `swagger-ui-express` | 6.x / 5.x | Especificación OpenAPI 3.0.3 |
| Registro de acceso | `morgan` | 1.x | Bitácora HTTP |
| Pruebas | `node:test` + `supertest` | Nativo / 7.x | Pruebas de integración de la API |

#### Arquitectura multicapa

El backend implementa una **arquitectura por capas** derivada del patrón MVC,
con una regla de dependencia unidireccional:

```
Routes  ──▶  Controllers  ──▶  Services  ──▶  Repositories  ──▶  MariaDB
   │              │                │                │
Validators      DTOs          Reglas de         SQL parametrizado
(Zod)      (lista blanca)     negocio           (única capa con SQL)
```

| Capa | Responsabilidad | Restricción |
|---|---|---|
| **Routes** | Declarar rutas, aplicar autenticación, autorización y validación | No contienen lógica |
| **Controllers** | Traducir HTTP ↔ servicio | No acceden a la base de datos |
| **Services** | Reglas de negocio y precondiciones | No conocen HTTP |
| **Repositories** | Acceso a datos | **Única capa autorizada a escribir SQL** |
| **DTOs** | Construcción de la respuesta por lista blanca | Impiden fuga de campos sensibles |

Esta separación permite que las pruebas sustituyan la capa de repositorios por
dobles en memoria y validen la API completa sin necesidad de una base de datos
activa.

> **Nota sobre Passport.** El anteproyecto contemplaba `passport-jwt` como
> mecanismo de autenticación. **La implementación final no lo utiliza.** Se
> descartó por tres razones técnicas: (a) Passport aporta una capa de
> abstracción orientada a múltiples estrategias federadas (OAuth, SAML) que este
> sistema no requiere, pues emplea una única estrategia JWT propia; (b) su
> integración añade tres dependencias transitivas sin beneficio funcional; y
> (c) el middleware propio (`src/middlewares/auth.js`, 95 líneas) resulta
> auditable en su totalidad, requisito relevante en un trabajo cuyo objeto es
> precisamente demostrar la corrección de sus controles de seguridad. La
> verificación criptográfica se delega en `jsonwebtoken`, biblioteca de
> referencia que Passport también utiliza internamente.

### 2.2 Frontend

| Componente | Tecnología | Versión | Función |
|---|---|---|---|
| Framework | Angular | 21.2.23 | SPA con componentes autónomos |
| Lenguaje | TypeScript | 5.9.x | Tipado estático |
| Programación reactiva | RxJS | 7.8.x | Flujos asíncronos |
| Importación/exportación Excel | SheetJS (`xlsx`) | 0.20.3 | Lectura de nóminas y generación de actas |
| Diálogos | SweetAlert2 | 11.x | Interfaz de notificaciones |
| Pruebas | Vitest + jsdom | 4.1.x / 27.x | Pruebas unitarias |

#### Arquitectura del cliente

- **Componentes autónomos** (*standalone*): cada pantalla declara sus propias
  dependencias, sin `NgModule` intermedios.
- **Guards** (`authGuard`): control de acceso a rutas protegidas.
- **Interceptors** (`authInterceptor`): inyección centralizada del token Bearer
  y gestión unificada de la respuesta 401.
- **DTOs tipados** (`models/api.ts`): contrato explícito con la API; ninguna
  interfaz del cliente contiene campos de contraseña.
- **Servicios**: único punto de acceso HTTP. Ningún componente inyecta
  `HttpClient` directamente.
- **Capa `core/`**: utilidades transversales de saneamiento de Excel y
  traducción centralizada de errores.

---

## 3. Seguridad y buenas prácticas

Los controles se clasifican según el **OWASP Top 10 (2021)**.

### 3.1 Controles implementados en el backend

| Riesgo OWASP | Control implementado | Ubicación |
|---|---|---|
| **A01 — Pérdida de control de acceso** | Autenticación JWT obligatoria en todos los endpoints salvo `/health` y `/auth/login`. Autorización por rol aplicada a nivel de *router*, de modo que una ruta nueva nace protegida por omisión. | `middlewares/auth.js` |
| **A02 — Fallos criptográficos** | Contraseñas con **bcrypt** (factor de coste 12). Un valor que no tenga formato de hash bcrypt se rechaza sin compararse. Secreto JWT de 96 caracteres validado al arranque. | `utils/password.js` |
| **A03 — Inyección** | **Consultas parametrizadas** en el 100 % de los accesos. Columnas enumeradas explícitamente: no existe `SELECT *`. `multipleStatements: false` impide el apilamiento de sentencias. | `repositories/` |
| **A04 — Diseño inseguro** | Límite de cuerpo de 10 kB, cota de 100 estudiantes por lote y transacciones atómicas con *rollback*. | `app.js`, `services/` |
| **A05 — Configuración incorrecta** | Validación estricta del entorno al arranque: el proceso no inicia con variables ausentes o con el secreto de ejemplo. **Helmet**. `x-powered-by` desactivado. **CORS con lista blanca**; el comodín `*` se rechaza. Swagger deshabilitado en producción. | `config/env.js`, `app.js` |
| **A07 — Fallos de identificación** | Limitador estricto en el login (10 intentos / 15 min). Respuesta idéntica ante correo inexistente y contraseña incorrecta, lo que impide la **enumeración de usuarios**. | `middlewares/rateLimit.js`, `services/auth.service.js` |
| **A09 — Fallos de registro y monitorización** | Bitácora de auditoría en JSON: inicios de sesión, accesos denegados, creación y eliminación de asignaciones, con identificador de petición correlacionable. | `config/logger.js` |

#### Prevención de fuga de secretos en la auditoría

El registrador aplica **redacción automática** sobre una lista de claves
sensibles (`password`, `password_hash`, `token`, `authorization`, `secret`,
`cookie`, entre otras), recorriendo la estructura de forma recursiva antes de
emitir cada línea. Un intento de registrar un objeto que contenga credenciales
produce `[REDACTADO]` en lugar del valor.

De forma complementaria, el **manejador centralizado de errores** garantiza que
ningún detalle interno alcance al cliente: los errores del motor de base de
datos se traducen a un mensaje genérico, y el detalle real —incluida la traza—
permanece exclusivamente en la bitácora del servidor, correlacionable mediante
el `requestId` que sí se devuelve.

### 3.2 Controles implementados en el frontend

| Riesgo | Control implementado |
|---|---|
| **XSS en diálogos** | Se eliminó el uso de la opción `html:` de SweetAlert2 con datos procedentes de Excel, sustituyéndola por `text:`, que el motor inserta como texto y nunca interpreta como marcado. **No queda ningún `html:` en el proyecto.** |
| **XSS y contaminación desde Excel** | Todo archivo se trata como entrada no confiable: validación de archivo único, extensión, tipo MIME y tamaño máximo (5 MB); normalización de cada celda con eliminación de caracteres de control y truncamiento; cotas de 2 000 filas y 10 columnas. |
| **Inyección de fórmulas (CSV injection)** | Los prefijos `=`, `+`, `-` y `@` se neutralizan anteponiendo un apóstrofo, de modo que un valor como `=HYPERLINK(...)` no se ejecute al reexportar el acta. |
| **Exposición de credenciales** | Ninguna interfaz del cliente contiene `password_hash`. La contraseña se elimina de memoria tras cada intento y nunca se escribe en el almacenamiento del navegador. |
| **Almacenamiento innecesario** | Solo se conservan el token y una identidad mínima (`id`, `email`, `rol`). |
| **Fuga del token a terceros** | El interceptor compara el **origen resuelto** de la URL, no una coincidencia de cadena; una URL como `https://atacante.example/?next=<apiUrl>` no recibe la cabecera `Authorization`. |
| **Sesión residual** | El cierre de sesión elimina efectivamente el estado de autenticación. |

> **Declaración explícita sobre los controles del cliente.** La guarda de rutas
> y la validación de dominio institucional en el formulario de acceso son
> **ayudas de interfaz, no medidas de seguridad**. Ambas pueden eludirse
> manipulando el navegador. La autorización efectiva reside íntegramente en el
> servidor, que exige token válido y rol suficiente en cada petición. Así consta
> documentado en el propio código fuente.

### 3.3 Gestión de dependencias

| Ámbito | Estado inicial | Estado final |
|---|---|---|
| Backend | 7 vulnerabilidades (5 altas) | **0** |
| Frontend | 44 vulnerabilidades (2 críticas, 29 altas) | **0** |

Todas las actualizaciones fueron **controladas y verificadas**, sin recurrir a
`npm audit fix --force`. Destaca la actualización de Angular 21.1.4 → 21.2.23,
que corrige cuatro avisos de **evasión del saneador de plantillas (XSS)** en el
propio framework.

---

## 4. Núcleo algorítmico

Esta sección describe formalmente el algoritmo de distribución. **Su
implementación no fue modificada durante la reestructuración del sistema**, y se
encuentra protegida por pruebas de regresión que fijan sus valores de salida.

### 4.1 Notación

| Símbolo | Significado |
|---|---|
| $A$ | Conjunto de estudiantes por asignar, $\|A\| = n$ |
| $P$ | Conjunto de catedráticos disponibles, $\|P\| = m$ |
| $T$ | Número de tribunales a conformar |
| $c_b$ | Cupo base por tribunal (`cupoBase`) |
| $s$ | Residuo por distribuir (`sobrantes`) |
| $c_i$ | Cupo efectivo del tribunal $i$ |

### 4.2 Cálculo del cupo base y del residuo

**Modalidades Privado y Seminario** (un catedrático por tribunal, $T = m$):

$$c_b = \left\lfloor \frac{n}{m} \right\rfloor \qquad s = n \bmod m$$

**Modalidad Tesis** (tres catedráticos por tribunal):

$$T = \left\lceil \frac{m}{3} \right\rceil \qquad c_b = \left\lfloor \frac{n}{T} \right\rfloor \qquad s = n \bmod T$$

El uso de la función techo en el cálculo de $T$ garantiza que ningún
catedrático quede excluido: un residuo de uno o dos catedráticos conforma
igualmente un tribunal adicional.

### 4.3 Distribución del residuo

El residuo $s$ representa los estudiantes que no pueden repartirse de forma
exactamente uniforme, pues $n$ no es múltiplo de $T$. En lugar de concentrarlos
en un único tribunal, el algoritmo los distribuye **de uno en uno** entre los
primeros $s$ tribunales conformados:

$$c_i = c_b + \begin{cases} 1 & \text{si } s > 0 \\ 0 & \text{si } s = 0 \end{cases}$$

Tras completarse el cupo de un tribunal, el residuo se decrementa:

$$s \leftarrow \max(0,\; s - 1)$$

**Propiedad garantizada.** La diferencia de carga entre dos tribunales
cualesquiera nunca excede una unidad:

$$\forall i, j \in T : \; |c_i - c_j| \leq 1$$

Esta es la propiedad que sustenta el calificativo de *equitativa* en la
distribución.

**Ejemplo.** Con $n = 10$ estudiantes y $m = 3$ catedráticos:

$$c_b = \lfloor 10/3 \rfloor = 3, \qquad s = 10 \bmod 3 = 1$$

Reparto resultante: **4, 3, 3**. El primer tribunal absorbe la unidad
excedente; la desviación máxima es 1. *(Caso cubierto por prueba automatizada.)*

### 4.4 Selección aleatoria: muestreo uniforme sin reemplazo

Cada extracción selecciona un índice conforme a una **distribución uniforme
discreta** sobre los elementos aún disponibles:

$$k \sim \mathcal{U}\{0,\, |L| - 1\}, \qquad k = \lfloor \texttt{random()} \times |L| \rfloor$$

Al retirarse el elemento seleccionado del conjunto $L$, el muestreo es **sin
reemplazo**, lo que asegura que ningún participante pueda resultar elegido dos
veces.

### 4.5 Permutación de Fisher-Yates

La numeración de los tribunales se aleatoriza mediante el algoritmo de
**Fisher-Yates** en su variante moderna (Durstenfeld), que recorre el vector
desde el final intercambiando cada posición con otra elegida uniformemente
entre las no procesadas:

```
para i desde |V| - 1 hasta 1:
    j ← ⌊random() × (i + 1)⌋
    intercambiar V[i] ↔ V[j]
```

**Propiedades.** Complejidad temporal $O(n)$ y espacial $O(1)$ *in situ*. Genera
cada una de las $n!$ permutaciones posibles con probabilidad idéntica $1/n!$,
condición necesaria para que la asignación de números de grupo sea
estadísticamente imparcial.

### 4.6 Exclusión temporal del ganador

Mecanismo que preserva la **transparencia visual** del sorteo. Al resultar
seleccionado un participante, este **no se elimina de inmediato** del conjunto
visible: permanece en la ruleta hasta el inicio del siguiente giro, momento en
el que se retira efectivamente.

Justificación: la eliminación inmediata provocaría que la ruleta se
recompusiera mientras el usuario lee el resultado, impidiendo verificar
visualmente qué elemento resultó premiado. Con la exclusión diferida, el
observador confirma el resultado sobre la misma ruleta que lo produjo.

La retirada se ejecuta en tres puntos, garantizando que el participante nunca
pueda ser seleccionado dos veces: al iniciar el siguiente giro, al registrar la
terna y al conformar un nuevo tribunal.

### 4.7 Cálculo de la rotación visual

La rotación de la ruleta se calcula de modo que el sector ganador quede
alineado con el indicador fijo. Para $N$ sectores e índice ganador $i$:

$$\theta_{\text{sector}} = \frac{360°}{N}, \qquad \theta_{\text{centro}} = i \cdot \theta_{\text{sector}} + \frac{\theta_{\text{sector}}}{2}$$

$$\theta_{\text{objetivo}} = (360° - \theta_{\text{centro}}) \bmod 360°$$

Se añaden entre 5 y 8 vueltas completas —$(\lfloor \texttt{random()} \times 4 \rfloor + 5) \times 360°$— para producir el efecto de giro, y se ajusta el
diferencial al módulo actual de rotación, sumando $360°$ cuando resulta
negativo para forzar el sentido horario.

> **Consideración metodológica.** El resultado se determina **antes** de la
> animación: la rotación se calcula para converger en el sector ya elegido. La
> animación es, por tanto, una representación fiel de un resultado previamente
> fijado, y no un proceso cuyo desenlace dependa de la temporización de la
> interfaz. Esta separación entre selección y representación es lo que permite
> auditar la aleatoriedad de forma independiente del componente visual.

---

## 5. Guía de instalación y despliegue local

### 5.1 Requisitos previos

| Software | Versión mínima | Verificación |
|---|---|---|
| Node.js | 20.x (probado en 22.13.1) | `node -v` |
| npm | **11.x** (ver nota) | `npm -v` |
| MariaDB / MySQL | 10.4+ (XAMPP incluye una versión compatible) | `mysql --version` |

> **Nota sobre npm.** La instalación del frontend requiere **npm 11 o
> superior**. La versión 10.9.2 presenta un defecto en el resolutor de
> dependencias (`Cannot read properties of null (reading 'edgesOut')`) al
> procesar el grafo de dependencias de par de Vitest. Si su sistema tiene npm
> 10, anteponga `npx npm@11` a los comandos de instalación del frontend.

### 5.2 Paso 1 — Configuración de la base de datos

Inicie el servicio de MariaDB (en XAMPP, mediante el panel de control) y ejecute
el script de esquema:

```bash
mysql -u root -p < backend/database_schema.sql
```

Alternativamente, desde phpMyAdmin: importar el archivo
`backend/database_schema.sql`.

El script crea la base de datos `tesis_ruleta`, las tablas `roles`, `usuarios`,
`tipos_evento` y `asignaciones`, los índices recomendados y los datos iniciales
del catálogo.

> **Advertencia documentada.** El archivo de esquema original no coincidía con
> la base de datos real en producción: declaraba tablas y claves foráneas
> inexistentes. El desajuste, sus implicaciones —entre ellas que la restricción
> anti-fraude `UNIQUE (alumno_id, periodo_id)` **no está activa**— y las dos
> vías de corrección posibles se detallan en
> [`backend/docs/ESQUEMA-BD.md`](backend/docs/ESQUEMA-BD.md). Es lectura
> obligada antes de modificar el modelo de datos.

### 5.3 Paso 2 — Variables de entorno

```bash
cd backend
cp .env.example .env
```

Genere un secreto JWT propio (mínimo 32 caracteres):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Edite `.env` y asigne el valor obtenido a `JWT_SECRET`. Ajuste las credenciales
de base de datos según su instalación:

```ini
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=tesis_ruleta
JWT_SECRET=<el valor generado>
JWT_EXPIRES_IN=8h
CORS_ORIGINS=http://localhost:4200
SWAGGER_ENABLED=true
```

> El servidor **no arrancará** si falta una variable obligatoria o si
> `JWT_SECRET` conserva el valor de ejemplo. Es un control deliberado: impide
> desplegar el sistema con una configuración insegura.

### 5.4 Paso 3 — Instalación de dependencias del backend

```bash
cd backend
npm install
```

### 5.5 Paso 4 — Migración de contraseñas

**Este paso es obligatorio.** La versión previa del sistema almacenaba las
contraseñas en texto plano y las comparaba directamente contra la columna
`password_hash`. La implementación actual **solo acepta hashes bcrypt**, por lo
que las cuentas existentes no podrán iniciar sesión hasta ser migradas.

Ejecute primero la simulación, que no modifica dato alguno:

```bash
npm run migrate:passwords
```

Revise el informe de cuentas afectadas y aplique la migración:

```bash
npm run migrate:passwords:apply
```

El script toma el valor actual de la columna como contraseña en claro y lo
sustituye por su hash bcrypt dentro de una transacción. **Los usuarios conservan
su contraseña**; únicamente cambia la forma de almacenarla.

> **Recomendación posterior a la migración.** Solicite a los usuarios el cambio
> de contraseña. Los valores heredados eran débiles y estuvieron almacenados sin
> cifrar.

### 5.6 Paso 5 — Arranque del backend

```bash
npm run dev     # con recarga automática (nodemon)
# o bien
npm start       # modo producción
```

Salida esperada:

```json
{"ts":"...","nivel":"info","mensaje":"bd_conectada","base":"tesis_ruleta"}
{"ts":"...","nivel":"info","mensaje":"swagger_montado","ruta":"/api-docs"}
{"ts":"...","nivel":"info","mensaje":"servidor_iniciado","puerto":3000}
```

Recursos disponibles:

| Recurso | URL |
|---|---|
| **Documentación Swagger UI** | <http://localhost:3000/api-docs> |
| Especificación OpenAPI (JSON) | <http://localhost:3000/api-docs.json> |
| Chequeo de salud | <http://localhost:3000/api/v1/health> |

#### Uso de Swagger para la demostración

1. Abra <http://localhost:3000/api-docs>.
2. Ejecute `POST /auth/login` con las credenciales de administrador.
3. Copie el `token` devuelto en `data.token`.
4. Pulse **Authorize** (candado superior derecho) e introduzca el token.
5. Los endpoints protegidos quedan habilitados para prueba interactiva.

Los endpoints marcados con el icono de candado requieren autenticación; los
únicos públicos son `/health` y `/auth/login`.

### 5.7 Paso 6 — Arranque del frontend

En una terminal distinta:

```bash
cd frontend
npm install          # usar `npx npm@11 install` si dispone de npm 10
npm start
```

La aplicación queda disponible en <http://localhost:4200>. El origen
`http://localhost:4200` debe figurar en `CORS_ORIGINS`; en caso contrario el
navegador bloqueará las peticiones.

### 5.8 Flujo funcional de demostración

1. **Acceso** — iniciar sesión con una cuenta institucional (`@umg.edu.gt` o
   `@miumg.edu.gt`).
2. **Panel principal** — consulta de métricas agregadas e historial.
3. **Sorteo** — seleccionar modalidad → cargar nóminas en Excel (existe un
   generador de plantillas integrado) → ejecutar los sorteos → registrar.
4. **Reportes** — exportar el acta oficial en formato `.xlsx`.

### 5.9 Consideraciones para despliegue en producción

| Variable | Valor requerido | Motivo |
|---|---|---|
| `NODE_ENV` | `production` | Desactiva Swagger y las trazas en bitácora |
| `SWAGGER_ENABLED` | `false` | La documentación describe la superficie de ataque |
| `DB_PASSWORD` | No vacía | Validado al arranque |
| `CORS_ORIGINS` | Dominio real | Nunca `*` |
| `TRUST_PROXY` | `true` si hay proxy inverso | Necesario para que el limitador identifique la IP real |

Adicionalmente: servir la aplicación exclusivamente sobre **HTTPS** y
configurar una **Content-Security-Policy** en el servidor web que publique
`frontend/dist/`.

---

## 6. Métricas de calidad y pruebas

### 6.1 Resumen

| Métrica | Backend | Frontend | Total |
|---|---|---|---|
| **Pruebas automatizadas** | **40** | **50** | **90** |
| **Pruebas superadas** | 40 (100 %) | 50 (100 %) | **90 (100 %)** |
| **Vulnerabilidades (`npm audit`)** | **0** | **0** | **0** |

### 6.2 Ejecución

```bash
cd backend  && npm test && npm audit
cd frontend && npx ng test --no-watch && npm audit
```

### 6.3 Cobertura del backend (40 pruebas)

Las pruebas sustituyen la capa de repositorios por dobles en memoria, lo que
permite validar el comportamiento completo de la API **sin requerir una base de
datos activa**.

| Área | Casos verificados |
|---|---|
| Autenticación | Acceso correcto; contraseña incorrecta; correo inexistente; **mensaje idéntico en ambos fallos** (no enumeración); token ausente, inválido, caducado o firmado con otro secreto; cabecera `Authorization` mal formada |
| Cifrado | **Una contraseña almacenada en texto plano no permite iniciar sesión** |
| Autorización | Rol insuficiente rechazado (403) en listado de usuarios, creación y eliminación de asignaciones |
| Protección de datos | `password_hash` ausente en todas las respuestas |
| Validación | Campos obligatorios; formato de correo; **campos no declarados rechazados**; JSON malformado; formato de fecha de lote |
| Límites | Cuerpo superior a 10 kB → **413**; lote de 150 estudiantes → 422 |
| Lógica de negocio | Registro de terna y de jurado; jurado incompleto rechazado; modalidad por defecto; modalidad inexistente |
| Infraestructura | Cabeceras de Helmet; identificador de petición; lista blanca de CORS; ruta inexistente; **un fallo de base de datos no filtra el código SQL ni el nombre del esquema** |

### 6.4 Cobertura del frontend (50 pruebas)

| Área | Casos verificados |
|---|---|
| Guarda de rutas | Bloqueo sin sesión; redirección conservando el destino; acceso con sesión; bloqueo tras cerrar sesión |
| Interceptor | Adjunta el token a la API; no lo adjunta sin sesión; **no lo envía a dominios ajenos**; **no se deja engañar por una URL que contenga la de la API en la cadena de consulta**; un 401 limpia la sesión |
| Autenticación | Acceso correcto y fallido; endpoint y campo `password` correctos; **la contraseña nunca llega al almacenamiento del navegador**; se persiste únicamente la identidad mínima; sesión corrupta descartada |
| Formulario de acceso | Campos obligatorios; dominio institucional sin gastar petición; navegación tras acceso; borrado de la contraseña en memoria; mensaje genérico ante credenciales incorrectas; **no se filtra el detalle del servidor** |
| **Saneamiento de Excel** | Rechazo de múltiples archivos, extensiones no permitidas, archivo vacío y archivo excesivo; **una cadena maliciosa de Excel no produce ningún elemento HTML**; neutralización de prefijos de fórmula; eliminación de caracteres de control; truncamiento; descarte de nulos y objetos; límite de filas |
| **Regresión algorítmica** | **`cupoBase`, `sobrantes` y `cantidadTernas` conservan sus valores**, verificando que la reestructuración no alteró la matemática del sorteo |

### 6.5 Verificación de integridad del algoritmo

Requisito metodológico del trabajo: la lógica matemática de distribución y los
algoritmos de selección debían permanecer **funcionalmente idénticos** tras la
reestructuración arquitectónica. La verificación se realizó por dos vías
independientes:

1. **Inspección del control de versiones.** El análisis diferencial confirma que
   ninguna línea correspondiente a `cupoBase`, `sobrantes`, `cantidadTernas`,
   la permutación de Fisher-Yates, la selección aleatoria o el cálculo de
   rotación fue modificada. Los únicos cambios en `sorteo.ts` afectan a la capa
   de transporte (URL y servicio), al saneamiento de la entrada y a la
   sustitución de `html:` por `text:` en los diálogos.
2. **Pruebas de regresión.** Casos automatizados que fijan los valores de salida
   del cálculo de cupos para ambas modalidades.

---

## 7. Estructura de directorios

```
TesisDouglasPineda/
│
├── backend/                          API REST (Node.js + Express)
│   ├── server.js                     Arranque: valida entorno, verifica BD, escucha
│   ├── database_schema.sql           Esquema de MariaDB e índices
│   ├── .env.example                  Plantilla de configuración
│   │
│   ├── src/
│   │   ├── app.js                    Ensamblado de Express y orden de middlewares
│   │   │
│   │   ├── config/
│   │   │   ├── env.js                Validación estricta del entorno (Zod)
│   │   │   ├── db.js                 Pool de conexiones a MariaDB
│   │   │   ├── logger.js             Bitácora JSON con redacción de secretos
│   │   │   └── swagger.js            Especificación OpenAPI 3.0.3
│   │   │
│   │   ├── routes/                   Rutas + anotaciones OpenAPI
│   │   │   ├── index.js              Agregador de la versión v1
│   │   │   ├── auth.routes.js
│   │   │   ├── usuarios.routes.js
│   │   │   ├── asignaciones.routes.js
│   │   │   ├── tiposEvento.routes.js
│   │   │   └── health.routes.js
│   │   │
│   │   ├── controllers/              Traducción HTTP ↔ servicio
│   │   ├── services/                 Reglas de negocio
│   │   ├── repositories/             ÚNICA capa con SQL
│   │   ├── validators/               Esquemas Zod de entrada
│   │   ├── middlewares/              auth · validate · rateLimit · errorHandler
│   │   ├── dtos/                     Construcción de respuesta por lista blanca
│   │   └── utils/                    AppError · asyncHandler · password · respuesta
│   │
│   ├── scripts/
│   │   └── migrate-passwords.js      Migración de contraseñas a bcrypt
│   │
│   ├── tests/                        40 pruebas (node:test + supertest)
│   │   ├── auth.test.js
│   │   ├── seguridad.test.js
│   │   ├── asignaciones.test.js
│   │   └── helpers/entorno.js
│   │
│   ├── docs/
│   │   └── ESQUEMA-BD.md             Análisis del desajuste del esquema
│   └── README.md                     Documentación técnica de la API
│
├── frontend/                         Cliente SPA (Angular 21)
│   ├── src/
│   │   ├── environments/             URL base de la API por entorno
│   │   │
│   │   └── app/
│   │       ├── app.config.ts         Proveedores e interceptores
│   │       ├── app.routes.ts         Enrutamiento con guardas
│   │       │
│   │       ├── core/
│   │       │   ├── excel-seguro.ts   Validación y saneamiento de Excel
│   │       │   └── api-error.ts      Traducción centralizada de errores
│   │       │
│   │       ├── models/
│   │       │   └── api.ts            DTOs tipados del contrato REST
│   │       │
│   │       ├── guards/
│   │       │   └── auth-guard.ts     Protección de rutas
│   │       │
│   │       ├── interceptors/
│   │       │   └── auth-interceptor.ts   Inyección del token Bearer
│   │       │
│   │       ├── services/
│   │       │   ├── auth.ts           Autenticación y sesión
│   │       │   └── asignacion.ts     Acceso HTTP a asignaciones
│   │       │
│   │       └── pages/                (+ 50 pruebas en archivos .spec.ts)
│   │           ├── login/
│   │           ├── dashboard/
│   │           ├── sorteo/           Motor de sorteo y ruletas
│   │           └── reportes/         Generación de actas
│   │
│   └── SEGURIDAD.md                  Informe de seguridad del cliente
│
├── backver.js/                       Plantilla heredada (solo referencia)
└── README.md                         Este documento
```

> **Sobre `backver.js/`.** Plantilla estructural de una versión anterior,
> conservada como referencia documental. **Ninguno de sus componentes se
> reutilizó.** Contiene credenciales de base de datos escritas en el código
> fuente e interpolación dinámica de SQL en cláusulas `WHERE` —patrón vulnerable
> a inyección—, defectos cuya corrección motivó la reestructuración descrita en
> este documento. Se mantiene en el repositorio por su valor ilustrativo en la
> comparación de arquitecturas; **no debe desplegarse**.

---

## 8. Autoría

| Campo | Dato |
|---|---|
| **Autor** | Douglas Estuardo Pineda Hernández |
| **Número de carné** | 1890-22-2255 |
| **Carrera** | Ingeniería en Sistemas de Información y Ciencias de la Computación |
| **Facultad** | Facultad de Ingeniería en Sistemas de Información |
| **Universidad** | Universidad Mariano Gálvez de Guatemala |
| **Contacto** | douglasestuardo16@gmail.com |
| **Repositorio** | `SistemaAsignacionTesis` |
| **Año** | 2026 |

<!--
  Complete antes de la entrega formal los datos que esta plantilla no puede
  determinar automáticamente:
    · Número de carné
    · Nombre del asesor de tesis
    · Nombre del revisor
    · Sede / campus
    · Título exacto aprobado por el consejo de facultad
-->

---

## Licencia

Trabajo académico presentado como requisito parcial para optar al título de
Ingeniero en Sistemas. Todos los derechos reservados por el autor y la
Universidad Mariano Gálvez de Guatemala.
