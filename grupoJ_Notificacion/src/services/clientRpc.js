import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
export class ClientRpc {
  constructor(config) { this.config = config; }
  async getClient(id) {
    const url = new URL(this.config.rabbitUrl);
    url.searchParams.set('heartbeat', '30');
    const connection = await amqp.connect(url.toString(), { timeout: 5000, rejectUnauthorized: true });
    connection.on('error', () => {});
    let timer;
    try {
      const channel = await connection.createChannel();
      channel.on('error', () => {});
      const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true });
      const correlationId = randomUUID();
      let resolve, reject;
      const response = new Promise((res, rej) => { resolve = res; reject = rej; });
      // Gestionar rechazo incluso si consume falla antes de esperar la respuesta.
      response.catch(() => {});
      const closed = () => reject(new Error('CLIENT_RPC_CLOSED'));
      connection.on('close', closed);
      channel.on('close', closed);
      await channel.consume(queue, message => {
        if (!message || message.properties.correlationId !== correlationId) return;
        if (message.content.length > 65536) return reject(new Error('CLIENT_RESPONSE_TOO_LARGE'));
        try { resolve(JSON.parse(message.content.toString('utf8'))); }
        catch { reject(new Error('CLIENT_RESPONSE_INVALID')); }
      }, { noAck: true });
      const timeout = this.config.email.rpcTimeoutMs;
      timer = setTimeout(() => reject(new Error('CLIENT_RPC_TIMEOUT')), timeout);
      channel.sendToQueue('cliente.consultar', Buffer.from(JSON.stringify({ id })),
        { correlationId, replyTo: queue, expiration: String(timeout), contentType: 'application/json' });
      const result = await response;
      if (result?.status !== 200 || Number(result.data?.id) !== id || Number(result.data?.estado) !== 1 ||
          typeof result.data?.correo !== 'string' || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(result.data.correo)) {
        throw new Error('CLIENT_RECIPIENT_INVALID');
      }
      return result.data;
    } finally { clearTimeout(timer); await connection.close().catch(() => {}); }
  }
}
