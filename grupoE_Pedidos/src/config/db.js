const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const PRIMARY_HOST = process.env.DB_HOST || 'localhost';
const FALLBACK_HOST = process.env.DB_FALLBACK_HOST || 'pedidos-mysql';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'pedidos_db';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);

let activeHost = PRIMARY_HOST;
let activePool = createPoolForHost(activeHost);
let schemaInitialized = false;

function createPoolForHost(host) {
  return mysql.createPool({
    host,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    port: DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 4000
  });
}

// Proxy del pool para que todos los repositorios usen siempre el host activo (local o contenedor MySQL)
const pool = {
  query: async (...args) => {
    await ensureDatabaseAndDump();
    return activePool.query(...args);
  },
  execute: async (...args) => {
    await ensureDatabaseAndDump();
    return activePool.execute(...args);
  },
  getConnection: async () => {
    await ensureDatabaseAndDump();
    return activePool.getConnection();
  }
};

async function tryConnectAdmin(host) {
  return mysql.createConnection({
    host,
    user: DB_USER,
    password: DB_PASSWORD,
    port: DB_PORT,
    multipleStatements: true,
    connectTimeout: 3500
  });
}

/**
 * Crea automáticamente la base de datos, las tablas y carga el dump inicial (database/schema.sql)
 * tanto si se usa el MySQL local como si se usa el contenedor MySQL de Docker/Kubernetes.
 */
async function ensureDatabaseAndDump() {
  if (schemaInitialized) return;

  let adminConn = null;
  let chosenHost = activeHost;

  try {
    adminConn = await tryConnectAdmin(PRIMARY_HOST);
    chosenHost = PRIMARY_HOST;
  } catch (primaryErr) {
    if (FALLBACK_HOST && FALLBACK_HOST !== PRIMARY_HOST) {
      adminConn = await tryConnectAdmin(FALLBACK_HOST);
      chosenHost = FALLBACK_HOST;
      console.log(`[MySQL] Usando contenedor MySQL interno "${FALLBACK_HOST}" (el host primario "${PRIMARY_HOST}" no estaba disponible).`);
    } else {
      throw primaryErr;
    }
  }

  if (chosenHost !== activeHost) {
    activeHost = chosenHost;
    activePool = createPoolForHost(activeHost);
  }

  try {
    await adminConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await adminConn.query(`USE \`${DB_NAME}\`;`);

    await adminConn.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        fecha DATETIME NOT NULL,
        total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        estado ENUM('PENDIENTE', 'EN_PROCESO', 'PAGADO', 'ENVIADO', 'CANCELADO', 'COMPLETADO') NOT NULL DEFAULT 'PENDIENTE',
        motivo_cancelacion VARCHAR(255) NULL DEFAULT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cliente (cliente_id),
        INDEX idx_estado (estado),
        INDEX idx_fecha (fecha)
      ) ENGINE=InnoDB;
    `);

    await adminConn.query(`
      CREATE TABLE IF NOT EXISTS pedido_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pedido_id INT NOT NULL,
        producto_id INT NOT NULL,
        cantidad INT NOT NULL,
        precio DECIMAL(12, 2) NOT NULL,
        subtotal DECIMAL(12, 2) NOT NULL,
        CONSTRAINT fk_pedido_items_pedidos
          FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
          ON DELETE CASCADE
          ON UPDATE CASCADE,
        INDEX idx_pedido (pedido_id),
        INDEX idx_producto (producto_id)
      ) ENGINE=InnoDB;
    `);

    try {
      await adminConn.query(
        `ALTER TABLE pedidos ADD COLUMN motivo_cancelacion VARCHAR(255) NULL DEFAULT NULL AFTER estado`
      );
    } catch {
      // La columna ya existe
    }

    // Si la tabla está vacía, cargar automáticamente todos los pedidos e ítems del dump (database/schema.sql)
    const [rows] = await adminConn.query('SELECT COUNT(*) AS total FROM pedidos');
    const totalPedidos = Number(rows[0]?.total || 0);

    if (totalPedidos === 0) {
      const schemaPath = path.join(__dirname, '../../database/schema.sql');
      if (fs.existsSync(schemaPath)) {
        const sqlDump = fs.readFileSync(schemaPath, 'utf8');
        const insertLines = sqlDump
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.startsWith('INSERT INTO '));

        if (insertLines.length > 0) {
          await adminConn.query(insertLines.join('\n'));
          console.log(`[MySQL] Dump inicial cargado automáticamente en "${activeHost}" (${insertLines.length} registros insertados).`);
        }
      }
    }

    schemaInitialized = true;
  } finally {
    await adminConn.end().catch(() => {});
  }
}

/**
 * Función para probar la conexión con la base de datos e inicializar el esquema/dump si hace falta
 */
async function checkDbConnection() {
  try {
    await ensureDatabaseAndDump();
    const connection = await activePool.getConnection();
    await connection.ping();
    connection.release();
    return {
      connected: true,
      host: activeHost,
      message: `Conectado a MySQL (${activeHost}) exitosamente`
    };
  } catch (error) {
    return {
      connected: false,
      message: `Error al conectar a MySQL: ${error.message}. Verifica las credenciales en .env`
    };
  }
}

module.exports = {
  pool,
  checkDbConnection
};
