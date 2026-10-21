import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

export class NotificacionesRpc {
  constructor({ url, username, password, queue = 'notificaciones.auth.login',
    eventQueue = 'notificaciones.eventos', timeoutMs = 10000, clock = () => Date.now(), transport }) {
    Object.assign(this, { url, username, password, queue, eventQueue, timeoutMs, clock });
    this.transport = transport || this.request.bind(this);
  }
  static fromEnv(env = process.env) {
    return new NotificacionesRpc({ url: env.RABBITMQ_URL,
      username: env.NOTIFICACIONES_RPC_USERNAME, password: env.NOTIFICACIONES_RPC_PASSWORD,
      queue: env.NOTIFICACIONES_RPC_LOGIN_QUEUE || 'notificaciones.auth.login',
      eventQueue: env.NOTIFICACIONES_RPC_QUEUE || 'notificaciones.eventos' });
  }
  async request(queue, payload, token) {
    const url = new URL(this.url);
    if (url.protocol !== 'amqps:') throw new Error('Utiliza la URL AMQPS compartida');
    let connection, timer;
    try {
      connection = await amqp.connect(url.toString(), { timeout: 5000, rejectUnauthorized: true });
      connection.on('error', () => {});
      const channel = await connection.createChannel();
      channel.on('error', () => {});
      const reply = await channel.assertQueue('', { exclusive: true, autoDelete: true });
      const correlationId = randomUUID();
      let resolve, reject;
      const response = new Promise((res, rej) => { resolve = res; reject = rej; });
      response.catch(() => {});
      const fail = () => reject(new Error('Conexión RPC interrumpida'));
      connection.on('close', fail); channel.on('close', fail);
      channel.on('return', msg => {
        if (msg.properties.correlationId === correlationId) reject(new Error('Cola RPC no disponible'));
      });
      await channel.consume(reply.queue, message => {
        if (!message || message.properties.correlationId !== correlationId) return;
        try {
          if (message.content.length > 1048576) throw new Error();
          resolve(JSON.parse(message.content.toString('utf8')));
        } catch { reject(new Error('Respuesta RPC inválida')); }
      }, { noAck: true });
      timer = setTimeout(() => reject(new Error('Notificaciones no respondió')), this.timeoutMs);
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
        replyTo: reply.queue, correlationId, contentType: 'application/json', mandatory: true,
        expiration: String(this.timeoutMs), persistent: false,
        ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {})
      });
      return await response;
    } finally {
      clearTimeout(timer);
      if (connection) await connection.close().catch(() => {});
    }
  }
  async login() {
    if (!this.username || !this.password) throw new Error('Configura las credenciales de Notificaciones en .env');
    const response = await this.transport(this.queue, { usuario: this.username, password: this.password });
    const data = response?.data;
    if (response?.status !== 200 || typeof data?.token !== 'string' ||
        !Number.isSafeInteger(data.expira_en_segundos) || data.expira_en_segundos <= 0) {
      throw new Error('Login rechazado (' + (response?.status || 'inválido') + ')');
    }
    this.session = { token: data.token,
      expires: this.clock() + data.expira_en_segundos * 1000,
      idleMs: (data.inactivitySeconds || data.expira_en_segundos) * 1000, lastUse: this.clock() };
    return this.session.token;
  }
  async token() {
    const now = this.clock();
    if (this.session && now < this.session.expires - 5000 &&
        now < this.session.lastUse + this.session.idleMs - 5000) return this.session.token;
    if (!this.pending) this.pending = this.login().finally(() => { this.pending = null; });
    return this.pending;
  }
  async send(event) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token();
      const response = await this.transport(this.eventQueue, event, token);
      if (response?.status === 401) {
        if (this.session?.token === token) this.session = null;
        if (!attempt) continue;
      }
      if (![200, 201].includes(response?.status)) throw new Error('Evento rechazado (' + response?.status + ')');
      if (this.session?.token === token) this.session.lastUse = this.clock();
      return response.data;
    }
  }
  async publish(channel, exchange, routingKey, event) {
    const token = await this.token();
    await new Promise((resolve, reject) => channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true, contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }
    }, error => error ? reject(error) : resolve()));
    if (this.session?.token === token) this.session.lastUse = this.clock();
  }
}
