const express = require('express');
const router = express.Router();

const {
    obtenerCategorias
} = require('../controllers/categoriaController');

// GET: consultar todas las categorías
router.get('/', obtenerCategorias);

module.exports = router;
