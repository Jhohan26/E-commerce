-- ==========================================================
-- SCRIPT DE BASE DE DATOS: MICROSERVICIO DE PEDIDOS (GRUPO 4 / E)
-- PLATAFORMA DE COMERCIO ELECTRÓNICO DISTRIBUIDA
-- ==========================================================

CREATE DATABASE IF NOT EXISTS pedidos_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pedidos_db;

-- 1. Tabla principal de Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL COMMENT 'ID del cliente registrado en el microservicio de Clientes (Grupo 1)',
  fecha DATETIME NOT NULL COMMENT 'Fecha y hora en que se emite el pedido',
  total DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Monto total del pedido',
  estado ENUM('PENDIENTE', 'EN_PROCESO', 'PAGADO', 'ENVIADO', 'CANCELADO', 'COMPLETADO') 
    NOT NULL DEFAULT 'PENDIENTE' COMMENT 'Estado del ciclo de vida del pedido',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cliente (cliente_id),
  INDEX idx_estado (estado),
  INDEX idx_fecha (fecha)
) ENGINE=InnoDB;

-- 2. Tabla de Detalles / Productos del Pedido
CREATE TABLE IF NOT EXISTS pedido_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL,
  producto_id INT NOT NULL COMMENT 'ID del producto en el catálogo (Grupo 2)',
  cantidad INT NOT NULL COMMENT 'Unidades solicitadas',
  precio DECIMAL(12, 2) NOT NULL COMMENT 'Precio unitario del producto al momento de comprar',
  subtotal DECIMAL(12, 2) NOT NULL COMMENT 'cantidad * precio',
  CONSTRAINT fk_pedido_items_pedidos
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  INDEX idx_pedido (pedido_id),
  INDEX idx_producto (producto_id)
) ENGINE=InnoDB;

-- ==========================================================
-- DATOS DE PRUEBA INICIALES (Conformes al contrato del taller)
-- ==========================================================

-- Los INSERT de ítems usan NOT EXISTS para poder ejecutar este script varias veces
-- sin duplicar productos (pedido_items no tiene clave única, porque un pedido puede
-- repetir un producto en líneas distintas).

-- Pedido de ejemplo #1001 (tomado del contrato oficial del taller)
INSERT INTO pedidos (id, cliente_id, fecha, total, estado)
VALUES (1001, 25, '2026-10-01 10:30:00', 5000000.00, 'PENDIENTE')
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio, subtotal)
SELECT 1001, 15, 2, 2500000.00, 5000000.00 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = 1001);

-- Pedido de ejemplo #1002
INSERT INTO pedidos (id, cliente_id, fecha, total, estado)
VALUES (1002, 30, '2026-10-02 14:15:00', 3600000.00, 'PAGADO')
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio, subtotal)
SELECT 1002, 10, 1, 1200000.00, 1200000.00 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = 1002 AND producto_id = 10);

INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio, subtotal)
SELECT 1002, 12, 2, 1200000.00, 2400000.00 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = 1002 AND producto_id = 12);

SELECT 'Base de datos pedidos_db y tablas creadas exitosamente' AS Resultado;
