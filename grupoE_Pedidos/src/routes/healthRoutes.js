const express = require('express');
const { checkDbConnection } = require('../config/db');
const { getRabbitStatus } = require('../config/rabbitmq');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = express.Router();

// Diagnóstico del sistema: 200 si MySQL y RabbitMQ responden, 207 si alguno falla.
router.get('/', asyncHandler(async (req, res) => {
  const mysql = await checkDbConnection();
  const rabbitmq = getRabbitStatus();
  const healthy = mysql.connected && rabbitmq.connected;

  res.status(healthy ? 200 : 207).json({
    status: healthy ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    modulo: 'Microservicio de Pedidos',
    mysql,
    rabbitmq
  });
}));

module.exports = router;
