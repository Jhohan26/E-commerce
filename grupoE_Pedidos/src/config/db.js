const mysql = require('mysql2/promise');
require('dotenv').config();

// Pool de conexiones a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pedidos_db',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/**
 * Función para probar la conexión con la base de datos
 */
async function checkDbConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return { connected: true, message: 'Conectado a MySQL Workbench exitosamente' };
  } catch (error) {
    return { 
      connected: false, 
      message: `Error al conectar a MySQL: ${error.message}. Verifica las credenciales en .env y ejecuta database/schema.sql` 
    };
  }
}

module.exports = {
  pool,
  checkDbConnection
};
