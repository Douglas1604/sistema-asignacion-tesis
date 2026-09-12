# Desajuste entre `database_schema.sql` y la base de datos real

> Documento de hallazgos. Léelo antes de tocar el esquema.

Durante la refactorización se comprobó la base de datos `tesis_ruleta` en
ejecución y **no coincide con `database_schema.sql`**. La API se implementó
contra la base de datos **real**, que es la que usa la aplicación hoy.

## Lo que existe realmente

Tablas presentes: `asignaciones`, `roles`, `tipos_evento`, `usuarios`.

```
asignaciones   id, profesor_nombre, alumno_carnet, alumno_nombre,
               tipo_evento_id, fecha_asignacion
roles          id, nombre, descripcion
tipos_evento   id, nombre, descripcion
usuarios       id, username, password_hash, email, rol_id, creado_en
```

## Lo que declara `database_schema.sql`

| Elemento | Estado real |
|---|---|
| Tabla `profesores` | **No existe** |
| Tabla `alumnos` | **No existe** |
| Tabla `periodos` | **No existe** |
| Tabla `auditoria_asignaciones` | **No existe** |
| `asignaciones.alumno_id` (FK) | **No existe**; hay `alumno_carnet` + `alumno_nombre` |
| `asignaciones.profesor_id` (FK) | **No existe**; hay `profesor_nombre` (texto) |
| `asignaciones.periodo_id` (FK) | **No existe** |
| `asignaciones.asignado_por_usuario_id` | **No existe** |
| `UNIQUE (alumno_id, periodo_id)` | **No existe** |

En resumen: el archivo describe un modelo **normalizado** con claves foráneas,
mientras que la base de datos real guarda las asignaciones de forma
**desnormalizada**, con los nombres copiados como texto.

## Por qué importa

1. **La restricción anti-fraude no está activa.** El comentario del `.sql`
   destaca `UNIQUE KEY uk_alumno_periodo_global (alumno_id, periodo_id)` como
   "CONSTRAINT CRÍTICO (ANTI-FRAUDE)" para impedir que un alumno quede asignado
   dos veces. Esa restricción **no existe en la base real**, así que hoy nada a
   nivel de base de datos impide asignar dos veces al mismo alumno.

2. **No hay integridad referencial.** `profesor_nombre` es texto libre: si el
   nombre de un catedrático cambia, los registros históricos no se actualizan y
   tampoco hay forma de detectar erratas.

3. **El borrado por lote depende del formato de fecha.** Un lote se identifica
   por `DATE_FORMAT(fecha_asignacion, '%d/%m/%Y %H:%i')`. Como la precisión es
   de minutos, dos sorteos distintos guardados en el mismo minuto se
   considerarían el mismo lote y se borrarían juntos.

4. **`usuarios` no tiene columna `activo`.** No se puede desactivar una cuenta
   sin borrarla.

## Decisión tomada

La API se ha implementado **contra el esquema real**, sin migrar los datos de
sitio. Motivo: migrar al modelo normalizado obligaría a reescribir cómo el
sorteo compone `profesor_nombre` (por ejemplo `"Grupo 1 de Administración de
Sistemas - Ing. Pérez"` o `"Ing. Pérez (Presidente)"`), y esa lógica está
explícitamente fuera del alcance de esta refactorización.

## Qué hacer a continuación

Dos caminos posibles. Elegir uno:

**Opción A — Sincronizar el `.sql` con la realidad (menor riesgo).**
Ya aplicada en `database_schema.sql`: el archivo ahora describe el esquema real
y las tablas no usadas quedan marcadas como propuesta futura. Añadir, como
mínimo, estos índices, que la base real tampoco tiene:

```sql
CREATE INDEX idx_asignaciones_fecha       ON asignaciones (fecha_asignacion);
CREATE INDEX idx_asignaciones_carnet      ON asignaciones (alumno_carnet);
CREATE INDEX idx_asignaciones_tipo_evento ON asignaciones (tipo_evento_id);
```

Sin ellos, el borrado por lote y el borrado por alumno recorren la tabla
entera en cada llamada.

**Opción B — Migrar al modelo normalizado (mayor alcance).**
Crear `alumnos`, `profesores` y `periodos`, rellenarlas a partir de los datos
de texto existentes, sustituir las columnas de texto por claves foráneas y
activar la restricción anti-fraude. Implica reescribir el repositorio de
asignaciones y adaptar la pantalla de reportes. **Requiere tocar cómo el
sorteo compone los nombres**, así que debe planificarse aparte.

Recomendación: la Opción A ahora, y la Opción B como trabajo posterior si se
quiere la garantía anti-fraude a nivel de base de datos.
