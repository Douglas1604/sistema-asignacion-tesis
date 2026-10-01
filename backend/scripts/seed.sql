-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 01-10-2026 a las 05:59:36
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `tesis_ruleta`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `asignaciones`
--

CREATE TABLE `asignaciones` (
  `id` int(11) NOT NULL,
  `lote_id` char(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `profesor_nombre` varchar(100) NOT NULL,
  `alumno_carnet` varchar(50) NOT NULL,
  `alumno_nombre` varchar(100) NOT NULL,
  `tipo_evento_id` int(11) DEFAULT NULL,
  `fecha_asignacion` timestamp NOT NULL DEFAULT current_timestamp(),
  `active` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `asignaciones`
--

INSERT INTO `asignaciones` (`id`, `lote_id`, `profesor_nombre`, `alumno_carnet`, `alumno_nombre`, `tipo_evento_id`, `fecha_asignacion`, `active`) VALUES
(174, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos Tezo (Presidente)', '4090-20-7451', 'Sheily Anayeli Gonzalez García', 3, '2026-09-23 21:41:09', 1),
(175, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos (Vocal 1)', '4090-20-7451', 'Sheily Anayeli Gonzalez García', 3, '2026-09-23 21:41:09', 1),
(176, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Ludwin (Vocal 2)', '4090-20-7451', 'Sheily Anayeli Gonzalez García', 3, '2026-09-23 21:41:09', 1),
(177, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos Tezo (Presidente)', '1890-20-24866', 'Willian Ronaldo García Pantaleón', 3, '2026-09-23 21:41:09', 1),
(178, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos (Vocal 1)', '1890-20-24866', 'Willian Ronaldo García Pantaleón', 3, '2026-09-23 21:41:09', 1),
(179, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Ludwin (Vocal 2)', '1890-20-24866', 'Willian Ronaldo García Pantaleón', 3, '2026-09-23 21:41:09', 1),
(180, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos Tezo (Presidente)', '0907-21-5788', 'Jesús Fernando Ruiz Castañaza', 3, '2026-09-23 21:41:09', 1),
(181, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos (Vocal 1)', '0907-21-5788', 'Jesús Fernando Ruiz Castañaza', 3, '2026-09-23 21:41:09', 1),
(182, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Ludwin (Vocal 2)', '0907-21-5788', 'Jesús Fernando Ruiz Castañaza', 3, '2026-09-23 21:41:09', 1),
(183, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos Tezo (Presidente)', '2490-21-16431', 'Jonatan Misael Ajanel González', 3, '2026-09-23 21:41:09', 1),
(184, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos (Vocal 1)', '2490-21-16431', 'Jonatan Misael Ajanel González', 3, '2026-09-23 21:41:09', 1),
(185, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Ludwin (Vocal 2)', '2490-21-16431', 'Jonatan Misael Ajanel González', 3, '2026-09-23 21:41:09', 1),
(186, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos Tezo (Presidente)', '0902-17-13424', 'Henry Geovany de Jesús Pacay González', 3, '2026-09-23 21:41:09', 1),
(187, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos (Vocal 1)', '0902-17-13424', 'Henry Geovany de Jesús Pacay González', 3, '2026-09-23 21:41:09', 1),
(188, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Ludwin (Vocal 2)', '0902-17-13424', 'Henry Geovany de Jesús Pacay González', 3, '2026-09-23 21:41:09', 1),
(189, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos Tezo (Presidente)', '1890-18-19895', 'Kevin Saúl Ruiz Castellón', 3, '2026-09-23 21:41:09', 1),
(190, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos (Vocal 1)', '1890-18-19895', 'Kevin Saúl Ruiz Castellón', 3, '2026-09-23 21:41:09', 1),
(191, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Ludwin (Vocal 2)', '1890-18-19895', 'Kevin Saúl Ruiz Castellón', 3, '2026-09-23 21:41:09', 1),
(192, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos Tezo (Presidente)', '0907-21-15261', 'Jhonatan Alexis Lool Alvarado', 3, '2026-09-23 21:41:09', 1),
(193, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Carlos (Vocal 1)', '0907-21-15261', 'Jhonatan Alexis Lool Alvarado', 3, '2026-09-23 21:41:09', 1),
(194, '92b780d1-3f02-43c6-a550-02e14e2c5976', 'Ludwin (Vocal 2)', '0907-21-15261', 'Jhonatan Alexis Lool Alvarado', 3, '2026-09-23 21:41:09', 1);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `roles`
--

CREATE TABLE `roles` (
  `id` int(11) NOT NULL,
  `nombre` varchar(50) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `roles`
--

INSERT INTO `roles` (`id`, `nombre`, `descripcion`) VALUES
(1, 'admin', 'Administrador del sistema'),
(2, 'profesor', 'Docente evaluador'),
(3, 'alumno', 'Estudiante');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `tipos_evento`
--

CREATE TABLE `tipos_evento` (
  `id` int(11) NOT NULL,
  `nombre` varchar(50) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `tipos_evento`
--

INSERT INTO `tipos_evento` (`id`, `nombre`, `descripcion`) VALUES
(1, 'Privado', 'Examen'),
(2, 'Seminario', 'Seminario Privado'),
(3, 'Tesis', 'Trabajo de graduación');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `usuarios`
--

CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `rol_id` int(11) NOT NULL,
  `creado_en` timestamp NOT NULL DEFAULT current_timestamp(),
  `active` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `usuarios`
--

INSERT INTO `usuarios` (`id`, `username`, `password_hash`, `email`, `rol_id`, `creado_en`, `active`) VALUES
(1, 'Admin ', '$2b$12$YR0JUjSVEo2B4dhgSUPSIeQKF1RT2O7fuup.sDjrsXel8jJXqVIna', 'admin@umg.edu.gt', 1, '2026-02-18 05:31:03', 1),
(2, 'Douglas Pineda', '$2b$10$ZJ.EV3v0chs1VMh66Abvfe1/sq6xtCwwtmzI1thnMMl1Glm2m0I5.', 'dpinedah3@miumg.edu.gt', 1, '2026-09-15 04:45:46', 1);

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `asignaciones`
--
ALTER TABLE `asignaciones`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_asignaciones_lote` (`lote_id`),
  ADD KEY `idx_asignaciones_active` (`active`);

--
-- Indices de la tabla `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nombre` (`nombre`);

--
-- Indices de la tabla `tipos_evento`
--
ALTER TABLE `tipos_evento`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `nombre` (`nombre`);

--
-- Indices de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `rol_id` (`rol_id`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `asignaciones`
--
ALTER TABLE `asignaciones`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=195;

--
-- AUTO_INCREMENT de la tabla `roles`
--
ALTER TABLE `roles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT de la tabla `tipos_evento`
--
ALTER TABLE `tipos_evento`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
