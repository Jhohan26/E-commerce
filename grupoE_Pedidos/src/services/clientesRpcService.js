// Servicio RPC sobre RabbitMQ para consultar clientes del Grupo F
const amqp = require('amqplib');
const crypto = require('crypto');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_LISTAR = 'clientes.listar';
const QUEUE_CONSULTAR = 'cliente.consultar';
const RPC_TIMEOUT_MS = 4000;



let rpcConnection = null;
let rpcChannel = null;
let replyQueueName = null;
const pendingCalls = new Map();

function formatearCliente(c) {
  const nombres = [c.primer_nombre, c.segundo_nombre].filter(Boolean).join(' ');
  const apellidos = [c.primer_apellido, c.segundo_apellido].filter(Boolean).join(' ');
  const nombreCompleto = `${nombres} ${apellidos}`.trim() || c.nombre || `Cliente #${c.id}`;

  return {
    id: Number(c.id),
    nombre: nombreCompleto,
    correo: c.correo || '',
    estado: c.estado !== undefined ? Number(c.estado) : 1,
    activo: Number(c.estado) === 1,
    ciudad: c.ciudad || 'No especificada',
    origen: c.primer_nombre ? 'grupoF' : 'local'
  };
}

async function getRpcChannel() {
  if (rpcChannel && replyQueueName) return rpcChannel;

  try {
    if (!rpcConnection) {
      rpcConnection = await amqp.connect(RABBITMQ_URL);
      rpcConnection.on('close', () => {
        rpcConnection = null;
        rpcChannel = null;
        replyQueueName = null;
      });
      rpcConnection.on('error', () => {
        rpcConnection = null;
        rpcChannel = null;
        replyQueueName = null;
      });
    }

    rpcChannel = await rpcConnection.createChannel();
    const q = await rpcChannel.assertQueue('', { exclusive: true, autoDelete: true });
    replyQueueName = q.queue;

    rpcChannel.consume(replyQueueName, (msg) => {
      if (!msg) return;
      const cid = msg.properties.correlationId;
      if (pendingCalls.has(cid)) {
        const { resolve } = pendingCalls.get(cid);
        pendingCalls.delete(cid);
        try {
          const body = JSON.parse(msg.content.toString());
          resolve(body);
        } catch (e) {
          resolve({ status: 500, error: 'Respuesta RPC inválida' });
        }
      }
    }, { noAck: true });

    return rpcChannel;
  } catch (err) {
    console.warn('[Clientes RPC] No se pudo inicializar canal RPC:', err.message);
    rpcConnection = null;
    rpcChannel = null;
    replyQueueName = null;
    return null;
  }
}

function callRpc(queue, payload = {}) {
  return new Promise(async (resolve, reject) => {
    const ch = await getRpcChannel();
    if (!ch || !replyQueueName) {
      return reject(new Error('Canal RabbitMQ no disponible para RPC'));
    }

    const cid = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingCalls.delete(cid);
      reject(new Error(`Timeout (${RPC_TIMEOUT_MS}ms) esperando respuesta de ${queue}`));
    }, RPC_TIMEOUT_MS);

    pendingCalls.set(cid, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject
    });

    try {
      ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
        correlationId: cid,
        replyTo: replyQueueName,
        expiration: String(RPC_TIMEOUT_MS)
      });
    } catch (err) {
      clearTimeout(timer);
      pendingCalls.delete(cid);
      reject(err);
    }
  });
}

/**
 * Consulta la lista de clientes vía RabbitMQ RPC (cola clientes.listar).
 * Devuelve ÚNICAMENTE los clientes reales recibidos del Grupo F.
 */
async function listarClientes() {
  let clientesF = [];
  let conectadoF = false;

  try {
    const respuesta = await callRpc(QUEUE_LISTAR, {});
    if (respuesta && respuesta.status === 200 && Array.isArray(respuesta.data)) {
      clientesF = respuesta.data.map(formatearCliente);
      conectadoF = true;
    }
  } catch (err) {
    console.warn(`[Clientes RPC] ${err.message}.`);
  }

  const listadoFinal = clientesF.sort((a, b) => a.id - b.id);

  return {
    total: listadoFinal.length,
    origenGrupoF: conectadoF,
    clientesRemotosGrupoF: listadoFinal.length,
    clientes: listadoFinal
  };
}

/**
 * Consulta un cliente puntual vía RabbitMQ RPC (cola cliente.consultar).
 */
async function consultarCliente(idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  try {
    const respuesta = await callRpc(QUEUE_CONSULTAR, { id });
    if (respuesta && respuesta.status === 200 && respuesta.data) {
      return formatearCliente(respuesta.data);
    }
  } catch (err) {
    console.warn(`[Clientes RPC] Consulta id #${id}: ${err.message}`);
  }

  return null;
}

module.exports = {
  listarClientes,
  consultarCliente
};
