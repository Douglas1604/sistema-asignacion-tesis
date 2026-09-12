# Notas de seguridad del frontend

Documento de apoyo a la revisión del cliente Angular.

---

## Supuestos del contrato con la API

| Supuesto | Valor |
|---|---|
| Base de la API | `environment.apiUrl` (dev: `http://localhost:3000/api/v1`) |
| Estrategia de sesión | **JWT Bearer** en la cabecera `Authorization` |
| Envoltura de éxito | `{ success: true, data, meta? }` |
| Envoltura de error | `{ success: false, error: { code, message, details?, requestId? } }` |
| Campo de contraseña | `password` (nunca `password_hash`) |

Endpoints consumidos:

```
POST   /api/v1/auth/login
GET    /api/v1/auth/me
GET    /api/v1/asignaciones
POST   /api/v1/asignaciones
DELETE /api/v1/asignaciones/lote?fecha=
DELETE /api/v1/asignaciones/alumno/:carnet/:fecha
GET    /api/v1/tipos-evento
```

No queda ninguna URL escrita a mano en componentes ni servicios.

---

## Por qué Bearer y no cookies httpOnly

Las cookies `httpOnly; Secure; SameSite` serían preferibles: el token quedaría
fuera del alcance de JavaScript y un XSS no podría robarlo. **No se han usado
porque el backend actual autentica con JWT Bearer**, y el cliente necesita leer
el token para ponerlo en la cabecera.

Consecuencia asumida: el token vive en `localStorage` y es legible por
JavaScript. Las mitigaciones aplicadas son:

1. No se construye HTML con datos no confiables (ver XSS más abajo).
2. Se guarda lo mínimo: token + `{ id, email, rol }`. Nunca contraseñas.
3. Un 401 limpia la sesión de inmediato.
4. El token caduca en el servidor (`JWT_EXPIRES_IN`, 8 h por defecto).

**Si se migra a sesiones por cookie**, los cambios son acotados: eliminar el
`setHeaders` del interceptor, añadir `withCredentials: true`, y dejar de
guardar el token. El resto del cliente no cambia.

---

## XSS: qué había y qué se hizo

**Hallazgo.** `sorteo.ts` mostraba los resultados con la opción `html:` de
SweetAlert2, interpolando datos leídos de un Excel:

```ts
html: `<h2 ...>${ganador.nombre_completo}</h2>`   // ANTES
```

SweetAlert2 inserta ese contenido como marcado. Una celda con
`<img src=x onerror="...">` se ejecutaba dentro de la aplicación, con acceso al
`localStorage` y, por tanto, al token de sesión. El vector no requería
comprometer el servidor: bastaba con que alguien subiera un `.xlsx` preparado.

**Corrección.** Los cuatro bloques usan ahora `text:`, que SweetAlert2 inserta
como texto y nunca interpreta. No queda ningún `html:` en el proyecto.

Nota: se perdió el formato decorativo (colores y separadores) de esos cuatro
diálogos; la información mostrada es la misma. Si se quiere recuperar el
diseño, la vía segura es construir nodos DOM y asignar los valores con
`textContent`, nunca reintroducir plantillas de cadena.

---

## Tratamiento del Excel como entrada no confiable

Todo pasa por `src/app/core/excel-seguro.ts`.

Validación del archivo, antes de leer un byte:

| Control | Valor |
|---|---|
| Un solo archivo | Obligatorio |
| Extensión | `.xlsx`, `.xls` |
| MIME | Comprobado si el navegador lo declara (señal secundaria) |
| Tamaño | 5 MB máximo; se rechaza el archivo vacío |

Normalización de cada celda (`normalizarCelda`):

- Descarta nulos y objetos.
- Elimina caracteres de control.
- **Neutraliza el prefijo de fórmula** (`=`, `+`, `-`, `@`) anteponiendo `'`.
  Sin esto, un nombre como `=HYPERLINK(...)` se ejecutaría como fórmula al
  reexportar el acta (inyección de fórmulas).
- Colapsa espacios y recorta a 100 caracteres (50 para el carnet), en línea con
  las columnas del backend.

