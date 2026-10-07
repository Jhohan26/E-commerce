const pool = require('../config/database');

// Consultar todos los productos
const obtenerProductos = async (req, res) => {
    try {
        const [productos] = await pool.query(`
            SELECT
                p.id,
                p.nombre,
                p.precio,
                p.imagen_url,
                p.descripcion,
                p.categoria_id,
                c.nombre AS categoria
            FROM productos p
            INNER JOIN categorias c ON p.categoria_id = c.id
            ORDER BY p.id
        `);

        res.json(productos);
    } catch (error) {
        console.error('Error al consultar productos:', error.message);

        res.status(500).json({
            mensaje: 'Error al consultar los productos'
        });
    }
};

// Registrar un nuevo producto
const crearProducto = async (req, res) => {

    try {
        const {
            nombre,
            precio,
            imagen_url,
            descripcion,
            categoria_id
        } = req.body;

        if (
            !nombre ||
            precio === undefined ||
            precio === null ||
            precio === '' ||
            !categoria_id
        ) {
            return res.status(400).json({
                mensaje: 'Nombre, precio y categoría son obligatorios'
            });
        }

        const precioNumerico = Number(precio);
        const categoriaIdNumerica = Number(categoria_id);

        if (
            !Number.isFinite(precioNumerico) ||
            precioNumerico < 0 ||
            !Number.isInteger(categoriaIdNumerica) ||
            categoriaIdNumerica <= 0
        ) {
            return res.status(400).json({
                mensaje: 'El precio o la categoría no son válidos'
            });
        }

        const [resultado] = await pool.query(
            `INSERT INTO productos
            (nombre, precio, imagen_url, descripcion, categoria_id)
            VALUES (?, ?, ?, ?, ?)`,
            [
                nombre,
                precioNumerico,
                imagen_url || null,
                descripcion || null,
                categoriaIdNumerica
            ]
        );

        res.status(201).json({
            mensaje: 'Producto creado correctamente',
            id: resultado.insertId
        });

    } catch (error) {
        console.error('Error al crear producto:', error.message);

        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({
                mensaje: 'La categoría seleccionada no existe'
            });
        }

        res.status(500).json({
            mensaje: 'Error al registrar el producto'
        });
    }
};
// Actualizar un producto existente
const actualizarProducto = async (req, res) => {
    try {
        const { id } = req.params;

        const {
            nombre,
            precio,
            imagen_url,
            descripcion,
            categoria_id
        } = req.body;

        if (
            !nombre ||
            precio === undefined ||
            precio === null ||
            precio === '' ||
            !categoria_id
        ) {
            return res.status(400).json({
                mensaje: 'Nombre, precio y categoría son obligatorios'
            });
        }

        const precioNumerico = Number(precio);
        const categoriaIdNumerica = Number(categoria_id);

        if (
            !Number.isFinite(precioNumerico) ||
            precioNumerico < 0 ||
            !Number.isInteger(categoriaIdNumerica) ||
            categoriaIdNumerica <= 0
        ) {
            return res.status(400).json({
                mensaje: 'El precio o la categoría no son válidos'
            });
        }

        const [resultado] = await pool.query(
            `UPDATE productos
             SET nombre = ?,
                 precio = ?,
                 imagen_url = ?,
                 descripcion = ?,
                 categoria_id = ?
             WHERE id = ?`,
            [
                nombre,
                precioNumerico,
                imagen_url || null,
                descripcion || null,
                categoriaIdNumerica,
                id
            ]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                mensaje: 'Producto no encontrado'
            });
        }

        res.json({
            mensaje: 'Producto actualizado correctamente'
        });

    } catch (error) {
        console.error('Error al actualizar producto:', error.message);

        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({
                mensaje: 'La categoría seleccionada no existe'
            });
        }

        res.status(500).json({
            mensaje: 'Error al actualizar el producto'
        });
    }
};
// Eliminar un producto
const eliminarProducto = async (req, res) => {
    try {
        const { id } = req.params;

        const [resultado] = await pool.query(
            'DELETE FROM productos WHERE id = ?',
            [id]
        );

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                mensaje: 'Producto no encontrado'
            });
        }

        res.json({
            mensaje: 'Producto eliminado correctamente'
        });

    } catch (error) {
        console.error('Error al eliminar producto:', error.message);

        res.status(500).json({
            mensaje: 'Error al eliminar el producto'
        });
    }
};

module.exports = {
    obtenerProductos,
    crearProducto,
    actualizarProducto,
    eliminarProducto
};