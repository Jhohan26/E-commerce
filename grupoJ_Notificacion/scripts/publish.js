import { readFile } from 'node:fs/promises';
import amqp from 'amqplib';
import { loadConfig } from '../src/config/config.js';
import { assertTopology } from '../src/config/topology.js';
const path = process.argv[2];
if (!path) { console.error('Uso: npm run publish -- examples/PedidoCreado.json'); process.exit(1); }
const payload = await readFile(path);
const event = JSON.parse(payload);
const token = process.env.MODULE_TOKEN;
if (!token) throw new Error('Configura MODULE_TOKEN con el JWT del módulo autorizado');
const config = loadConfig();
const connection = await amqp.connect(config.rabbitUrl);
try {
  const channel = await connection.createConfirmChannel();
  await assertTopology(channel, config);
  let returned = false;
  channel.on('return', () => { returned = true; });
  const source = config.sources?.find(source => source.events?.includes(event.evento));
  const exchange = source?.exchange || config.exchange;
  const key = process.argv[3] || (source?.type === 'fanout' ? '' :
    ({ PagoAprobado: 'pago.aprobado', PagoRechazado: 'pago.rechazado' }[event.evento] || event.evento));
  channel.publish(exchange, key, payload, { persistent: true, contentType: 'application/json', mandatory: true,
    headers: { authorization: `Bearer ${token}` } });
  await channel.waitForConfirms();
  if (returned) throw new Error('El mensaje no tuvo una cola de destino');
  console.log(`Publicado y confirmado: ${event.evento}`);
  await channel.close();
} finally { await connection.close(); }