Límites de proceso: 2000 filas y 10 columnas. Una hoja manipulada puede declarar
millones de celdas y bloquear la pestaña. Cuando se descartan filas o se alcanza
el límite, **se avisa al usuario**: antes un archivo mal formado reducía el
número de participantes sin que nadie se enterara.

El parseo va dentro de `try/catch`, y `reader.onerror` está implementado: antes,
un archivo corrupto fallaba en silencio.

---

## Dependencias

Estado inicial: **44 vulnerabilidades (2 críticas, 29 altas)**.
Estado final: **0**.

No se usó `npm audit fix --force`. Se hicieron actualizaciones controladas,
verificando la compilación después:

| Paquete | De | A | Motivo |
|---|---|---|---|
| `@angular/*` | 21.1.4 | 21.2.23 | **4 avisos de evasión del saneador (XSS)** |
| `@angular/build`, `@angular/cli` | 21.1.4 | 21.2.24 | Cadena de compilación |
| `vitest` | 4.0.8 | 4.1.11 | Aviso crítico |
| `xlsx` | 0.18.5 | **0.20.3** | Prototype pollution + ReDoS |

Dos notas sobre el proceso:

1. `npm audit fix` y `npm install` fallaban con
   `Cannot read properties of null (reading 'edgesOut')`. Es un fallo de
   arborist en npm 10.9.2 al resolver los `peer` de vitest, no un conflicto
   real. Se resolvió instalando con npm 11 (`npx npm@11 install`).

2. **`xlsx` se instala desde el CDN oficial de SheetJS**, no desde npm:

   ```json
   "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
   ```

   El paquete de npm está abandonado en 0.18.5 y npm no ofrece arreglo; SheetJS
   distribuye desde su propio CDN desde 0.19. Es la remediación que documenta el
   proveedor. **Implicación:** esa dependencia ya no se resuelve desde el
   registro de npm; en un entorno sin acceso a `cdn.sheetjs.com` la instalación
   fallará. Conviene tenerlo presente al configurar CI.

Angular 22 existe, pero es un cambio de versión mayor: se mantuvo la serie 21,
donde los avisos ya están corregidos.

---

## Riesgos que siguen abiertos

1. **El token es legible por JavaScript.** Inherente a Bearer + almacenamiento
   en el navegador. Se mitiga, no se elimina. La solución de fondo son cookies
   httpOnly, que exigen cambios en el backend.

2. **`xlsx` sigue siendo un analizador de formatos complejos** ejecutándose en
   el hilo principal. Ya no tiene avisos abiertos, pero procesa un formato
   grande y difícil. Si se quiere reducir la exposición, las opciones son
   llevar el parseo a un Web Worker (aísla el hilo de interfaz) o hacerlo en el
   servidor.

3. **No hay Content-Security-Policy.** La aplicación se sirve como estáticos sin
   cabeceras. Una CSP daría una segunda línea de defensa frente a XSS. Hay que
   configurarla en el servidor web que publique `dist/`.

4. **El paquete inicial pesa 912 kB**, por encima del presupuesto de 500 kB.
   Es un problema de rendimiento, no de seguridad; `xlsx` y `sweetalert2` son
   la mayor parte. Se resolvería con carga diferida por ruta.

5. **La guarda y la validación de dominio no protegen nada.** Son ayudas de
   interfaz, y así están documentadas en el código. Quien autoriza es el
   backend.

---

## Pruebas

```bash
npm test        # 50 pruebas
npm run build
npm audit
```

Cobertura de seguridad añadida:

- La guarda bloquea sin sesión, permite con ella y vuelve a bloquear tras salir.
- El interceptor adjunta el token a la API, **no** lo adjunta a dominios ajenos
  y **no** se deja engañar por una URL que contenga la de la API en la query.
- Un 401 limpia la sesión.
- El login maneja éxito, credenciales incorrectas y caída del servidor.
- La contraseña nunca llega al almacenamiento del navegador.
- Una cadena maliciosa de Excel no produce ningún elemento HTML.
- Los prefijos de fórmula quedan neutralizados.
- **Salvaguarda:** `cupoBase`, `sobrantes` y `cantidadTernas` siguen dando los
  mismos valores. La matemática del sorteo no se tocó.
