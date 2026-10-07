function positive(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} debe ser un entero positivo`);
  return parsed;
}
export function loadConfig(env = process.env) {
  const exchangeType = env.RABBITMQ_EXCHANGE_TYPE || 'topic';
  if (!['topic', 'direct', 'fanout'].includes(exchangeType)) throw new Error('Tipo de exchange no admitido');
  return {
    port: positive(env.PORT, 3000, 'PORT'),
    databasePath: env.DATABASE_PATH || './data/notificaciones.sqlite',
    rabbitUrl: env.RABBITMQ_URL || 'amqp://notificaciones:local-demo@localhost:5672',
    exchange: env.RABBITMQ_EXCHANGE || 'comercio.eventos', exchangeType,
    queue: env.RABBITMQ_QUEUE || 'grupo-j.notificaciones',
    bindings: env.RABBITMQ_BINDINGS?.split(',').map(s => s.trim()).filter(Boolean),
    prefetch: positive(env.RABBITMQ_PREFETCH, 10, 'RABBITMQ_PREFETCH'),
    reconnectMs: positive(env.RABBITMQ_RECONNECT_MS, 5000, 'RABBITMQ_RECONNECT_MS')
  };
}
