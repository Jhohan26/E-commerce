import { AccessError } from '../services/accessService.js';

export async function handleAuthRequest(message, access) {
  try {
    if (message.content.length > 4096) throw new AccessError('Solicitud demasiado grande', 413);
    let body;
    try { body = JSON.parse(message.content.toString('utf8')); }
    catch { throw new AccessError('JSON inválido', 400); }
    if (!body || typeof body.username !== 'string' || !/^[a-z][a-z0-9_-]{2,40}$/.test(body.username) ||
        typeof body.password !== 'string' || !body.password.length || body.password.length > 256) {
      throw new AccessError('Se requieren username y password', 400);
    }
    const result = await access.login(body.username, body.password, 'rabbitmq', { moduleOnly: true });
    return { status: 200, data: { access_token: result.token, token_type: 'Bearer',
      expiresAt: result.expiresAt, inactivitySeconds: result.idleSeconds, role: result.role } };
  } catch (error) {
    return { status: error instanceof AccessError ? error.status : 500,
      error: error instanceof AccessError ? error.message : 'No se pudo procesar el login' };
  }
}

export async function startAuthRpc(connection, config) {
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => {});
  channel.on('close', () => { void connection.close().catch(() => {}); });
  await channel.assertQueue(config.authRpcQueue || 'notificaciones.auth.login', {
    durable: false, arguments: { 'x-message-ttl': 15000, 'x-max-length': 100 }
  });
  await channel.prefetch(1);
  const consumer = await channel.consume(config.authRpcQueue || 'notificaciones.auth.login', message => {
    if (!message) { void connection.close().catch(() => {}); return; }
    const { replyTo, correlationId } = message.properties;
    if (typeof replyTo !== 'string' || !replyTo.startsWith('amq.gen-') || replyTo.length > 255 ||
        typeof correlationId !== 'string' || !correlationId.length || correlationId.length > 128) {
      channel.nack(message, false, false);
      return;
    }
    void (async () => {
      try {
        const response = await handleAuthRequest(message, config.access);
        await new Promise((resolve, reject) => channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(response)), {
          correlationId, contentType: 'application/json', expiration: '15000', persistent: false
        }, error => error ? reject(error) : resolve()));
        channel.ack(message);
      } catch { void connection.close().catch(() => {}); }
    })();
  }, { noAck: false });
  channel.authConsumerTag = consumer.consumerTag;
  return channel;
}
