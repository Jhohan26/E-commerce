CREATE DATABASE IF NOT EXISTS facturacion CHARACTER SET utf8mb4;
USE facturacion;

-- Una factura por pedido. pedido_id es UNIQUE: evita facturar dos veces si
-- RabbitMQ reentrega un PagoAprobado, y permite reenviar el mismo evento.
CREATE TABLE IF NOT EXISTS Factura (
    id             INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    numero         VARCHAR(30)   NULL UNIQUE,      -- FAC-AAAA-00001
    pedido_id      BIGINT        NOT NULL UNIQUE,
    pago_id        BIGINT        NULL,
    cliente_id     BIGINT        NULL,
    cliente_nombre VARCHAR(200)  NULL,             -- viene del servicio de Clientes (puede faltar)
    cliente_correo VARCHAR(150)  NULL,
    fecha          DATETIME      NOT NULL,
    total          DECIMAL(14,2) NOT NULL,
    productos      TEXT          NOT NULL,         -- JSON: [{productoId, cantidad, precio}]
    creada_en      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_factura_total CHECK (total >= 0)
) ENGINE=InnoDB;
