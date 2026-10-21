function positive(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} debe ser un entero positivo`);
  return parsed;
}
export function loadConfig(env = process.env) {
  const userAuthMode = env.USER_AUTH_MODE || 'local';
  if (!['local', 'clientes'].includes(userAuthMode)) throw new Error('USER_AUTH_MODE debe ser local o clientes');
  if (userAuthMode === 'clientes' && (!env.CLIENTES_JWT_ISSUER || Buffer.byteLength(env.CLIENTES_JWT_SECRET || '') < 32)) {
    throw new Error('Configura CLIENTES_JWT_ISSUER y CLIENTES_JWT_SECRET para validar tokens de Clientes');
  }
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
  const clientRabbitUrl = env.CLIENTES_RABBITMQ_URL || rabbitUrl;
  let clientUrl;
  try { clientUrl = new URL(clientRabbitUrl); } catch { throw new Error('CLIENTES_RABBITMQ_URL inválida'); }
  if (!['amqp:', 'amqps:'].includes(clientUrl.protocol) ||
    (env.RABBITMQ_REQUIRE_TLS === 'true' && clientUrl.protocol !== 'amqps:')) throw new Error('Protocolo de Clientes no permitido');
  return {
    port: positive(env.PORT, 3000, 'PORT'),
    databasePath: env.DATABASE_PATH || './data/notificaciones.sqlite',
    auth: { secret: env.JWT_SECRET || '', idleSeconds: positive(env.AUTH_IDLE_SECONDS, 1800, 'AUTH_IDLE_SECONDS'),
      lifetimeSeconds: positive(env.AUTH_LIFETIME_SECONDS, 28800, 'AUTH_LIFETIME_SECONDS'),
      moduleLifetimeSeconds: positive(env.AUTH_MODULE_LIFETIME_SECONDS, 1800, 'AUTH_MODULE_LIFETIME_SECONDS'),
      secureCookie: env.AUTH_SECURE_COOKIE === 'true' },
    rabbitUrl, sources,
    authRpcQueue: env.AUTH_RPC_QUEUE || 'notificaciones.auth.login',
    eventRpcQueue: env.EVENT_RPC_QUEUE || 'notificaciones.eventos',
    authRpcEnabled: env.RABBITMQ_AUTH_RPC_ENABLED === 'true',
    requireEventJwt: env.RABBITMQ_REQUIRE_EVENT_JWT === 'true',
    userAuth: { mode: userAuthMode, secret: env.CLIENTES_JWT_SECRET || '', issuer: env.CLIENTES_JWT_ISSUER || '',
      audience: env.CLIENTES_JWT_AUDIENCE || '' },
    clientRpc: {
      rabbitUrl: clientRabbitUrl, username: env.CLIENTES_RPC_USERNAME || '', password: env.CLIENTES_RPC_PASSWORD || '',
      loginQueue: env.CLIENTES_RPC_LOGIN_QUEUE || 'auth.login', queryQueue: env.CLIENTES_RPC_QUEUE || 'cliente.consultar'
    },
    email: {
      enabled: env.EMAIL_ENABLED === 'true',
      host: env.SMTP_HOST || 'smtp.gmail.com', port: positive(env.SMTP_PORT, 587, 'SMTP_PORT'),
      secure: env.SMTP_SECURE === 'true', user: env.SMTP_USER || '',
      password: (env.SMTP_PASSWORD || '').replace(/\s/g, ''), from: env.SMTP_FROM || env.SMTP_USER || '',
      maxAttempts: positive(env.EMAIL_MAX_ATTEMPTS, 5, 'EMAIL_MAX_ATTEMPTS'),
      intervalMs: positive(env.EMAIL_INTERVAL_MS, 5000, 'EMAIL_INTERVAL_MS'),
      rpcTimeoutMs: positive(env.CLIENTES_RPC_TIMEOUT_MS, 10000, 'CLIENTES_RPC_TIMEOUT_MS')
    },
    heartbeat: positive(env.RABBITMQ_HEARTBEAT, 30, 'RABBITMQ_HEARTBEAT'),
    maxMessageBytes: positive(env.RABBITMQ_MAX_MESSAGE_BYTES, 262144, 'RABBITMQ_MAX_MESSAGE_BYTES'),
    exchange: env.RABBITMQ_EXCHANGE || 'comercio.eventos', exchangeType,
    queue: env.RABBITMQ_QUEUE || 'grupo-j.notificaciones',
    bindings: env.RABBITMQ_BINDINGS?.split(',').map(s => s.trim()).filter(Boolean),
    prefetch: positive(env.RABBITMQ_PREFETCH, 10, 'RABBITMQ_PREFETCH'),
    reconnectMs: positive(env.RABBITMQ_RECONNECT_MS, 5000, 'RABBITMQ_RECONNECT_MS')
  };
}
