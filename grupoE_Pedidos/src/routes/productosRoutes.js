// Rutas REST para productos e inventario
const express = require('express');
const router = express.Router();
const rpcService = require('../services/productosRpcService');
const inventarioRpcService = require('../services/inventarioRpcService');
const { asyncHandler } = require('../middlewares/asyncHandler');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await rpcService.listarProductos();
    res.json(data);
  })
);

router.get(
  '/inventario',
  asyncHandler(async (req, res) => {
    const data = await inventarioRpcService.listarInventario();
    res.json(data);
  })
);

router.get(
  '/inventario/:id',
  asyncHandler(async (req, res) => {
    const data = await inventarioRpcService.consultarProductoInventario(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Producto no encontrado en inventario o servicio no disponible' });
    }
    res.json(data);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = await rpcService.consultarProducto(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Producto no encontrado o servicio no disponible' });
    }
    res.json(data);
  })
);

module.exports = router;
