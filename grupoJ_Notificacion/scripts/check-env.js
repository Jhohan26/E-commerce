import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { loadConfig } from '../src/config/config.js';

try {
  const file = process.argv[2] || '.env';
  const env = parseEnv(readFileSync(file, 'utf8'));
  const config = loadConfig(env);
  const errors = [];
  if (Buffer.byteLength(config.auth.secret) < 32) errors.push('JWT_SECRET requiere al menos 32 bytes');
  if (config.port > 65535) errors.push('PORT debe ser menor o igual a 65535');
  if (config.email.enabled) {
    for (const key of ['SMTP_USER', 'SMTP_PASSWORD', 'CLIENTES_RPC_USERNAME', 'CLIENTES_RPC_PASSWORD']) {
      if (!env[key]?.trim()) errors.push(`${key} es obligatorio para el flujo de correo`);
    }
    if (config.email.secure && config.email.port === 587) errors.push('SMTP_SECURE debe ser false para STARTTLS en 587');
  }
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`Configuracion valida: puerto ${config.port}; correo ${config.email.enabled ? 'activo' : 'desactivado'}; identidad ${config.userAuth.mode}.`);
    console.log('Validacion local sin conexiones externas ni envio de correos.');
  }
} catch {
  console.error('No se pudo validar el entorno: revisa el archivo y los formatos de sus variables.');
  process.exitCode = 1;
}
