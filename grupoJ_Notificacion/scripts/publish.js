import { readFile } from 'node:fs/promises';
import amqp from 'amqplib';
import { loadConfig } from '../src/config/config.js';
import { assertTopology } from '../src/config/topology.js';
const path = process.argv[2];
if (!path) { console.error('Uso: npm run publish -- examples/PedidoCreado.json'); process.exit(1); }
const payload = await readFile(path);
const event = JSON.parse(payload);
const config = loadConfig();
const connection = await amqp.connect(config.rabbitUrl);
try {
  const channel = await connection.createConfirmChannel();
  await assertTopology(channel, config);
  let returned = false;
  channel.on('return', () => { returned = true; });
  channel.publish(config.exchange, process.argv[3] || event.evento, payload, { persistent: true, contentType: 'application/json', mandatory: true });
  await channel.waitForConfirms();
  if (returned) throw new Error('El mensaje no tuvo una cola de destino');
  console.log(`Publicado y confirmado: ${event.evento}`);
  await channel.close();
} finally { await connection.close(); }
