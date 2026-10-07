const express = require('express');
const cors = require('cors');
const pool = require('./config/database');
require('dotenv').config();
const productoRoutes = require('./routes/productoRoutes');
const categoriaRoutes = require('./routes/categoriaRoutes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use('/api/productos', productoRoutes);
app.use('/api/categorias', categoriaRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
    res.json({
        mensaje: 'Microservicio de productos funcionando correctamente'
    });
});

app.get('/probar-db', async (req, res) => {
    try {
        const [resultado] = await pool.query('SELECT 1 AS conexion');
        res.json({
            mensaje: 'Conexión con MySQL exitosa',
            resultado: resultado
        });
    } catch (error) {
        console.error('Error al conectar con MySQL:', error.message);
        res.status(500).json({
            mensaje: 'Error al conectar con la base de datos'
        });
    }
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});