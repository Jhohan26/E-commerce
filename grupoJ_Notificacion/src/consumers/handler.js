import { InvalidEventError } from '../models/event.js';
export function handleDelivery(message, channel, service, log, config = {}) {
  if (!message) return;
  if (message.content.length > (config.maxMessageBytes || 262144)) {
    log.error('mensaje_invalido', { motivo: 'Tamaño máximo excedido' });
    channel.nack(message, false, false); return;
  }
  let payload;
  try { payload = JSON.parse(message.content.toString('utf8')); }
  catch { log.error('mensaje_invalido', { motivo: 'JSON inválido' }); channel.nack(message, false, false); return; }
  const source = config.sources?.find(s => s.exchange === message.fields?.exchange);
  if (config.sources && (!source || (source.type !== 'fanout' &&
      !source.keys.includes(message.fields?.routingKey)))) {
    log.error('mensaje_invalido', { motivo: 'Origen no admitido' });
    channel.nack(message, false, false); return;
  }
  // Fanout también entrega eventos válidos que no requieren notificación.
  if (source?.type === 'fanout' && source.events && payload && typeof payload === 'object' &&
      payload.evento === 'InventarioActualizado' && source.exchange === 'inventario_exchange') {
    log.info('evento_sin_notificacion', { tipoEvento: payload.evento });
    channel.ack(message); return;
  }
  if (source?.events && !source.events.includes(payload?.evento)) {
    log.error('mensaje_invalido', { motivo: 'Evento no permitido para este origen' });
    channel.nack(message, false, false); return;
  }
  try {
    const result = service.process(payload);
    log.info('notificacion_guardada', { id: result.notification.id, tipoEvento: payload.evento, duplicada: result.duplicate });
    channel.ack(message);
  } catch (error) {
    if (error instanceof InvalidEventError) {
      log.error('mensaje_invalido', { motivo: error.message });
      channel.nack(message, false, false);
    } else {
      // El supervisor cierra la conexión y reconecta con pausa: entrega sin ACK se recupera.
      log.error('procesamiento_fallido', { tipoEvento: payload?.evento });
      throw error;
    }
  }
}
