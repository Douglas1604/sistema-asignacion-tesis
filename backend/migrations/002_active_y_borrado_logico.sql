-- =========================================================================
-- Migración 002 - Cuentas habilitadas y borrado lógico de actas (MariaDB)
--
-- Motivo:
--   1. `usuarios.active` permite deshabilitar una cuenta sin borrarla, y es la
--      condición que el login exige además de la contraseña correcta.
--   2. `asignaciones.active` convierte el borrado de un lote en un borrado
--      LÓGICO. Un `DELETE` sobre filas referenciadas por tablas de detalle lo
--      rechaza MariaDB por violación de clave foránea; además, un acta oficial
--      ya emitida debe seguir siendo rastreable aunque se retire del listado.
--
-- ESTA MIGRACIÓN NO HACE FALTA EJECUTARLA A MANO: el arranque del servidor la
-- aplica solo (`src/config/bootstrap.js`, variable DB_AUTO_MIGRATE=true), lo
-- que resuelve el caso de un servidor sin acceso a la consola de MariaDB. Se
-- conserva aquí para poder aplicarla de forma explícita y para documentar el
-- cambio de esquema.
--
-- Es idempotente (IF NOT EXISTS): puede reejecutarse sin efectos.
-- Requiere MariaDB 10.3+.
--
-- Ejecución:  mariadb -u <usuario> -p tesis_ruleta < migrations/002_active_y_borrado_logico.sql
-- =========================================================================

-- 1. Cuentas habilitadas. Por defecto todas las existentes quedan activas,
--    de modo que nadie pierde el acceso al aplicar la migración.
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS active TINYINT(1) NOT NULL DEFAULT 1;

-- 2. Borrado lógico de asignaciones. Las filas ya guardadas son vigentes.
ALTER TABLE asignaciones
    ADD COLUMN IF NOT EXISTS active TINYINT(1) NOT NULL DEFAULT 1;

-- El listado de actas filtra por esta columna en cada consulta.
CREATE INDEX IF NOT EXISTS idx_asignaciones_active ON asignaciones (active);

-- Verificación sugerida:
--   SELECT active, COUNT(*) FROM asignaciones GROUP BY active;
--   SELECT id, username, email, active FROM usuarios;
