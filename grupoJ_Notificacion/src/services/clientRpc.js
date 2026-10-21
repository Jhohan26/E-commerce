import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
export class ClientRpc {
  constructor(config, { transport, clock = () => Date.now() } = {}) {
    this.config = config;
    this.settings = config.clientRpc || {};
    this.transport = transport || this.request.bind(this);
    this.clock = clock;
    this.token = null;
    this.tokenExpires = 0;
    this.loginPending = null;
  }
  async request(queueName, payload, token) {
    const url = new URL(this.settings.rabbitUrl || this.config.rabbitUrl);
    url.searchParams.set('heartbeat', String(this.config.heartbeat || 30));
    let connection, timer;
    try {
      connection = await amqp.connect(url.toString(), { timeout: 5000, rejectUnauthorized: true });
      connection.on('error', () => {});
      const channel = await connection.createChannel();
      channel.on('error', () => {});
      const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true });
      const correlationId = randomUUID();
      let resolve, reject;
      const response = new Promise((res, rej) => { resolve = res; reject = rej; });
      response.catch(() => {});
      const closed = () => reject(new Error('CLIENT_RPC_CLOSED'));
      connection.on('close', closed);
      channel.on('close', closed);
      channel.on('return', message => {
        if (message.properties.correlationId === correlationId) reject(new Error('CLIENT_RPC_NO_ROUTE'));
      });
      await channel.consume(queue, message => {
        if (!message || message.properties.correlationId !== correlationId) return;
        if (message.content.length > 65536) return reject(new Error('CLIENT_RESPONSE_TOO_LARGE'));
        try { resolve(JSON.parse(message.content.toString('utf8'))); }
        catch { reject(new Error('CLIENT_RESPONSE_INVALID')); }
      }, { noAck: true });
      const timeout = this.config.email.rpcTimeoutMs;
      timer = setTimeout(() => reject(new Error('CLIENT_RPC_TIMEOUT')), timeout);
      channel.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), {
        correlationId, replyTo: queue, expiration: String(timeout), contentType: 'application/json', mandatory: true,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {})
      });
      return await response;
    } catch (error) {
      if (typeof error.message === 'string' && /^CLIENT_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error('CLIENT_RPC_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      if (connection) await connection.close().catch(() => {});
    }
  }
  async getToken() {
    if (this.token && this.clock() < this.tokenExpires) return this.token;
    if (!this.settings.username || !this.settings.password) throw new Error('CLIENT_AUTH_NOT_CONFIGURED');
    if (!this.loginPending) {
      this.loginPending = (async () => {
        const response = await this.transport(this.settings.loginQueue || 'auth.login', {
          usuario: this.settings.username, password: this.settings.password
        });
        if (response?.status !== 200) throw new Error('CLIENT_AUTH_REJECTED');
        const token = response.data?.token;
        const ttl = response.data?.expira_en_segundos;
        if (typeof token !== 'string' || !token || token.length > 16384 ||
          !Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 604800) throw new Error('CLIENT_RESPONSE_INVALID');
        this.token = token;
        this.tokenExpires = this.clock() + ttl * 1000 - Math.min(5000, ttl * 100);
        return token;
      })().finally(() => { this.loginPending = null; });
    }
    return this.loginPending;
  }
  async getClient(id) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('CLIENT_RECIPIENT_INVALID');
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken();
      result = await this.transport(this.settings.queryQueue || 'cliente.consultar', { id }, token);
      if (result?.status !== 401) break;
      if (this.token === token) { this.token = null; this.tokenExpires = 0; }
      if (attempt === 1) throw new Error('CLIENT_AUTH_REJECTED');
    }
    if (result?.status === 404) throw new Error('CLIENT_NOT_FOUND');
    if (result?.status !== 200 || Number(result.data?.id) !== id) throw new Error('CLIENT_RESPONSE_INVALID');
    if (Number(result.data?.estado) !== 1) throw new Error('CLIENT_INACTIVE');
    if (typeof result.data?.correo !== 'string' || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(result.data.correo)) {
      throw new Error('CLIENT_EMAIL_INVALID');
    }
    return result.data;
  }
}
