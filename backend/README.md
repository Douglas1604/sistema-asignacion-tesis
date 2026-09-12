# API Ruleta de Asignaciones Académicas

API REST del sistema de sorteo de asignaciones académicas (UMG).
Node.js + Express 5 + MariaDB.

---

## Puesta en marcha

```bash
cd backend
npm install
cp .env.example .env      # y completar los valores
npm run migrate:passwords # ver "Migración de contraseñas" más abajo
npm run dev               # o: npm start
```

El servidor **no arranca** si falta alguna variable de entorno obligatoria o si
`JWT_SECRET` conserva el valor de ejemplo. Genera uno propio con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| Recurso | URL |
|---|---|
| API | `http://localhost:3000/api/v1` |
| Documentación (Swagger UI) | `http://localhost:3000/api-docs` |
| Especificación OpenAPI | `http://localhost:3000/api-docs.json` |
| Chequeo de salud | `http://localhost:3000/api/v1/health` |

La documentación **no se publica en producción**, aunque `SWAGGER_ENABLED`
diga lo contrario.

---

## Migración de contraseñas (obligatoria una sola vez)

La versión anterior de la API comparaba la contraseña escrita por el usuario
**directamente** contra la columna `password_hash`, que guardaba texto plano.
La API nueva solo acepta hashes bcrypt, así que esas cuentas **no podrán
iniciar sesión** hasta migrarlas:

```bash
npm run migrate:passwords         # simulación: informa, no escribe nada
npm run migrate:passwords:apply   # aplica los cambios
```

El script toma el valor actual de la columna como si fuera la contraseña en
claro y lo sustituye por su hash. **Los usuarios conservan su contraseña**;
solo cambia cómo se almacena. Después, pídeles que la cambien: los valores
heredados eran débiles y estuvieron guardados en claro.

---

## Estructura

```
backend/
├── server.js                  Arranque: valida entorno, comprueba BD, escucha
├── src/
│   ├── app.js                 Ensamblado de Express y orden de middlewares
│   ├── config/
│   │   ├── env.js             Validación estricta del entorno (Zod)
│   │   ├── db.js              Pool de MariaDB
│   │   ├── logger.js          Log estructurado con redacción de secretos
│   │   └── swagger.js         Definición OpenAPI y montaje de la UI
│   ├── routes/                Definición de rutas + anotaciones OpenAPI
│   ├── controllers/           Traducen HTTP <-> servicio (sin lógica)
│   ├── services/              Reglas de negocio
│   ├── repositories/          ÚNICA capa con SQL
│   ├── validators/            Esquemas Zod de entrada
│   ├── middlewares/           auth, validate, rateLimit, errorHandler
│   ├── dtos/                  Conversión fila -> respuesta (lista blanca)
│   └── utils/                 AppError, asyncHandler, password, respuesta
├── scripts/migrate-passwords.js
├── tests/                     Pruebas de la API (node:test + supertest)
└── docs/ESQUEMA-BD.md         Desajuste del esquema y plan de corrección
```

Regla de dependencias: `routes -> controllers -> services -> repositories`.
Un controlador nunca importa el pool, y un repositorio nunca conoce HTTP.

---

## Endpoints

