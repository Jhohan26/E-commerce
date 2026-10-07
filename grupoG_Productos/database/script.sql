CREATE DATABASE IF NOT EXISTS ecommerce_productos
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE ecommerce_productos;

CREATE TABLE IF NOT EXISTS categorias (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS productos (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    precio DECIMAL(12,2) NOT NULL,
    imagen_url VARCHAR(500),
    descripcion TEXT,
    categoria_id BIGINT NOT NULL,

    CONSTRAINT fk_producto_categoria
        FOREIGN KEY (categoria_id)
        REFERENCES categorias(id)
);

INSERT INTO categorias (nombre)
SELECT 'Electrónica'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias WHERE nombre = 'Electrónica'
);

INSERT INTO categorias (nombre)
SELECT 'Ropa'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias WHERE nombre = 'Ropa'
);

INSERT INTO categorias (nombre)
SELECT 'Hogar'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias WHERE nombre = 'Hogar'
);

INSERT INTO categorias (nombre)
SELECT 'Accesorios'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias WHERE nombre = 'Accesorios'
);