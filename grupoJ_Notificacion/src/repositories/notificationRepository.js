import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export class NotificationRepository {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    // Migrar el modelo anterior sin alterar identificadores ni mensajes guardados.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const legacy = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notificaciones'").get();
      if (legacy) {
        this.db.exec(`ALTER TABLE notificaciones RENAME TO Notificacion;
          ALTER TABLE Notificacion RENAME COLUMN clienteId TO Cliente_id;
          ALTER TABLE Notificacion RENAME COLUMN pedidoId TO Pedido_id;`);
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS Notificacion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        Cliente_id INTEGER NOT NULL CHECK(Cliente_id > 0),
        Pedido_id INTEGER NOT NULL CHECK(Pedido_id > 0),
        tipoEvento TEXT NOT NULL, titulo TEXT NOT NULL, mensaje TEXT NOT NULL,
        fecha TEXT NOT NULL, leida INTEGER NOT NULL DEFAULT 0 CHECK(leida IN (0,1)),
        claveEvento TEXT NOT NULL UNIQUE, fechaEvento TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cliente ON Notificacion(Cliente_id, id);
      CREATE INDEX IF NOT EXISTS idx_notificacion_pedido ON Notificacion(Pedido_id, id);`);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  save(event, content, key) {
    // INSERT atómico: la restricción UNIQUE evita duplicados tras una redelivery.
    const result = this.db.prepare(`INSERT INTO Notificacion
      (Cliente_id,Pedido_id,tipoEvento,titulo,mensaje,fecha,claveEvento,fechaEvento)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(claveEvento) DO NOTHING`).run(
      event.clienteId, event.pedidoId, event.evento, content.titulo, content.mensaje,
      new Date().toISOString(), key, event.fecha);
    return { notification: map(this.db.prepare('SELECT * FROM Notificacion WHERE claveEvento=?').get(key)), duplicate: result.changes === 0 };
  }
  list({ clienteId, limit = 100, offset = 0 } = {}) {
    const sql = clienteId === undefined
      ? this.db.prepare('SELECT * FROM Notificacion ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset)
      : this.db.prepare('SELECT * FROM Notificacion WHERE Cliente_id=? ORDER BY id DESC LIMIT ? OFFSET ?').all(clienteId, limit, offset);
    return sql.map(map);
  }
  get(id) { return map(this.db.prepare('SELECT * FROM Notificacion WHERE id=?').get(id)); }
  markRead(id) { this.db.prepare('UPDATE Notificacion SET leida=1 WHERE id=?').run(id); return this.get(id); }
  close() { this.db.close(); }
}
function map(row) {
  if (!row) return null;
  const { claveEvento, fechaEvento, Cliente_id, Pedido_id, ...publicFields } = row;
  return { ...publicFields, clienteId: Cliente_id, pedidoId: Pedido_id, leida: Boolean(row.leida) };
}
