import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationRepository } from '../src/repositories/notificationRepository.js';
import { NotificationService } from '../src/services/notificationService.js';
import { EmailWorker } from '../src/services/emailWorker.js';
const event = { evento: 'PagoAprobado', clienteId: 25, pedidoId: 1, fecha: '2026-10-07T10:00:00Z' };
const config = { email: { from: 'sender@example.com', maxAttempts: 2 } };
const log = { info() {}, error() {} };
test('Notificación y correo se guardan juntos, sin duplicados ni reenvío después de aceptación', async () => {
  const repo = new NotificationRepository(':memory:');
  try {
    const service = new NotificationService(repo, true);
    service.process(event); service.process(event);
    assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM EmailJob').get().n, 1);
    let sends = 0;
    const worker = new EmailWorker(repo, { async getClient(id) { assert.equal(id, 25); return { correo: 'client@example.com' }; } },
      { async sendMail(mail) { sends++; assert.equal(mail.to, 'client@example.com'); return { accepted: [mail.to] }; } }, config, log);
    await worker.tick(); await worker.tick();
    assert.equal(sends, 1); assert.equal(repo.nextEmail(), undefined);
  } finally { repo.close(); }
});
test('Fallo SMTP conserva trabajo con espera y termina al agotar intentos', async () => {
  const repo = new NotificationRepository(':memory:');
  try {
    new NotificationService(repo, true).process(event);
    const worker = new EmailWorker(repo, { async getClient() { return { correo: 'client@example.com' }; } },
      { async sendMail() { throw new Error('secreto que no debe guardarse'); } }, config, log);
    await worker.tick();
    assert.equal(repo.nextEmail(), undefined);
    let job = repo.db.prepare('SELECT * FROM EmailJob').get();
    assert.equal(job.state, 'pending'); assert.equal(job.attempts, 1); assert.equal(job.lastError, 'EMAIL_DELIVERY_FAILED');
    repo.db.exec('UPDATE EmailJob SET nextAttempt=0'); await worker.tick();
    job = repo.db.prepare('SELECT * FROM EmailJob').get(); assert.equal(job.state, 'failed');
    assert.equal(repo.list().length, 1);
  } finally { repo.close(); }
});
test('Error de outbox revierte también la notificación antes del ACK', () => {
  const repo = new NotificationRepository(':memory:');
  try {
    repo.db.exec('DROP TABLE EmailJob');
    assert.throws(() => new NotificationService(repo, true).process(event));
    assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM Notificacion').get().n, 0);
  } finally { repo.close(); }
});
