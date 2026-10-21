import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { loadConfig } from '../src/config/config.js';

mkdirSync('.artifacts/k8s', { recursive: true });
const repo = new NotificationRepository(loadConfig().databasePath);
try {
  await backup(repo.db, '.artifacts/k8s/notificaciones.sqlite');
  console.log('Copia consistente de SQLite preparada en .artifacts/k8s/notificaciones.sqlite.');
} finally { repo.close(); }
