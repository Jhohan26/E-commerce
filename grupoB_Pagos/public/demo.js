'use strict';

(() => {
  const clientNames = new Map();
  const clientRequests = new Map();

  const getClientName = orderId => {
    const key = String(orderId);

    if (clientNames.has(key)) {
      return Promise.resolve(
        clientNames.get(key)
      );
    }

    if (clientRequests.has(key)) {
      return clientRequests.get(key);
    }

    const request = (async () => {
      const controller = new AbortController();

      const timer = window.setTimeout(
        () => controller.abort(),
        // Conexión, login, consulta y posible renovación del token RPC.
        60000
      );

      try {
        const response = await fetch(
          `client.php?pedidoId=${encodeURIComponent(key)}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              'Accept': 'application/json'
            }
          }
        );

        const result = await response.json();

        if (
          response.ok
          && result.status === 'ok'
          && typeof result.name === 'string'
          && result.name.trim() !== ''
        ) {
          const name = result.name.trim();

          clientNames.set(key, name);

          return name;
        }

        if (result.status === 'not_found') {
          const name = 'Cliente no encontrado';

          clientNames.set(key, name);

          return name;
        }

        return 'Nombre no disponible';
      } catch {
        return 'Nombre no disponible';
      } finally {
        window.clearTimeout(timer);
        clientRequests.delete(key);
      }
    })();

    clientRequests.set(key, request);

    return request;
  };

  const loadMainClientName = async () => {
    const container =
      document.getElementById('result-container');

    const target =
      container?.querySelector('[data-client-name]');

    if (!target) return;

    const orderId = target.dataset.orderId;

    if (!orderId) return;

    const name = await getClientName(orderId);

    if (target.isConnected) {
      target.textContent = name;
    }
  };

  const hydratePendingNames = async () => {
    const targets =
      document.querySelectorAll(
        '[data-pending-client-name]'
      );

    for (const target of targets) {
      const orderId = target.dataset.orderId;
      const clientId = target.dataset.clientId;

      if (!orderId || !clientId) {
        continue;
      }

      const name = await getClientName(orderId);

      if (!target.isConnected) {
        continue;
      }

      target.textContent =
        name === 'Nombre no disponible'
          ? `Cliente ID #${clientId}`
          : `Cliente ID #${clientId} · ${name}`;
    }
  };

  const container =
    document.getElementById('result-container');

  const note =
    document.getElementById('poll-status');

  loadMainClientName();

  window.setInterval(
    loadMainClientName,
    5000
  );

  if (
    container
    && container.dataset.pedido
    && !container.querySelector(
      '[data-final="1"][data-published="1"], [data-awaiting-decision="1"]'
    )
  ) {
    const url = new URL(window.location.href);

    url.search = '';
    url.searchParams.set(
      'pedidoId',
      container.dataset.pedido
    );
    url.searchParams.set(
      'format',
      'json'
    );

    let attempts = 0;

    const poll = async () => {
      if (document.hidden) {
        if (note) {
          note.textContent =
            'Consulta pausada. Recarga la página para actualizar.';
        }

        return;
      }

      attempts++;

      const controller = new AbortController();

      const timeout = window.setTimeout(
        () => controller.abort(),
        5000
      );

      try {
        const response = await fetch(
          url,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              'Accept': 'application/json'
            }
          }
        );

        if (!response.ok) {
          throw new Error(
            'Consulta no disponible'
          );
        }

        const result = await response.json();

        if (result.error) {
          throw new Error(
            'Consulta no disponible'
          );
        }

        container.innerHTML = result.html;

        await loadMainClientName();

        if (
          (result.final && result.published)
          || result.awaitingDecision
        ) {
          if (note) {
            note.textContent = '';
          }

          return;
        }

        if (note) {
          note.textContent =
            'Consultando el resultado…';
        }
      } catch {
        if (note) {
          note.textContent =
            'No fue posible actualizar. Se volverá a consultar.';
        }
      } finally {
        window.clearTimeout(timeout);
      }

      if (attempts < 20) {
        window.setTimeout(
          poll,
          3000
        );
      } else if (note) {
        note.textContent =
          'Consulta automática finalizada. Puedes volver a consultar el pedido.';
      }
    };

    if (note) {
      note.textContent =
        'Consultando el resultado…';
    }

    window.setTimeout(
      poll,
      3000
    );
  }

  const list =
    document.getElementById('pending-list');

  const count =
    document.getElementById('pending-count');

  const status =
    document.getElementById('pending-status');

  if (!list || !count || !status) {
    return;
  }

  document
    .getElementById('main')
    ?.classList
    .add('with-pending-panel');

  const selected =
    document
      .getElementById('result-container')
      ?.dataset
      .pedido;

  const money = new Intl.NumberFormat(
    'es-CO',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

  let loading = false;
  let signature = null;

  const refresh = async () => {
    if (loading || document.hidden) {
      return;
    }

    loading = true;

    const controller = new AbortController();

    const timeout = window.setTimeout(
      () => controller.abort(),
      7000
    );

    try {
      const response = await fetch(
        'pending.php',
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          'Consulta fallida'
        );
      }

      const data = await response.json();

      if (
        !Array.isArray(data.rows)
        || data.error
      ) {
        throw new Error(
          'Respuesta inválida'
        );
      }

      count.textContent =
        String(data.total);

      const nextSignature =
        JSON.stringify(data.rows);

      if (nextSignature !== signature) {
        const fragment =
          document.createDocumentFragment();

        for (const row of data.rows) {
          const link =
            document.createElement('a');

          link.className =
            'pending-order';

          link.href =
            `?pedidoId=${encodeURIComponent(row.pedido_id)}`;

          if (
            String(row.pedido_id)
            === selected
          ) {
            link.setAttribute(
              'aria-current',
              'true'
            );
          }

          const title =
            document.createElement('strong');

          title.textContent =
            `Pedido #${row.pedido_id}`;

          const amount =
            document.createElement('span');

          amount.textContent =
            money.format(
              Number(row.total)
            );

          const client =
            document.createElement('small');

          client.dataset.pendingClientName = '1';
          client.dataset.orderId =
            String(row.pedido_id);
          client.dataset.clientId =
            String(row.cliente_id);

          client.textContent =
            `Cliente ID #${row.cliente_id}`;

          link.append(
            title,
            amount,
            client
          );

          fragment.append(link);
        }

        if (data.rows.length === 0) {
          const empty =
            document.createElement('p');

          empty.className =
            'pending-empty';

          empty.textContent =
            'No hay pagos pendientes.';

          fragment.append(empty);
        }

        list.replaceChildren(fragment);

        signature = nextSignature;
      }

      // Los nombres tienen su propio timeout y no bloquean el panel.
      void hydratePendingNames();
      void loadMainClientName();

      status.textContent =
        data.total > data.rows.length
          ? `Mostrando los ${data.rows.length} más antiguos de ${data.total}.`
          : 'Se actualiza automáticamente cada 5 segundos.';
    } catch {
      if (signature === null) {
        list.textContent =
          'No fue posible cargar los pendientes.';
      }

      status.textContent =
        'No se pudo actualizar. Se reintentará automáticamente.';
    } finally {
      window.clearTimeout(timeout);
      loading = false;
    }
  };

  refresh();

  window.setInterval(
    refresh,
    5000
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) {
        refresh();
        loadMainClientName();
      }
    }
  );
})();
