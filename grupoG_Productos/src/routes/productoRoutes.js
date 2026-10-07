const express = require('express');
const router = express.Router();

const {
    obtenerProductos,
    crearProducto,
    actualizarProducto,
    eliminarProducto
} = require('../controllers/productoController');

// GET: consultar todos los productos
router.get('/', obtenerProductos);
// POST: registrar un nuevo producto
router.post('/', crearProducto);
// PUT: actualizar un producto
router.put('/:id', actualizarProducto);
// DELETE: eliminar un producto
router.delete('/:id', eliminarProducto);

module.exports = router;
