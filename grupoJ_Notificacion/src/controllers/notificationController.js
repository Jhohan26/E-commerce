export function createController(repository) {
  const positive = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const pagination = query => {
    const limit = Number(query.limit ?? 100), offset = Number(query.offset ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) return null;
    return { limit, offset };
  };
  return {
    list(req, res) {
      const page = pagination(req.query);
      if (!page) return res.status(400).json({ error: 'limit: 1..500; offset: entero no negativo' });
      res.json(repository.list(page));
    },
    client(req, res) {
      const page = pagination(req.query);
      if (!positive(req.params.clienteId) || !page) return res.status(400).json({ error: 'clienteId o paginación inválidos' });
      res.json(repository.list({ clienteId: Number(req.params.clienteId), ...page }));
    },
    get(req, res) {
      if (!positive(req.params.id)) return res.status(400).json({ error: 'id inválido' });
      const item = repository.get(Number(req.params.id));
      res.status(item ? 200 : 404).json(item || { error: 'Notificación no encontrada' });
    },
    read(req, res) {
      if (!positive(req.params.id)) return res.status(400).json({ error: 'id inválido' });
      const item = repository.markRead(Number(req.params.id));
      res.status(item ? 200 : 404).json(item || { error: 'Notificación no encontrada' });
    }
  };
}
