import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../src/config/config.js';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { AccessService, moduleEvents } from '../src/services/accessService.js';
const config = loadConfig();
const repo = new NotificationRepository(config.databasePath);
try {
  const access = new AccessService(repo.db, config.auth);
  const command = process.argv[2];
  const username = process.argv[3];
  if (command === 'disable' && username) {
    repo.db.prepare('UPDATE ModuleAccount SET enabled=0 WHERE username=?').run(username);
    repo.db.prepare('DELETE FROM AccessSession WHERE username=?').run(username);
    console.log('Cuenta deshabilitada y sesiones revocadas');
  } else if (command === 'bootstrap' || command === 'rotate') {
    if (command === 'rotate' && username !== 'administrador' && !moduleEvents[username]) throw new Error('Cuenta desconocida');
    mkdirSync('.artifacts', { recursive: true });
    const path = '.artifacts/credenciales-modulos.json';
    const credentials = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    for (const name of command === 'rotate' ? [username] : ['administrador', ...Object.keys(moduleEvents)]) {
      if (command === 'bootstrap' && repo.db.prepare('SELECT 1 FROM ModuleAccount WHERE username=?').get(name)) continue;
      const password = randomBytes(24).toString('base64url');
      await access.provision(name, password, name === 'administrador' ? 'admin' : 'module', moduleEvents[name] || []);
      credentials[name] = { usuario: name, password, eventos: moduleEvents[name] || [] };
    }
    writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    console.log('Credenciales guardadas localmente en .artifacts/credenciales-modulos.json; no compartir el archivo completo');
  } else throw new Error('Uso: manage-access.js bootstrap | rotate <cuenta> | disable <cuenta>');
} finally { repo.close(); }
