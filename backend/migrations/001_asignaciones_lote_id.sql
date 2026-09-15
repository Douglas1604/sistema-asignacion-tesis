-- =========================================================================
-- Migración 001 - Identificador real de lote en `asignaciones` (MariaDB)
--
-- Motivo: un lote se identificaba por DATE_FORMAT(fecha_asignacion,
-- '%d/%m/%Y %H:%i'). Con precisión de minuto, dos sorteos guardados en el
-- mismo minuto se listaban y se borraban como si fueran uno solo.
--
-- Qué hace:
--   1. Añade la columna `lote_id` (UUID en CHAR(36) ASCII).
--   2. Rellena las filas históricas con un UUID por cada lote tal y como lo
--      mostraba el módulo de reportes (modalidad + minuto), de modo que las
--      actas ya emitidas conservan exactamente su agrupamiento.
--   3. Hace la columna obligatoria y la indexa para listar/borrar por lote.
--
-- Es idempotente (IF NOT EXISTS / WHERE lote_id IS NULL): puede reejecutarse.
-- Requiere MariaDB 10.3+ (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
--
-- Ejecución:  mariadb -u <usuario> -p tesis_ruleta < migrations/001_asignaciones_lote_id.sql
-- Recomendado: respaldo previo (mariadb-dump tesis_ruleta asignaciones > respaldo.sql)
--              y ventana sin sorteos en curso.
-- =========================================================================

-- 1. Columna nullable para poder rellenar las filas existentes.
ALTER TABLE asignaciones
    ADD COLUMN IF NOT EXISTS lote_id CHAR(36) CHARACTER SET ascii NULL AFTER id;

-- 2. Relleno de históricos.
--    Se usa una tabla temporal en dos pasos (agrupar y luego asignar UUID()
--    con UPDATE) para garantizar que UUID() se evalúa una vez POR LOTE y no
--    una sola vez para toda la consulta ni una vez por fila.
DROP TEMPORARY TABLE IF EXISTS tmp_lotes_heredados;

CREATE TEMPORARY TABLE tmp_lotes_heredados (
    tipo_evento_id INT NOT NULL,
    minuto CHAR(16) CHARACTER SET ascii NOT NULL,
    lote_id CHAR(36) CHARACTER SET ascii NULL,
    PRIMARY KEY (tipo_evento_id, minuto)
);

INSERT INTO tmp_lotes_heredados (tipo_evento_id, minuto)
SELECT tipo_evento_id,
       DATE_FORMAT(fecha_asignacion, '%Y-%m-%d %H:%i') AS minuto
FROM asignaciones
WHERE lote_id IS NULL
GROUP BY tipo_evento_id, DATE_FORMAT(fecha_asignacion, '%Y-%m-%d %H:%i');

UPDATE tmp_lotes_heredados SET lote_id = UUID();

UPDATE asignaciones a
JOIN tmp_lotes_heredados t
  ON t.tipo_evento_id = a.tipo_evento_id
 AND t.minuto = DATE_FORMAT(a.fecha_asignacion, '%Y-%m-%d %H:%i')
SET a.lote_id = t.lote_id
WHERE a.lote_id IS NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_lotes_heredados;

-- 3. A partir de aquí toda fila debe pertenecer a un lote.
ALTER TABLE asignaciones
    MODIFY COLUMN lote_id CHAR(36) CHARACTER SET ascii NOT NULL;

CREATE INDEX IF NOT EXISTS idx_asignaciones_lote ON asignaciones (lote_id);

-- Verificación sugerida (debe devolver 0):
--   SELECT COUNT(*) FROM asignaciones WHERE lote_id IS NULL OR lote_id = '';
