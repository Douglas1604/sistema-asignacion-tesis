-- =========================================================================
-- Esquema de la base de datos - Ruleta de Asignaciones Académicas (MariaDB)
--
-- Este archivo refleja la base de datos REAL que usa la aplicación.
-- Ver docs/ESQUEMA-BD.md para el historial del desajuste que tenía la versión
-- anterior de este archivo y para la propuesta de modelo normalizado.
-- =========================================================================

CREATE DATABASE IF NOT EXISTS tesis_ruleta;
USE tesis_ruleta;

-- -------------------------------------------------------------------------
-- 1. Roles y usuarios
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    -- 'admin', 'profesor', 'alumno'
    descripcion VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    -- IMPORTANTE: debe contener un hash bcrypt de 60 caracteres.
    -- La API rechaza cualquier valor que no tenga ese formato: nunca se
    -- compara la contraseña en texto plano contra esta columna.
    -- Para convertir contraseñas heredadas: npm run migrate:passwords
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100) UNIQUE,
    rol_id INT NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------------------------
-- 2. Catálogo de modalidades
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tipos_evento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    -- 'Privado', 'Seminario', 'Tesis'
    descripcion VARCHAR(255)
);

-- -------------------------------------------------------------------------
-- 3. Asignaciones (tabla principal)
--
-- Modelo desnormalizado: el nombre del catedrático y los datos del alumno se
-- guardan como texto, tal y como los compone la pantalla de sorteo. Por
-- ejemplo: 'Grupo 1 de Administración de Sistemas - Ing. Pérez' para privado,
-- o 'Ing. Pérez (Presidente)' para un miembro del jurado de tesis.
--
-- El módulo de reportes agrupa los registros por esas cadenas y por la fecha,
-- así que el formato del texto forma parte del contrato: no cambiarlo sin
-- adaptar también la generación de actas.
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asignaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    profesor_nombre VARCHAR(100) NOT NULL,
    alumno_carnet VARCHAR(50) NOT NULL,
    alumno_nombre VARCHAR(100) NOT NULL,
    tipo_evento_id INT NOT NULL,
    fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tipo_evento_id) REFERENCES tipos_evento(id) ON DELETE RESTRICT
);

-- Índices recomendados. Sin ellos, el borrado de un lote y el borrado por
-- alumno recorren la tabla completa en cada llamada.
CREATE INDEX idx_asignaciones_fecha ON asignaciones (fecha_asignacion);
CREATE INDEX idx_asignaciones_carnet ON asignaciones (alumno_carnet);
CREATE INDEX idx_asignaciones_tipo_evento ON asignaciones (tipo_evento_id);

-- -------------------------------------------------------------------------
-- 4. Datos iniciales
-- -------------------------------------------------------------------------

INSERT IGNORE INTO roles (nombre, descripcion)
VALUES ('admin', 'Administrador del sistema'),
    ('profesor', 'Docente evaluador'),
    ('alumno', 'Estudiante');

INSERT IGNORE INTO tipos_evento (nombre, descripcion)
VALUES ('Privado', 'Examen privado'),
    ('Seminario', 'Asignación general'),
    ('Tesis', 'Trabajo de graduación');

-- =========================================================================
-- PROPUESTA FUTURA (no creada: la aplicación todavía no usa estas tablas)
--
-- El modelo normalizado permitiría activar la restricción anti-fraude
-- "un alumno no puede estar asignado a dos eventos en el mismo periodo",
-- que hoy NO está garantizada por la base de datos.
--
-- Requiere reescribir el repositorio de asignaciones y la pantalla de
-- reportes. Ver docs/ESQUEMA-BD.md, Opción B.
--
-- CREATE TABLE profesores (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     usuario_id INT NOT NULL UNIQUE,
--     nombre_completo VARCHAR(100) NOT NULL,
--     especialidad VARCHAR(100),
--     max_carga INT DEFAULT 10,
--     activo BOOLEAN DEFAULT TRUE,
--     FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
-- );
--
-- CREATE TABLE alumnos (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     usuario_id INT NOT NULL UNIQUE,
--     nombre_completo VARCHAR(100) NOT NULL,
--     carnet VARCHAR(20) NOT NULL UNIQUE,
--     carrera VARCHAR(100),
--     activo BOOLEAN DEFAULT TRUE,
--     FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
-- );
--
-- CREATE TABLE periodos (
--     id INT AUTO_INCREMENT PRIMARY KEY,
--     nombre VARCHAR(50) NOT NULL,
--     fecha_inicio DATE NOT NULL,
--     fecha_fin DATE NOT NULL,
--     activo BOOLEAN DEFAULT TRUE
-- );
--
-- Y sobre asignaciones, sustituyendo las columnas de texto:
--     alumno_id INT NOT NULL  -> FK alumnos(id)
--     profesor_id INT NOT NULL -> FK profesores(id)
--     periodo_id INT NOT NULL  -> FK periodos(id)
--     asignado_por_usuario_id INT -> FK usuarios(id)
--     UNIQUE KEY uk_alumno_periodo_global (alumno_id, periodo_id)
-- =========================================================================
