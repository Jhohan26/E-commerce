function positive(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} debe ser un entero positivo`);
  return parsed;
}
export function loadConfig(env = process.env) {
  const exchangeType = env.RABBITMQ_EXCHANGE_TYPE || 'topic';
  if (!['topic', 'direct', 'fanout'].includes(exchangeType)) throw new Error('Tipo de exchange no admitido');
  let sources;
  if (env.RABBITMQ_SOURCES) {
    try { sources = JSON.parse(env.RABBITMQ_SOURCES); }
    catch { throw new Error('RABBITMQ_SOURCES debe ser JSON válido'); }
    if (!Array.isArray(sources) || !sources.length || sources.length > 20 || sources.some(s =>
      !s || typeof s.exchange !== 'string' || !s.exchange.trim() ||
      !['topic', 'direct', 'fanout'].includes(s.type) || !Array.isArray(s.keys) || !s.keys.length ||
      s.keys.some(k => typeof k !== 'string' || /[*#]/.test(k)) || (s.events !== undefined &&
      (!Array.isArray(s.events) || !s.events.length || s.events.some(e => typeof e !== 'string'))))) {
      throw new Error('RABBITMQ_SOURCES contiene fuentes inválidas');
    }
  }
  const rabbitUrl = env.RABBITMQ_URL || 'amqp://notificaciones:local-demo@localhost:5672';
  let url;
  try { url = new URL(rabbitUrl); } catch { throw new Error('RABBITMQ_URL inválida'); }
  if (!['amqp:', 'amqps:'].includes(url.protocol)) throw new Error('Protocolo RabbitMQ inválido');
  if (env.RABBITMQ_REQUIRE_TLS === 'true' && url.protocol !== 'amqps:') throw new Error('Se requiere AMQPS');
  return {
    port: positive(env.PORT, 3000, 'PORT'),
    databasePath: env.DATABASE_PATH || './data/notificaciones.sqlite',
    rabbitUrl, sources,
    heartbeat: positive(env.RABBITMQ_HEARTBEAT, 30, 'RABBITMQ_HEARTBEAT'),
    maxMessageBytes: positive(env.RABBITMQ_MAX_MESSAGE_BYTES, 262144, 'RABBITMQ_MAX_MESSAGE_BYTES'),
    exchange: env.RABBITMQ_EXCHANGE || 'comercio.eventos', exchangeType,
    queue: env.RABBITMQ_QUEUE || 'grupo-j.notificaciones',
    bindings: env.RABBITMQ_BINDINGS?.split(',').map(s => s.trim()).filter(Boolean),
    prefetch: positive(env.RABBITMQ_PREFETCH, 10, 'RABBITMQ_PREFETCH'),
    reconnectMs: positive(env.RABBITMQ_RECONNECT_MS, 5000, 'RABBITMQ_RECONNECT_MS')
  };
}
