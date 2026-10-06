'use strict';
(() => {
  const container = document.getElementById('result-container');
  const note = document.getElementById('poll-status');
  if (!container || !container.dataset.pedido || container.querySelector('[data-final="1"]')) return;
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
      const response = await fetch(url, {cache: 'no-store', signal: controller.signal, headers: {'Accept': 'application/json'}});
      if (!response.ok) throw new Error('Consulta no disponible');
      const result = await response.json();
      if (result.error) throw new Error('Consulta no disponible');
      container.innerHTML = result.html;
      if (result.final) { note.textContent = ''; return; }
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