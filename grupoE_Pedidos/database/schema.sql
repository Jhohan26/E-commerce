-- ==========================================================
-- DUMP E INICIALIZACIÓN AUTOMÁTICA: MICROSERVICIO DE PEDIDOS (GRUPO E)
-- PLATAFORMA DE COMERCIO ELECTRÓNICO DISTRIBUIDA
-- ==========================================================

CREATE DATABASE IF NOT EXISTS pedidos_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pedidos_db;

-- 1. Tabla principal de Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL COMMENT 'ID del cliente registrado en el microservicio de Clientes (Grupo F)',
  fecha DATETIME NOT NULL COMMENT 'Fecha y hora en que se emite el pedido',
  total DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Monto total del pedido',
  estado ENUM('PENDIENTE', 'EN_PROCESO', 'PAGADO', 'ENVIADO', 'CANCELADO', 'COMPLETADO')
    NOT NULL DEFAULT 'PENDIENTE' COMMENT 'Estado del ciclo de vida del pedido',
  motivo_cancelacion VARCHAR(255) NULL DEFAULT NULL COMMENT 'Motivo si el pedido fue cancelado (ej. inventario insuficiente, pago rechazado)',
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
  producto_id INT NOT NULL COMMENT 'ID del producto en el catálogo (Grupo G)',
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
-- DATOS DEL DUMP INICIAL (Pedidos reales e ítems)
-- ==========================================================
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1001, 25, '2026-10-01 10:30:00', 5000000.00, 'PENDIENTE', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1002, 30, '2026-10-02 14:15:00', 3600000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1003, 1, '2026-10-06 03:35:50', 300.00, 'PENDIENTE', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1004, 10, '2026-10-06 00:08:05', 2500000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1005, 1, '2026-10-06 01:40:23', 4250000.00, 'COMPLETADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1006, 1, '2026-10-06 21:16:00', 350000.00, 'PENDIENTE', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1007, 10, '2026-10-06 21:21:34', 2850000.00, 'PENDIENTE', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1008, 25, '2026-10-07 09:47:14', 850000.00, 'PENDIENTE', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1009, 1, '2026-10-07 10:07:47', 3350000.00, 'PENDIENTE', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1010, 1, '2026-10-07 20:09:56', 3350000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1011, 1, '2026-10-07 20:20:31', 2500000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1012, 25, '2026-10-09 19:58:08', 100000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1013, 25, '2026-10-09 20:31:07', 65000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1014, 25, '2026-10-09 20:35:41', 80000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1015, 25, '2026-10-09 20:42:21', 35000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1016, 25, '2026-10-09 20:57:37', 300000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1017, 25, '2026-10-09 20:59:01', 2650000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1018, 1, '2026-10-13 19:14:01', 150000.00, 'CANCELADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1019, 5, '2026-10-13 19:16:47', 195000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1020, 2, '2026-10-13 20:27:24', 130000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1021, 6, '2026-10-13 20:42:06', 80000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1022, 6, '2026-10-13 20:46:48', 2715000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1023, 1, '2026-10-19 22:40:06', 3500000.00, 'CANCELADO', 'Pago rechazado: Rechazado manualmente por el operador') ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1024, 2, '2026-10-20 20:09:24', 150000.00, 'PAGADO', NULL) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedidos (id, cliente_id, fecha, total, estado, motivo_cancelacion) VALUES (1025, 1, '2026-10-20 20:32:24', 2500000.00, 'CANCELADO', 'Pago rechazado: Rechazado manualmente por el operador') ON DUPLICATE KEY UPDATE id = id;

INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (1, 1001, 15, 2, 2500000.00, 5000000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (2, 1002, 10, 1, 1200000.00, 1200000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (3, 1002, 12, 2, 1200000.00, 2400000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (4, 1003, 2, 1, 300.00, 300.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (5, 1004, 15, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (6, 1005, 5, 5, 850000.00, 4250000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (7, 1006, 8, 1, 350000.00, 350000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (8, 1007, 8, 1, 350000.00, 350000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (9, 1007, 15, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (10, 1008, 5, 1, 850000.00, 850000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (11, 1009, 5, 1, 850000.00, 850000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (12, 1009, 15, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (13, 1010, 5, 1, 850000.00, 850000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (14, 1010, 15, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (15, 1011, 1, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (16, 1012, 7, 1, 100000.00, 100000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (17, 1013, 8, 1, 65000.00, 65000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (18, 1014, 5, 1, 80000.00, 80000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (19, 1015, 3, 1, 35000.00, 35000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (20, 1016, 2, 2, 150000.00, 300000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (21, 1017, 1, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (22, 1017, 2, 1, 150000.00, 150000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (23, 1018, 2, 1, 150000.00, 150000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (24, 1019, 8, 3, 65000.00, 195000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (25, 1020, 8, 2, 65000.00, 130000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (26, 1021, 5, 1, 80000.00, 80000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (27, 1022, 1, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (28, 1022, 2, 1, 150000.00, 150000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (29, 1022, 8, 1, 65000.00, 65000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (30, 1023, 1, 1, 3500000.00, 3500000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (31, 1024, 2, 1, 150000.00, 150000.00) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio, subtotal) VALUES (32, 1025, 1, 1, 2500000.00, 2500000.00) ON DUPLICATE KEY UPDATE id = id;
