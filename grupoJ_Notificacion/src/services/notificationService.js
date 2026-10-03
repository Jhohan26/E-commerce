import { createHash } from 'node:crypto';
import { validateEvent } from '../models/event.js';
import { generateMessage } from './messageService.js';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export class NotificationService {
  constructor(repository) { this.repository = repository; }
  process(payload) {
    const event = validateEvent(payload);
    // No se exige un campo nuevo al contrato; deduplicación por contenido JSON canónico.
    const key = createHash('sha256').update(JSON.stringify(canonical(event))).digest('hex');
    return this.repository.save(event, generateMessage(event), key);
  }
}
