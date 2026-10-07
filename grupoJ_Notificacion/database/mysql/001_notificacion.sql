-- Esquema de Grupo J para una instancia MySQL compartida.
-- Referencia de despliegue: el repositorio actual ejecuta SQLite.
-- Ejecutar en la base propia de J, con el nombre acordado con el equipo.
CREATE DATABASE IF NOT EXISTS grupo_j_notificaciones
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE grupo_j_notificaciones;

CREATE TABLE IF NOT EXISTS Notificacion (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Cliente_id BIGINT UNSIGNED NOT NULL,
  Pedido_id BIGINT UNSIGNED NOT NULL,
  tipoEvento VARCHAR(64) NOT NULL,
  titulo VARCHAR(150) NOT NULL,
  mensaje TEXT NOT NULL,
  -- Texto ISO UTC que utiliza actualmente la API.
  fecha VARCHAR(40) NOT NULL,
  leida TINYINT NOT NULL DEFAULT 0,
  claveEvento CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fechaEvento VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notificacion_evento (claveEvento),
  KEY idx_notificacion_cliente (Cliente_id, id),
  KEY idx_notificacion_pedido (Pedido_id, id),
  CHECK (Cliente_id > 0),
  CHECK (Pedido_id > 0),
  CHECK (leida IN (0, 1))
) ENGINE=InnoDB;

-- Cliente_id referencia lógicamente Cliente.id del Grupo F.
-- Pedido_id referencia lógicamente Pedido.id del Grupo E.
-- No crear claves foráneas ni copiar tablas de las bases de otros servicios.
