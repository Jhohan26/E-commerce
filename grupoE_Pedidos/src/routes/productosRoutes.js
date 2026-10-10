// Rutas REST para productos
const express = require('express');
const router = express.Router();
const rpcService = require('../services/productosRpcService');
const { asyncHandler } = require('../middlewares/asyncHandler');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await rpcService.listarProductos();
    res.json(data);
  })
);

module.exports = router;
