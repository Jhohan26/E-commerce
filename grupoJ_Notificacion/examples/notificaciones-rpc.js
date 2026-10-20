import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

export class NotificacionesRpc {
  constructor({ url, username, password, queue = 'notificaciones.auth.login' }) {
    Object.assign(this, { url, username, password, queue });
  }
  async login() {
    const url = new URL(this.url);
    if (url.protocol !== 'amqps:') throw new Error('Utiliza la URL AMQPS compartida');
    const connection = await amqp.connect(url.toString(), { timeout: 5000, rejectUnauthorized: true });
    connection.on('error', () => {});
    try {
      const channel = await connection.createChannel();
      channel.on('error', () => {});
      const reply = await channel.assertQueue('', { exclusive: true, autoDelete: true });
      const correlationId = randomUUID();
      const response = await new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Notificaciones no respondió al login')), 10000);
        const fail = error => { clearTimeout(timer); reject(error); };
        connection.once('close', () => fail(new Error('Conexión cerrada durante el login')));
        channel.on('return', () => fail(new Error('No existe la cola de login de Notificaciones')));
        try {
          await channel.consume(reply.queue, message => {
            if (!message || message.properties.correlationId !== correlationId) return;
            clearTimeout(timer);
            try {
              if (message.content.length > 65536) throw new Error('Respuesta demasiado grande');
              resolve(JSON.parse(message.content.toString()));
            } catch { reject(new Error('Respuesta de login inválida')); }
          }, { noAck: true });
          channel.sendToQueue(this.queue, Buffer.from(JSON.stringify({ username: this.username, password: this.password })), {
            replyTo: reply.queue, correlationId, contentType: 'application/json',
            expiration: '15000', persistent: false, mandatory: true
          });
        } catch (error) { fail(error); }
      });
      if (response.status !== 200 || typeof response.data?.access_token !== 'string') {
        throw new Error(`Login rechazado (${response.status || 'inválido'})`);
      }
      this.session = { ...response.data, lastUse: Date.now() };
      return this.session.access_token;
    } finally { await connection.close().catch(() => {}); }
  }
  async token() {
    const now = Date.now();
    if (this.session && Date.parse(this.session.expiresAt) > now + 60000 &&
        this.session.lastUse + this.session.inactivitySeconds * 1000 > now + 60000) return this.session.access_token;
    if (!this.pending) this.pending = this.login().finally(() => { this.pending = null; });
    return this.pending;
  }
  async publish(channel, exchange, routingKey, event) {
    const token = await this.token();
    await new Promise((resolve, reject) => channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true, contentType: 'application/json', headers: { Authorization: `Bearer ${token}` }
    }, error => error ? reject(error) : resolve()));
    this.session.lastUse = Date.now();
  }
}