Solo dos son públicos: el chequeo de salud y el login. **Todo lo demás exige
un token Bearer.**

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/health` | Público |
| POST | `/auth/login` | Público (límite estricto de intentos) |
| GET | `/auth/me` | Autenticado |
| GET | `/usuarios` | **Admin** |
| GET | `/usuarios/:id` | **Admin** |
| GET | `/tipos-evento` | Autenticado |
| GET | `/asignaciones` | Autenticado |
| POST | `/asignaciones` | **Admin** |
| DELETE | `/asignaciones/lote?fecha=` | **Admin** |
| DELETE | `/asignaciones/alumno/:carnet/:fecha` | **Admin** |

### Formato de respuesta

Éxito:

```json
{ "success": true, "data": { }, "meta": { "total": 120, "pagina": 1, "limite": 20 } }
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La petición contiene datos inválidos",
    "details": [{ "campo": "body.email", "mensaje": "El correo es obligatorio" }],
    "requestId": "3f2a..."
  }
}
```

El `requestId` también viaja en la cabecera `X-Request-Id` y aparece en los
logs: permite localizar la traza exacta de un fallo sin exponer detalles
internos al cliente.

| Código | Significado |
|---|---|
| `BAD_REQUEST` (400) | JSON malformado |
| `UNAUTHORIZED` (401) | Sin token, token inválido o expirado |
| `FORBIDDEN` (403) | Autenticado pero sin el rol necesario |
| `NOT_FOUND` (404) | Ruta o recurso inexistente |
| `CONFLICT` (409) | Registro duplicado |
| `PAYLOAD_TOO_LARGE` (413) | Cuerpo por encima del límite |
| `VALIDATION_ERROR` (422) | Datos que no pasan validación |
| `RATE_LIMIT_EXCEEDED` (429) | Demasiadas peticiones |
| `INTERNAL_ERROR` (500) | Fallo interno (sin detalles hacia el cliente) |

---

## Controles de seguridad

| Control | Implementación |
|---|---|
| Autenticación | JWT Bearer con emisor y caducidad verificados |
| Contraseñas | bcrypt; un valor no-bcrypt **nunca** se acepta |
| Autorización | `requireRole` por router; escritura restringida a `admin` |
| Validación | Zod con `.strict()`: un campo no declarado hace fallar la petición |
| SQL | Consultas parametrizadas y columnas explícitas; sin `SELECT *` |
| Fuga de datos | DTOs por lista blanca; `password_hash` nunca sale |
| Límite de cuerpo | `express.json({ limit: "10kb" })` -> 413 |
| Límite de lote | `MAX_ALUMNOS_POR_LOTE` (100 por defecto) |
| Rate limiting | Global + limitador estricto en login |
| Cabeceras | Helmet (CSP, nosniff, frameguard, HSTS...) y `x-powered-by` desactivado |
| CORS | Lista blanca desde `CORS_ORIGINS`; `*` rechazado al arrancar |
| Errores | Manejador central; los errores SQL no llegan al cliente |
| Configuración | Validada al arrancar; sin credenciales en el código |
| Auditoría | Log JSON de login, accesos denegados, creación y borrado |

Enumeración de usuarios: el login devuelve el mismo mensaje y el mismo código
tanto si el correo no existe como si la contraseña es incorrecta.

---

## Pruebas

```bash
npm test
```

40 pruebas sobre la API, sin necesidad de base de datos (los repositorios se
sustituyen por dobles). Cubren: login correcto y fallido, acceso sin token y
con token inválido, token firmado con otro secreto, cuerpo sobredimensionado
(413), payloads inválidos (400/422), autorización por rol (403), ausencia de
`password_hash` en las respuestas, cabeceras de Helmet, lista blanca de CORS y
no filtración de errores SQL.

```bash
npm run audit   # auditoría de dependencias de producción
```

---

## Variables de entorno

Ver `.env.example`. Las obligatorias sin valor por defecto son `DB_HOST`,
`DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET` y `CORS_ORIGINS`.

Para producción: `NODE_ENV=production` (desactiva Swagger y los stacks en los
logs), `SWAGGER_ENABLED=false`, `DB_PASSWORD` no vacía, `CORS_ORIGINS` con el
dominio real y `TRUST_PROXY=true` si hay un proxy inverso delante.

---

## Notas

- **Esquema de base de datos:** `database_schema.sql` estaba desalineado con la
  base real. Ver `docs/ESQUEMA-BD.md`.
- **`backver.js/`:** plantilla antigua, usada solo como referencia estructural.
  Contiene credenciales de base de datos escritas en el código y SQL dinámico
  interpolado; **nada de ese código se ha reutilizado**.
- **Lógica del sorteo:** el reparto de cupos (`cupoBase`, sobrantes, ternas) y
  los algoritmos de la ruleta no se han tocado. Los formatos de texto que
  produce el sorteo forman parte del contrato con la pantalla de reportes.
