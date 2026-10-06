// Repositorio de acceso a datos MySQL para pedidos
const { pool } = require('../config/db');

const FECHA_ISO = `DATE_FORMAT(p.fecha, '%Y-%m-%dT%H:%i:%s')`;

// Inserta pedido y sus ítems dentro de una transacción atómica
async function crearConItems({ clienteId, fechaMySQL, total, items }) {
  const connection = await pool.getConnection();
  let enTransaccion = false;
  try {
    await connection.beginTransaction();
    enTransaccion = true;

    const [pedido] = await connection.execute(
      `INSERT INTO pedidos (cliente_id, fecha, total, estado) VALUES (?, ?, ?, 'PENDIENTE')`,
      [clienteId, fechaMySQL, total]
    );

    for (const item of items) {
      await connection.execute(
        `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio, subtotal) VALUES (?, ?, ?, ?, ?)`,
        [pedido.insertId, item.productoId, item.cantidad, item.precio, item.subtotal]
      );
    }

    await connection.commit();
    enTransaccion = false;
    return pedido.insertId;
  } catch (error) {
    if (enTransaccion) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listar() {
  const [rows] = await pool.query(`
    SELECT
      p.id,
      p.cliente_id AS clienteId,
      ${FECHA_ISO} AS fecha,
      p.total,
      p.estado,
      p.creado_en AS creadoEn,
      COUNT(i.id) AS totalItems,
      COALESCE(SUM(i.cantidad), 0) AS totalUnidades
    FROM pedidos p
    LEFT JOIN pedido_items i ON p.id = i.pedido_id
    GROUP BY p.id
    ORDER BY p.id DESC
  `);
  return rows;
}

async function buscarPorId(id) {
  const [rows] = await pool.query(
    `SELECT p.id, p.cliente_id AS clienteId, ${FECHA_ISO} AS fecha, p.total, p.estado, p.creado_en AS creadoEn
     FROM pedidos p WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function itemsDePedido(pedidoId) {
  const [rows] = await pool.query(
    `SELECT producto_id AS productoId, cantidad, precio, subtotal
     FROM pedido_items WHERE pedido_id = ?`,
    [pedidoId]
  );
  return rows;
}

// Actualiza el estado del pedido; devuelve true si existía
async function actualizarEstado(id, estado) {
  const [result] = await pool.execute(`UPDATE pedidos SET estado = ? WHERE id = ?`, [estado, id]);
  return result.affectedRows > 0;
}

module.exports = { crearConItems, listar, buscarPorId, itemsDePedido, actualizarEstado };
