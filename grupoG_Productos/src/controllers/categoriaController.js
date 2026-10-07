const pool = require('../config/database');

// Consultar todas las categorías
const obtenerCategorias = async (req, res) => {
    try {
        const [categorias] = await pool.query(
            'SELECT id, nombre FROM categorias ORDER BY id'
        );

        res.json(categorias);
    } catch (error) {
        console.error('Error al consultar categorías:', error.message);

        res.status(500).json({
            mensaje: 'Error al consultar las categorías'
        });
    }
};

module.exports = {
    obtenerCategorias
};
