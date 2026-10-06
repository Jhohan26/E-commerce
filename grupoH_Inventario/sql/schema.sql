CREATE DATABASE IF NOT EXISTS inventario CHARACTER SET utf8mb4;
USE inventario;

-- Existencias por producto. El producto_id es el mismo que maneja el
-- microservicio de Productos (y el que llega en PedidoCreado).
CREATE TABLE IF NOT EXISTS Inventario (
    producto_id INT          NOT NULL PRIMARY KEY,
    nombre      VARCHAR(150) NULL,
    cantidad    INT          NOT NULL DEFAULT 0,
    actualizado TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_inventario_cantidad CHECK (cantidad >= 0)
) ENGINE=InnoDB;

-- Pedidos ya procesados: evita descontar dos veces si RabbitMQ reentrega
-- un mensaje, y guarda el evento emitido para poder reenviarlo.
CREATE TABLE IF NOT EXISTS PedidoProcesado (
    pedido_id    BIGINT       NOT NULL PRIMARY KEY,
    resultado    VARCHAR(20)  NOT NULL,   -- ACTUALIZADO | INSUFICIENTE
    evento_json  TEXT         NOT NULL,
    procesado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Datos de ejemplo (productoId 15 coincide con el ejemplo del contrato)
INSERT INTO Inventario (producto_id, nombre, cantidad) VALUES
    (15, 'Portátil 14"',          10),
    (16, 'Mouse inalámbrico',     50),
    (17, 'Teclado mecánico',       8),
    (18, 'Monitor 24"',            3),
    (19, 'Audífonos Bluetooth',    0)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);
