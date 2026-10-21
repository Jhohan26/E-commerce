import { readFile } from 'node:fs/promises';
import { NotificacionesRpc } from '../examples/notificaciones-rpc.js';
const path = process.argv[2];
if (!path) { console.error('Uso: npm run publish -- examples/PedidoCreado.json'); process.exit(1); }
const payload = await readFile(path);
const event = JSON.parse(payload);
const result = await NotificacionesRpc.fromEnv().send(event);
console.log(JSON.stringify({ evento: event.evento, id: result.notification.id, duplicado: result.duplicate }));
