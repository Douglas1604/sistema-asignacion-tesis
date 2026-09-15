# Despliegue detrás del API Gateway Ocelot (Dokploy)

Este documento describe cómo publicar la API `tesis-ruleta` detrás de un
API Gateway [Ocelot](https://ocelot.readthedocs.io/) desplegado con Dokploy.

## 1. Topología

```
Navegador (frontend Angular)
        │  HTTPS  https://gateway.ejemplo.edu.gt/api/tesis-ruleta/...
        ▼
┌──────────────────────┐
│  Traefik (Dokploy)   │  TLS, dominio público
└──────────┬───────────┘
           ▼
┌──────────────────────┐   upstream:   /api/tesis-ruleta/{everything}
│  Ocelot API Gateway  │
└──────────┬───────────┘   downstream: /api/v1/{everything}
           │  HTTP interno, red `backend-network`
           ▼
┌──────────────────────┐
│ tesis-ruleta-backend │  Node 22 Alpine, usuario `node`, puerto 3000
└──────────┬───────────┘
           ▼
       MariaDB
```

El contenedor del backend **no publica puertos en el host** (`expose`, no
`ports`): solo es alcanzable desde contenedores unidos a `backend-network`.
El único punto de entrada público es el gateway.

## 2. Mapeo de rutas

| Petición pública (upstream)                              | Petición al backend (downstream)            |
|----------------------------------------------------------|---------------------------------------------|
| `GET  /api/tesis-ruleta/health`                          | `GET  /api/v1/health`                       |
| `POST /api/tesis-ruleta/auth/login`                      | `POST /api/v1/auth/login`                   |
| `GET  /api/tesis-ruleta/asignaciones?pagina=1`           | `GET  /api/v1/asignaciones?pagina=1`        |
| `DELETE /api/tesis-ruleta/asignaciones/lote/{lote_id}`   | `DELETE /api/v1/asignaciones/lote/{lote_id}`|

La cadena de consulta se reenvía sin cambios. Los identificadores de lote son
UUID (sin `/`, `:` ni espacios), así que atraviesan el gateway sin depender de
cómo decodifique la URL.

## 3. Configuración de Ocelot (`ocelot.json`)

```json
{
  "Routes": [
    {
      "Key": "tesis-ruleta",
      "UpstreamPathTemplate": "/api/tesis-ruleta/{everything}",
      "UpstreamHttpMethod": [ "Get", "Post", "Put", "Patch", "Delete", "Options" ],

      "DownstreamPathTemplate": "/api/v1/{everything}",
      "DownstreamScheme": "http",
      "DownstreamHostAndPorts": [
        { "Host": "tesis-ruleta-backend", "Port": 3000 }
      ],

      "UpstreamHeaderTransform": {
        "X-Forwarded-For": "{RemoteIpAddress}",
        "X-Forwarded-Proto": "https"
      },

      "QoSOptions": {
        "ExceptionsAllowedBeforeBreaking": 5,
        "DurationOfBreak": 30000,
        "TimeoutValue": 15000
      }
    }
  ],
  "GlobalConfiguration": {
    "BaseUrl": "https://gateway.ejemplo.edu.gt"
  }
}
```

Notas sobre cada bloque:

- **`DownstreamHostAndPorts.Host`**: es el nombre del servicio en
  `docker-compose.yml`. Docker lo resuelve por DNS dentro de `backend-network`.
- **`{everything}`**: captura el resto de la ruta, incluidos varios segmentos
  (`asignaciones/lote/<uuid>/alumno/<carnet>`). No coincide con la ruta vacía
  `/api/tesis-ruleta/`, que no existe en la API.
- **`UpstreamHeaderTransform`**: Ocelot no añade `X-Forwarded-For` por sí
  mismo. Sin esta cabecera, todas las peticiones llegarían con la IP del
  gateway y el rate limit del backend (300 peticiones/15 min generales,
  10 intentos de login/15 min) bloquearía a todos los usuarios a la vez.
- **`QoSOptions`**: requiere el paquete `Ocelot.Provider.Polly`. Es opcional;
  si se omite, Ocelot aplica su tiempo de espera por defecto (90 s).
- **Autenticación**: no se configura `AuthenticationOptions`. El backend valida
  el JWT por sí mismo; Ocelot reenvía la cabecera `Authorization` intacta.
- **CORS**: lo resuelve el backend. No habilitar CORS en Ocelot para esta ruta
  (se duplicarían las cabeceras `Access-Control-*` y el navegador rechazaría la
  respuesta). El método `Options` se incluye para que el preflight llegue al
  backend.

## 4. Variables de entorno del backend

Se definen en Dokploy (pestaña *Environment* del proyecto Compose) o en un
`.env` junto a `docker-compose.yml`. Plantilla completa: `backend/.env.example`.

| Variable        | Valor en producción                                  | Motivo |
|-----------------|------------------------------------------------------|--------|
| `NODE_ENV`      | `production` (fijado en el compose)                  | Desactiva Swagger y detalles de error. |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Credenciales de MariaDB | Obligatorias; `DB_PASSWORD` no puede ir vacía en producción. |
| `JWT_SECRET`    | ≥ 32 caracteres aleatorios                           | Obligatoria. Escapar `$` como `$$` en compose. |
| `CORS_ORIGINS`  | Origen del **frontend**, p. ej. `https://tesis.ejemplo.edu.gt` | El navegador envía el origen del frontend, no el del gateway. |
| `TRUST_PROXY`   | `true` (por defecto en el compose)                   | Express confía en **un** salto de proxy (Ocelot) para leer `X-Forwarded-For`. |

Sobre `TRUST_PROXY`: la API confía exactamente en el último salto. Si Ocelot
está a su vez detrás de Traefik, configure en Ocelot el middleware
`ForwardedHeaders` de ASP.NET Core para que `{RemoteIpAddress}` sea la IP del
cliente y no la de Traefik.

## 5. Red compartida con Ocelot

`docker-compose.yml` crea la red con nombre fijo `backend-network`. El
proyecto de Ocelot (otro Compose en Dokploy) debe unirse a ella como externa:

```yaml
services:
  ocelot-gateway:
    # ...
    networks:
      - backend-network
      - dokploy-network   # para que Traefik publique el gateway

networks:
  backend-network:
    external: true
  dokploy-network:
    external: true
```

Si MariaDB también corre como contenedor, únalo a `backend-network` y use su
nombre de servicio como `DB_HOST`.

## 6. Salud y arranque

- `GET /api/v1/health` responde `200` si la API y la base de datos responden y
  `503` si la base de datos no está disponible. Es público y no consume el rate
  limit.
- El `healthcheck` del compose (y el `HEALTHCHECK` del `Dockerfile`) usa `fetch`
  nativo de Node: un `503` marca el contenedor como *unhealthy*.
- `server.js` comprueba la base de datos **antes** de abrir el puerto; si no hay
  conexión el proceso termina con código 1 y `restart: unless-stopped` lo
  reintenta.
- Ante `SIGTERM` (redeploy en Dokploy) la API deja de aceptar conexiones, drena
  las peticiones en curso y cierra el pool (máximo 10 s).

Verificación a través del gateway:

```bash
curl -i https://gateway.ejemplo.edu.gt/api/tesis-ruleta/health
```

## 7. Migración de base de datos previa al despliegue

Esta versión incorpora la columna `asignaciones.lote_id`. En una base existente,
aplicar **antes** de desplegar la nueva imagen (con respaldo previo):

```bash
mariadb-dump -u <usuario> -p tesis_ruleta asignaciones > respaldo_asignaciones.sql
mariadb -u <usuario> -p tesis_ruleta < backend/migrations/001_asignaciones_lote_id.sql
```

La migración es idempotente y conserva el agrupamiento de las actas históricas
(un lote por modalidad y minuto, igual que se mostraban antes).

## 8. Frontend

En `frontend/src/environments/environment.prod.ts`, `apiUrl` debe apuntar al
upstream del gateway:

```ts
apiUrl: 'https://gateway.ejemplo.edu.gt/api/tesis-ruleta',
```

## 9. Lista de comprobación

- [ ] Migración `001_asignaciones_lote_id.sql` aplicada y verificada.
- [ ] Variables obligatorias definidas en Dokploy (`DB_*`, `JWT_SECRET`, `CORS_ORIGINS`).
- [ ] Ocelot unido a `backend-network`; ruta `/api/tesis-ruleta/{everything}` cargada.
- [ ] `X-Forwarded-For` configurado en Ocelot y `TRUST_PROXY=true` en el backend.
- [ ] `curl .../api/tesis-ruleta/health` devuelve 200 a través del gateway.
- [ ] El puerto 3000 del backend **no** es accesible desde fuera del host.
