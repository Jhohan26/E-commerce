import { AccessError } from '../services/accessService.js';
import { InvalidEventError } from '../models/event.js';

export async function handleAuthRequest(message, access) {
  try {
    if (message.content.length > 4096) throw new AccessError('Solicitud demasiado grande', 413);
    let body;
    try { body = JSON.parse(message.content.toString('utf8')); }
    catch { throw new AccessError('JSON inválido', 400); }
    const username = body?.usuario ?? body?.username;
    if (body?.usuario && body?.username && body.usuario !== body.username) throw new AccessError('Usuario ambiguo', 400);
    if (!body || typeof username !== 'string' || !/^[a-z][a-z0-9_-]{2,40}$/.test(username) ||
        typeof body.password !== 'string' || !body.password.length || body.password.length > 256) {
      throw new AccessError('Se requieren username y password', 400);
    }
    const result = await access.login(username, body.password, 'rabbitmq', { moduleOnly: true });
    return { status: 200, data: { token: result.token, tipo: 'Bearer', expira_en_segundos: result.expiresIn,
      access_token: result.token, token_type: 'Bearer',
      expiresAt: result.expiresAt, inactivitySeconds: result.idleSeconds, role: result.role } };
  } catch (error) {
    return { status: error instanceof AccessError ? error.status : 500,
      error: error instanceof AccessError ? error.message : 'No se pudo procesar el login' };
  }
}

export function handleEventRequest(message, access, service, maxBytes = 262144) {
  try {
    if (message.content.length > maxBytes) throw new AccessError('Solicitud demasiado grande', 413);
    let body;
    try { body = JSON.parse(message.content.toString('utf8')); }
    catch { throw new AccessError('JSON inválido', 400); }
    const header = message.properties?.headers?.Authorization ?? message.properties?.headers?.authorization;
    const token = typeof header === 'string' ? /^Bearer ([^\s]+)$/i.exec(header)?.[1] : '';
    access.authenticate(token || '', { event: body?.evento || '__invalid__' });
    const result = service.process(body);
    return { status: result.duplicate ? 200 : 201, data: result };
  } catch (error) {
    return { status: error instanceof AccessError ? error.status : error instanceof InvalidEventError ? 400 : 500,
      error: error instanceof AccessError || error instanceof InvalidEventError ? error.message : 'No se pudo guardar el evento' };
  }
}

export async function startAuthRpc(connection, config, service) {
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => {});
  channel.on('close', () => { void connection.close().catch(() => {}); });
  const loginQueue = config.authRpcQueue || 'notificaciones.auth.login';
  await channel.assertQueue(loginQueue, {
    durable: false, arguments: { 'x-message-ttl': 15000, 'x-max-length': 100 }
  });
  await channel.prefetch(1);
  const consume = (queue, handler) => channel.consume(queue, message => {
    if (!message) { void connection.close().catch(() => {}); return; }
    const { replyTo, correlationId } = message.properties;
    if (typeof replyTo !== 'string' || !replyTo.startsWith('amq.gen-') || replyTo.length > 255 ||
        typeof correlationId !== 'string' || !correlationId.length || correlationId.length > 128) {
      channel.nack(message, false, false);
      return;
    }
    void (async () => {
      try {
        const response = await handler(message);
        await new Promise((resolve, reject) => channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(response)), {
          correlationId, contentType: 'application/json', expiration: '15000', persistent: false
        }, error => error ? reject(error) : resolve()));
        channel.ack(message);
      } catch { void connection.close().catch(() => {}); }
    })();
  }, { noAck: false });
  const consumer = await consume(loginQueue, message => handleAuthRequest(message, config.access));
  channel.authConsumerTag = consumer.consumerTag;
  if (service) {
    const queue = config.eventRpcQueue || 'notificaciones.eventos';
    if (queue === loginQueue) throw new Error('Las colas de login y eventos deben ser distintas');
    await channel.assertQueue(queue, { durable: false, arguments: { 'x-message-ttl': 15000, 'x-max-length': 100 } });
    const eventConsumer = await consume(queue, message => handleEventRequest(message, config.access, service, config.maxMessageBytes));
    channel.eventConsumerTag = eventConsumer.consumerTag;
  }
  return channel;
}
