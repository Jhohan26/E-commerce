import nodemailer from 'nodemailer';
export function createMailer(config) {
  const smtp = config.email;
  if (!smtp.user || !smtp.password || !smtp.from) throw new Error('Falta configurar SMTP_USER, SMTP_PASSWORD o SMTP_FROM');
  return nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure,
    requireTLS: !smtp.secure, tls: { rejectUnauthorized: true },
    auth: { user: smtp.user, pass: smtp.password }, connectionTimeout: 10000,
    greetingTimeout: 10000, socketTimeout: 15000, logger: false, debug: false });
}
export class EmailWorker {
  constructor(repository, rpc, mailer, config, log) { Object.assign(this, { repository, rpc, mailer, config, log }); }
  start() {
    this.stopped = false;
    const schedule = () => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.active = this.tick().catch(() => this.log.error('correo_worker_error')).finally(schedule);
      }, this.config.email.intervalMs);
    };
    schedule();
  }
  async tick() {
    const job = this.repository.nextEmail();
    if (!job) return;
    try {
      const notification = this.repository.get(job.notificationId);
      const client = await this.rpc.getClient(notification.clienteId);
      const result = await this.mailer.sendMail({ from: this.config.email.from, to: client.correo,
        subject: notification.titulo, text: notification.mensaje,
        messageId: `<${job.messageId}@notificaciones.local>` });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP_RECIPIENT_REJECTED');
      this.repository.emailAccepted(job.notificationId);
      this.log.info('correo_aceptado', { id: job.notificationId });
    } catch (error) {
      const reason = ['CLIENT_RPC_TIMEOUT', 'CLIENT_RECIPIENT_INVALID', 'SMTP_RECIPIENT_REJECTED'].includes(error.message)
        ? error.message : 'EMAIL_DELIVERY_FAILED';
      this.repository.emailFailed(job.notificationId, job.attempts + 1, this.config.email.maxAttempts, reason);
      this.log.error('correo_pendiente_o_fallido', { id: job.notificationId, intento: job.attempts + 1, motivo: reason });
    }
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.active; this.mailer.close(); }
}
