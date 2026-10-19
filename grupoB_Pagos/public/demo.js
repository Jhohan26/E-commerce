'use strict';
(() => {
  const container = document.getElementById('result-container');
  const note = document.getElementById('poll-status');
  const clientRequests = new Map();
  const loadClientName = () => {
    const target = container?.querySelector('[data-client-name]');
    if (!target) return;
    const orderId = target.dataset.orderId;
    target.textContent = 'Consultando…';
    const displayTimeout = window.setTimeout(() => {
      if (target.isConnected) target.textContent = 'Nombre no disponible';
    }, 15000);
    if (!clientRequests.has(orderId)) {
      clientRequests.set(orderId, (async () => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(`client.php?pedidoId=${encodeURIComponent(orderId)}`, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
          const result = await response.json();
          if (response.ok && result.status === 'ok' && typeof result.name === 'string') return result.name;
          return result.status === 'not_found' ? 'Cliente no encontrado' : 'Nombre no disponible';
        } catch { return 'Nombre no disponible'; }
        finally { window.clearTimeout(timer); }
      })());
    }
    clientRequests.get(orderId).then(name => {
      window.clearTimeout(displayTimeout);
      if (target.isConnected) target.textContent = name;
    });
  };
  loadClientName();
  if (!container || !container.dataset.pedido || container.querySelector('[data-final="1"][data-published="1"], [data-awaiting-decision="1"]')) return;
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('pedidoId', container.dataset.pedido);
  url.searchParams.set('format', 'json');
  let attempts = 0;
  const poll = async () => {
    if (document.hidden) {
      note.textContent = 'Consulta pausada. Recarga la página para actualizar.';
      return;
    }
    attempts++;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: {'Accept': 'application/json'}});
      if (!response.ok) throw new Error('Consulta no disponible');
      const result = await response.json();
      if (result.error) throw new Error('Consulta no disponible');
      container.innerHTML = result.html;
      loadClientName();
      if ((result.final && result.published) || result.awaitingDecision) { note.textContent = ''; return; }
      note.textContent = 'Consultando el resultado…';
    } catch (error) {
      note.textContent = 'No fue posible actualizar. Se volverá a consultar.';
    } finally {
      window.clearTimeout(timeout);
    }
    if (attempts < 20) window.setTimeout(poll, 3000);
    else note.textContent = 'Consulta automática finalizada. Puedes volver a consultar el pedido.';
  };
  note.textContent = 'Consultando el resultado…';
  window.setTimeout(poll, 3000);
})();

// Actualiza solo la lista lateral; no reemplaza el formulario de decisión.
(() => {
  const list = document.getElementById('pending-list');
  const count = document.getElementById('pending-count');
  const status = document.getElementById('pending-status');
  if (!list || !count || !status) return;
  document.getElementById('main').classList.add('with-pending-panel');
  const selected = document.getElementById('result-container')?.dataset.pedido;
  const money = new Intl.NumberFormat('es-CO', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  let loading = false;
  let signature = null;
  const refresh = async () => {
    if (loading || document.hidden) return;
    loading = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch('pending.php', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error('Consulta fallida');
      const data = await response.json();
      if (!Array.isArray(data.rows) || data.error) throw new Error('Respuesta invalida');
      count.textContent = String(data.total);
      const nextSignature = JSON.stringify(data.rows);
      if (nextSignature !== signature) {
        const fragment = document.createDocumentFragment();
        for (const row of data.rows) {
          const link = document.createElement('a');
          link.className = 'pending-order';
          link.href = `?pedidoId=${encodeURIComponent(row.pedido_id)}`;
          if (String(row.pedido_id) === selected) link.setAttribute('aria-current', 'true');
          const title = document.createElement('strong');
          title.textContent = `Pedido #${row.pedido_id}`;
          const amount = document.createElement('span');
          amount.textContent = money.format(Number(row.total));
          const client = document.createElement('small');
          client.textContent = `Cliente ID #${row.cliente_id}`;
          link.append(title, amount, client);
          fragment.append(link);
        }
        if (data.rows.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'pending-empty';
          empty.textContent = 'No hay pagos pendientes.';
          fragment.append(empty);
        }
        list.replaceChildren(fragment);
        signature = nextSignature;
      }
      status.textContent = data.total > data.rows.length
        ? `Mostrando los ${data.rows.length} más antiguos de ${data.total}.`
        : 'Se actualiza automáticamente cada 5 segundos.';
    } catch {
      if (signature === null) list.textContent = 'No fue posible cargar los pendientes.';
      status.textContent = 'No se pudo actualizar. Se reintentará automáticamente.';
    } finally { window.clearTimeout(timeout); loading = false; }
  };
  refresh();
  window.setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
