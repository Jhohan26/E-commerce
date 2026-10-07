// Rutas REST para consultar clientes consumidos vía RabbitMQ RPC desde Grupo F
const express = require('express');
const router = express.Router();
const rpcService = require('../services/clientesRpcService');
const { asyncHandler } = require('../middlewares/asyncHandler');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await rpcService.listarClientes();
    res.json(data);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const cliente = await rpcService.consultarCliente(req.params.id);
    if (!cliente) {
      return res.status(404).json({ error: `Cliente #${req.params.id} no encontrado.` });
    }
    res.json({ cliente });
  })
);

module.exports = router;
