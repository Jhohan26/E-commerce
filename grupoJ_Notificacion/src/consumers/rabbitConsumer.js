import amqp from 'amqplib';
import { assertTopology } from '../config/topology.js';
import { handleDelivery } from './handler.js';
export class RabbitConsumer {
  constructor(config, service, log) { this.config = config; this.service = service; this.log = log; this.connected = false; this.stopped = false; }
  start() { this.stopped = false; void this.connect(); }
  schedule() {
    this.connected = false;
    if (!this.stopped && !this.timer) this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, this.config.reconnectMs);
  }
  async connect() {
    if (this.stopped || this.connecting || this.connection) return;
    this.connecting = true;
    let connection;
    try {
      connection = await amqp.connect(this.config.rabbitUrl, { timeout: 5000 });
      if (this.stopped) { await connection.close(); return; }
      this.connection = connection;
      connection.on('error', () => this.log.error('conexion_rabbitmq_error'));
      connection.on('close', () => { if (this.connection === connection) { this.connection = null; this.schedule(); } });
      const channel = await connection.createChannel();
      channel.on('error', () => this.log.error('canal_rabbitmq_error'));
      channel.on('close', () => { this.connected = false; void connection.close().catch(() => {}); });
      await assertTopology(channel, this.config);
      await channel.prefetch(this.config.prefetch);
      if (this.stopped) { await connection.close(); return; }
      let failed = false;
      await channel.consume(this.config.queue, message => {
        if (failed || this.stopped) return;
        if (!message) { void connection.close().catch(() => {}); return; }
        try { handleDelivery(message, channel, this.service, this.log); }
        catch { failed = true; this.connected = false; void connection.close().catch(() => {}); }
      }, { noAck: false });
      this.connected = true;
      this.log.info('consumidor_conectado', { exchange: this.config.exchange, queue: this.config.queue });
    } catch {
      this.log.error('rabbitmq_no_disponible', { reintentoMs: this.config.reconnectMs });
      if (connection) await connection.close().catch(() => {});
      this.schedule();
    } finally { this.connecting = false; }
  }
  async stop() { this.stopped = true; this.connected = false; clearTimeout(this.timer); this.timer = null; if (this.connection) await this.connection.close().catch(() => {}); }
}
