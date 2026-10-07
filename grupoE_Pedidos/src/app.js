/**
 * Configuración de Express (sin levantar el servidor: eso lo hace server.js).
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

const pedidosRoutes = require('./routes/pedidosRoutes');
const clientesRoutes = require('./routes/clientesRoutes');
const healthRoutes = require('./routes/healthRoutes');
const { notFoundApi, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Desactivar caché para que cualquier cambio en CSS/JS se refleje al instante
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Frontend (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '../public')));

// API
app.use('/api/health', healthRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api', notFoundApi);

app.use(errorHandler);

module.exports = app;
