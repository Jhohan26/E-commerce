import { InvalidEventError } from '../models/event.js';
export function handleDelivery(message, channel, service, log) {
  if (!message) return;
  let payload;
  try { payload = JSON.parse(message.content.toString('utf8')); }
  catch { log.error('mensaje_invalido', { motivo: 'JSON inválido' }); channel.nack(message, false, false); return; }
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
