// Interfaz del microservicio de Pedidos.
import { api } from './api.js';
import {
  ESTADOS, estadoMeta, escapeHtml, formatMoney, formatNumber,
  formatDateParts, formatDateTime, debounce, statusChipHtml,
  getClienteInfo, getClienteNombre, getProductoInfo, getProductoNombre,
  getProductoIcono, iniciales, CLIENTES_CATALOGO, PRODUCTOS_CATALOGO,
  actualizarClientesCatalogo, actualizarProductosCatalogo
} from './utils.js';

const PAGE_SIZE = 10;
const HEALTH_INTERVAL_MS = 15000;

const state = {
  orders: [],
  loaded: false,
  loadError: null,
  filter: 'TODOS',
  query: '',
  page: 1,
  menuId: null,
  menuBtn: null,
  detailId: null,
  detail: null,
  statusId: null
};

const $ = (id) => document.getElementById(id);

const el = {
  svc: { api: $('svc-api'), mysql: $('svc-mysql'), rabbit: $('svc-rabbit') },
  kpi: { total: $('kpi-total'), pend: $('kpi-pendientes'), pag: $('kpi-pagados'), monto: $('kpi-monto') },
  body: $('orders-body'),
  search: $('search'),
  filter: $('filter-estado'),
  refresh: $('btn-refresh'),
  refreshIcon: $('refresh-icon'),
  footInfo: $('foot-info'),
  pgPrev: $('pg-prev'),
  pgNext: $('pg-next'),
  pgLabel: $('pg-label'),
  lastUpdate: $('last-update'),
  menu: $('row-menu'),
  btnNew: $('btn-new'),
  toasts: $('toasts'),

  drawerNew: $('drawer-new'),
  form: $('order-form'),
  cliente: $('cliente-id'),
  clientCard: $('client-card'),
  clientAvatar: $('client-avatar'),
  clientName: $('client-name'),
  clientMeta: $('client-meta'),
  clientCheck: $('client-check'),
  clienteHelp: $('cliente-help'),
  errCliente: $('err-cliente'),
  formError: $('form-error'),
  lines: $('lines-list'),
  addLine: $('btn-add-line'),
  formTotal: $('form-total'),
  eventPreview: $('event-preview'),
  example: $('btn-example'),
  submit: $('btn-submit'),

  drawerDetail: $('drawer-detail'),
  detailTitle: $('detail-title'),
  detailSub: $('detail-sub'),
  detailBody: $('detail-body'),
  detailStatus: $('detail-status'),
  detailResend: $('detail-resend'),

  dlgStatus: $('dlg-status'),
  statusForm: $('status-form'),
  statusText: $('status-text'),
  statusSelect: $('status-select'),
  statusError: $('status-error'),
  statusSave: $('status-save')
};

/* ============================================================
   Utilidades de interfaz
   ============================================================ */

function friendlyError(err) {
  if (err && err.name === 'TypeError') {
    return 'No se pudo conectar con el servidor. Verifica que esté en ejecución e inténtalo de nuevo.';
  }
  return (err && err.message) || 'Ocurrió un error inesperado.';
}

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function bringToastsToFront() {
  // Los avisos viven en la capa superior para verse por encima de los paneles.
  try {
    el.toasts.hidePopover();
    el.toasts.showPopover();
  } catch { /* El navegador no soporta popover: se usa posición fija normal. */ }
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  bringToastsToFront();
}

function toast(message, type = 'info') {
  const iconName = { success: 'check', warning: 'alert', error: 'alert', info: 'info' }[type] || 'info';
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.innerHTML = `<span class="toast-icon">${icon(iconName, 18)}</span><span class="toast-text"></span>`;
  node.querySelector('.toast-text').textContent = message;

  while (el.toasts.children.length >= 4) el.toasts.firstElementChild.remove();
  el.toasts.appendChild(node);
  bringToastsToFront();

  const life = type === 'error' || type === 'warning' ? 8000 : 4500;
  setTimeout(() => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 200);
  }, life);
}

function showInline(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function hideInline(node) {
  node.textContent = '';
  node.hidden = true;
}

/* ============================================================
   Estado de los servicios
   ============================================================ */

function setService(node, serviceState, text, title = '') {
  node.dataset.state = serviceState;
  const label = node.querySelector('.service-state');
  label.textContent = text;
  label.classList.toggle('sr-only', serviceState === 'ok' || serviceState === 'checking');
  node.title = title;
}

async function checkHealth() {
  try {
    const data = await api.salud();
    setService(el.svc.api, 'ok', 'Conectado', 'API en línea');

    const my = data.mysql || {};
    setService(el.svc.mysql, my.connected ? 'ok' : 'down',
      my.connected ? 'Conectado' : 'Sin conexión', my.message || '');

    const rb = data.rabbitmq || {};
    setService(el.svc.rabbit, rb.connected ? 'ok' : 'down',
      rb.connected ? 'Conectado' : 'Sin conexión',
      rb.exchange ? `Exchange: ${rb.exchange}` : '');
  } catch {
    setService(el.svc.api, 'down', 'Sin conexión', 'No se pudo contactar con la API');
    setService(el.svc.mysql, 'unknown', 'Sin datos');
    setService(el.svc.rabbit, 'unknown', 'Sin datos');
  }
}

/* ============================================================
   Listado de pedidos
   ============================================================ */

function setRefreshing(on) {
  el.refresh.disabled = on;
  el.refreshIcon.classList.toggle('spin', on);
}

function stampUpdate() {
  const t = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  el.lastUpdate.textContent = `Actualizado a las ${t}`;
}

async function loadOrders({ silent = false } = {}) {
  if (!silent && !state.loaded) renderSkeleton();
  setRefreshing(true);
  try {
    const data = await api.listar();
    state.orders = data.pedidos || [];
    state.loadError = null;
    state.loaded = true;
    stampUpdate();
  } catch (err) {
    state.loadError = err;
  } finally {
    setRefreshing(false);
  }
  render();
}

function filteredOrders() {
  const q = state.query.trim().replace(/^#/, '').toLowerCase();
  return state.orders.filter((o) => {
    if (state.filter !== 'TODOS' && o.estado !== state.filter) return false;
    if (!q) return true;
    return String(o.id).includes(q) || String(o.clienteId).includes(q);
  });
}

function renderSkeleton() {
  const row = `
    <tr class="skeleton-row" aria-hidden="true">
      <td><span class="skeleton" style="width:56px"></span></td>
      <td><span class="skeleton" style="width:72px"></span></td>
      <td><span class="skeleton" style="width:96px"></span></td>
      <td class="num"><span class="skeleton" style="width:24px"></span></td>
      <td class="num"><span class="skeleton" style="width:80px"></span></td>
      <td><span class="skeleton" style="width:84px"></span></td>
      <td></td>
    </tr>`;
  el.body.innerHTML = row.repeat(4);
}

function emptyRow(title, text, actionLabel, action) {
  const button = actionLabel
    ? `<button type="button" class="btn btn-sm" data-action="${action}">${escapeHtml(actionLabel)}</button>`
    : '';
  return `
    <tr class="empty-row">
      <td colspan="7">
        <div class="empty">
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(text)}</p>
          ${button}
        </div>
      </td>
    </tr>`;
}

function orderRow(o) {
  const date = formatDateParts(o.fecha);
  const items = Number(o.totalItems) || 0;
  const clienteInfo = getClienteInfo(o.clienteId);
  const clienteNombre = clienteInfo ? clienteInfo.nombre : (Number(o.clienteId) === 25 ? 'Carlos Gómez' : `Cliente #${o.clienteId}`);
  return `
    <tr data-id="${o.id}" class="is-clickable">
      <td><button type="button" class="id-link" data-action="detail" data-id="${o.id}">#${o.id}</button></td>
      <td>
        <span class="cell-main"><strong>${escapeHtml(clienteNombre)}</strong></span>
        <span class="sub-name">ID: #${escapeHtml(o.clienteId)}</span>
      </td>
      <td><span class="date">${escapeHtml(date.date)}</span><span class="time">${escapeHtml(date.time)}</span></td>
      <td class="num" title="${items} ${items === 1 ? 'producto' : 'productos'}">${formatNumber(o.totalUnidades)}</td>
      <td class="num strong">${formatMoney(o.total)}</td>
      <td>${statusChipHtml(o.estado)}</td>
      <td class="col-actions">
        <button type="button" class="icon-btn" data-action="menu" data-id="${o.id}"
                aria-haspopup="menu" aria-expanded="false" aria-label="Acciones del pedido #${o.id}">
          ${icon('more')}
        </button>
      </td>
    </tr>`;
}

function render() {
  updateKpis();

  if (state.loadError && !state.orders.length) {
    el.body.innerHTML = emptyRow('No se pudieron cargar los pedidos', friendlyError(state.loadError), 'Reintentar', 'retry');
    el.footInfo.textContent = '';
    updatePager(0, 0, 1);
    return;
  }

  const list = filteredOrders();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const slice = list.slice(start, start + PAGE_SIZE);

  if (!state.orders.length) {
    el.body.innerHTML = emptyRow('Todavía no hay pedidos', 'Crea el primero para verlo aquí y publicar su evento en RabbitMQ.', 'Nuevo pedido', 'new');
  } else if (!slice.length) {
    el.body.innerHTML = emptyRow('Ningún pedido coincide', 'Prueba con otro número de pedido o de cliente, o cambia el estado.', 'Quitar filtros', 'clear');
  } else {
    el.body.innerHTML = slice.map(orderRow).join('');
  }

  const from = list.length ? start + 1 : 0;
  const to = start + slice.length;
  el.footInfo.textContent = list.length
    ? `Mostrando ${from} a ${to} de ${list.length} ${list.length === 1 ? 'pedido' : 'pedidos'}`
    : '0 pedidos';
  updatePager(list.length, slice.length, pages);
}

function updatePager(total, shown, pages) {
  el.pgLabel.textContent = `Página ${state.page} de ${pages}`;
  el.pgPrev.disabled = state.page <= 1;
  el.pgNext.disabled = state.page >= pages;
}

function updateKpis() {
  const o = state.orders;
  const paid = ['PAGADO', 'ENVIADO', 'COMPLETADO'];
  el.kpi.total.textContent = formatNumber(o.length);
  el.kpi.pend.textContent = formatNumber(o.filter((x) => x.estado === 'PENDIENTE').length);
  el.kpi.pag.textContent = formatNumber(o.filter((x) => paid.includes(x.estado)).length);
  el.kpi.monto.textContent = formatMoney(o.reduce((acc, x) => acc + Number(x.total || 0), 0));
}

function clearFilters() {
  state.filter = 'TODOS';
  state.query = '';
  state.page = 1;
  el.filter.value = 'TODOS';
  el.search.value = '';
  render();
}

/* ============================================================
   Menú de acciones por fila
   ============================================================ */

function openMenu(btn, id) {
  if (!el.menu.hidden && state.menuBtn === btn) {
    closeMenu();
    return;
  }
  closeMenu();
  state.menuId = id;
  state.menuBtn = btn;
  btn.setAttribute('aria-expanded', 'true');
  el.menu.hidden = false;

  const r = btn.getBoundingClientRect();
  const w = el.menu.offsetWidth;
  const h = el.menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  el.menu.style.left = `${left}px`;
  el.menu.style.top = `${top}px`;
  el.menu.querySelector('button').focus();
}

function closeMenu({ returnFocus = false } = {}) {
  if (el.menu.hidden) return;
  el.menu.hidden = true;
  if (state.menuBtn) {
    state.menuBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) state.menuBtn.focus();
  }
  state.menuBtn = null;
}

el.menu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-action]');
  if (!item) return;
  const id = state.menuId;
  closeMenu();
  if (item.dataset.action === 'detail') openDetail(id);
  if (item.dataset.action === 'status') openStatus(id);
  if (item.dataset.action === 'resend') resendEvent(id);
});

el.menu.addEventListener('keydown', (e) => {
  const items = [...el.menu.querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === 'Escape') { e.preventDefault(); closeMenu({ returnFocus: true }); }
  if (e.key === 'Tab') closeMenu();
});

document.addEventListener('click', (e) => {
  if (el.menu.hidden) return;
  if (el.menu.contains(e.target) || e.target.closest('[data-action="menu"]')) return;
  closeMenu();
});
window.addEventListener('scroll', () => closeMenu(), true);
window.addEventListener('resize', () => closeMenu());

/* ============================================================
   Nuevo pedido
   ============================================================ */

function lineNode(values = {}) {
  const row = document.createElement('div');
  row.className = 'line';
  row.innerHTML = `
    <span class="line-icon" aria-hidden="true"><svg width="22" height="22"><use href="#p-box"/></svg></span>
    <div class="line-info">
      <div class="line-top">
        <input class="control control-sm control-mono l-prod" type="number" inputmode="numeric" min="1" step="1" placeholder="ID" list="productos-datalist" aria-label="ID del producto" required>
        <span class="l-prod-name">Selecciona un producto</span>
      </div>
      <label class="line-price">
        <span>Precio unit.</span>
        <input class="control control-sm control-mono l-price" type="number" inputmode="decimal" min="0" step="any" placeholder="0" aria-label="Precio unitario en pesos" required>
      </label>
    </div>
    <div class="stepper">
      <button type="button" class="step-btn l-minus" aria-label="Restar una unidad">${icon('minus', 14)}</button>
      <input class="l-qty" type="number" inputmode="numeric" min="1" step="1" aria-label="Cantidad" required>
      <button type="button" class="step-btn l-plus" aria-label="Sumar una unidad">${icon('plus', 14)}</button>
    </div>
    <output class="line-sub">${formatMoney(0)}</output>
    <button type="button" class="icon-btn l-del" aria-label="Quitar producto">${icon('close', 16)}</button>`;

  const prod = row.querySelector('.l-prod');
  const qty = row.querySelector('.l-qty');
  const price = row.querySelector('.l-price');
  const prodName = row.querySelector('.l-prod-name');
  const iconUse = row.querySelector('.line-icon use');
  const minusBtn = row.querySelector('.l-minus');
  const plusBtn = row.querySelector('.l-plus');
  const delBtn = row.querySelector('.l-del');

  prod.value = values.productoId ?? '';
  qty.value = values.cantidad ?? 1;
  price.value = values.precio ?? '';
  if (values.precio != null) price.dataset.manual = '1';

  minusBtn.addEventListener('click', () => {
    const cur = Math.max(1, (Number(qty.value) || 1) - 1);
    qty.value = cur;
    refreshLines();
  });

  plusBtn.addEventListener('click', () => {
    const cur = Math.max(1, (Number(qty.value) || 0) + 1);
    qty.value = cur;
    refreshLines();
  });

  delBtn.addEventListener('click', () => {
    if (el.lines.children.length > 1) {
      row.remove();
      refreshLines();
    }
  });

  qty.addEventListener('input', refreshLines);
  qty.addEventListener('change', refreshLines);

  // Si el usuario escribe el precio a mano, ya no se reemplaza automáticamente.
  price.addEventListener('input', () => {
    price.dataset.manual = price.value ? '1' : '';
    refreshLines();
  });
  price.addEventListener('change', () => {
    price.dataset.manual = price.value ? '1' : '';
    refreshLines();
  });

  const syncProd = () => {
    const id = Number(prod.value);
    const info = getProductoInfo(id);
    iconUse.setAttribute('href', `#${getProductoIcono(id)}`);
    row.classList.toggle('is-known', !!info);
    if (info) {
      prodName.textContent = info.nombre;
      if (!price.dataset.manual) price.value = info.precio;
    } else {
      prodName.textContent = id ? `Producto #${id} (sin catálogo)` : 'Selecciona un producto';
    }
    refreshLines();
  };

  prod.addEventListener('input', syncProd);
  prod.addEventListener('change', syncProd);
  syncProd();

  return row;
}

function lineValues(row) {
  return {
    prod: row.querySelector('.l-prod'),
    qty: row.querySelector('.l-qty'),
    price: row.querySelector('.l-price'),
    sub: row.querySelector('.line-sub'),
    name: row.querySelector('.l-prod-name')
  };
}

function addLine(values) {
  el.lines.appendChild(lineNode(values));
  refreshLines();
}

function refreshLines() {
  const rows = [...el.lines.children];
  rows.forEach((row) => {
    const v = lineValues(row);
    const subtotal = (Number(v.qty.value) || 0) * (Number(v.price.value) || 0);
    v.sub.textContent = formatMoney(subtotal);
    row.querySelector('.l-del').disabled = rows.length <= 1;
  });
  el.formTotal.textContent = formatMoney(currentTotal());
  updatePreview();
}

function currentTotal() {
  return [...el.lines.children].reduce((acc, row) => {
    const v = lineValues(row);
    return acc + (Number(v.qty.value) || 0) * (Number(v.price.value) || 0);
  }, 0);
}

function updatePreview() {
  const productos = [...el.lines.children]
    .map((row) => {
      const v = lineValues(row);
      return { productoId: Number(v.prod.value) || 0, cantidad: Number(v.qty.value) || 0, precio: Number(v.price.value) || 0 };
    })
    .filter((p) => p.productoId > 0 && p.cantidad > 0);

  const evento = {
    evento: 'PedidoCreado',
    pedidoId: 'se asigna al guardar',
    clienteId: Number(el.cliente.value) || null,
    fecha: 'se asigna al guardar',
    total: currentTotal(),
    productos
  };
  el.eventPreview.textContent = JSON.stringify(evento, null, 2);
}

async function cargarClientes() {
  try {
    const data = await api.clientes();
    if (data && Array.isArray(data.clientes)) {
      actualizarClientesCatalogo(data.clientes);
      populateDatalists();
      render();
      if (data.clientes.length === 0) {
        el.clienteHelp.textContent = 'Servicio de Clientes conectado (Grupo F), pero aún no tiene clientes creados en su base de datos.';
      } else {
        el.clienteHelp.textContent = `${data.clientes.length} cliente(s) obtenido(s) desde el Grupo F.`;
      }
    }
  } catch (err) {
    console.warn('[Clientes] No se pudieron sincronizar los clientes vía RPC:', err.message);
  }
}

async function cargarProductos() {
  try {
    const data = await api.productos();
    if (data && Array.isArray(data.productos)) {
      actualizarProductosCatalogo(data.productos);
      populateDatalists();
      render();
    }
  } catch (err) {
    console.warn('[Productos] No se pudieron sincronizar los productos vía RPC:', err.message);
  }
}

function updateClienteCard() {
  const val = Number(el.cliente.value);
  if (!val) {
    el.clientCard.hidden = true;
    el.clienteHelp.textContent = 'Debe existir en el servicio de Clientes (Grupo F).';
    return;
  }
  const info = getClienteInfo(val);
  if (info) {
    el.clientCard.hidden = false;
    el.clientAvatar.textContent = iniciales(info.nombre);
    el.clientName.textContent = info.nombre;
    const metaParts = [];
    if (info.correo) metaParts.push(info.correo);
    else if (info.ciudad) metaParts.push(info.ciudad);
    metaParts.push(`Cliente #${info.id}`);
    el.clientMeta.textContent = metaParts.join(' · ');

    if (info.activo === false || info.estado === 0) {
      el.clienteHelp.textContent = '⚠️ Atención: Este cliente figura como inactivo en el servicio de Clientes.';
      el.clientCheck.style.color = '#ef4444';
    } else {
      el.clienteHelp.textContent = `Cliente verificado desde el servicio de Clientes (Grupo F).`;
      el.clientCheck.style.color = '';
    }
  } else {
    el.clientCard.hidden = false;
    el.clientAvatar.textContent = `#${val}`;
    el.clientName.textContent = `Cliente #${val}`;
    el.clientMeta.textContent = 'No registrado en Grupo F';
    el.clienteHelp.textContent = 'Este ID no existe en la base de datos de Clientes.';
    el.clientCheck.style.color = '#eab308';
  }
}

function clearFormErrors() {
  hideInline(el.formError);
  hideInline(el.errCliente);
  el.cliente.removeAttribute('aria-invalid');
  el.lines.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
}

function resetForm() {
  el.form.reset();
  el.lines.innerHTML = '';
  clearFormErrors();
  updateClienteCard();
  addLine();
}

function validateForm() {
  clearFormErrors();
  let valid = true;
  let firstInvalid = null;

  const mark = (input) => {
    input.setAttribute('aria-invalid', 'true');
    if (!firstInvalid) firstInvalid = input;
    valid = false;
  };

  const clienteId = Number(el.cliente.value);
  if (!Number.isInteger(clienteId) || clienteId < 1) {
    mark(el.cliente);
    showInline(el.errCliente, 'Ingresa el ID del cliente, un número entero mayor que 0.');
  }

  const productos = [];
  [...el.lines.children].forEach((row) => {
    const v = lineValues(row);
    const productoId = Number(v.prod.value);
    const cantidad = Number(v.qty.value);
    const precio = Number(v.price.value);
    let rowOk = true;

    if (!Number.isInteger(productoId) || productoId < 1) { mark(v.prod); rowOk = false; }
    if (!Number.isInteger(cantidad) || cantidad < 1) { mark(v.qty); rowOk = false; }
    if (v.price.value === '' || !(precio >= 0)) { mark(v.price); rowOk = false; }
    if (rowOk) productos.push({ productoId, cantidad, precio });
  });

  if (!valid) {
    showInline(el.formError, 'Revisa los campos marcados. El ID del producto y la cantidad deben ser enteros mayores que 0, y el precio no puede estar vacío.');
    if (firstInvalid) firstInvalid.focus();
    return null;
  }
  return { clienteId, productos };
}

function openNew() {
  if (!el.lines.children.length) addLine();
  cargarClientes();
  updateClienteCard();
  updatePreview();
  openDialog(el.drawerNew);
  el.cliente.focus();
}

function loadExample() {
  el.cliente.value = 25;
  updateClienteCard();
  el.lines.innerHTML = '';
  addLine({ productoId: 15, cantidad: 2, precio: 2500000 });
  clearFormErrors();
}

function setSubmitting(on) {
  el.submit.disabled = on;
  el.submit.textContent = on ? 'Creando pedido…' : 'Crear pedido';
}

async function handleSubmit(e) {
  e.preventDefault();
  const payload = validateForm();
  if (!payload) return;

  setSubmitting(true);
  try {
    const data = await api.crear(payload);
    const id = data.pedido.id;
    el.drawerNew.close();
    resetForm();

    if (data.rabbitmq && data.rabbitmq.publicado) {
      toast(`Pedido #${id} creado. El evento PedidoCreado se publicó en RabbitMQ.`, 'success');
    } else {
      toast(`Pedido #${id} guardado, pero el evento no llegó a RabbitMQ. Usa "Reenviar evento" cuando el servicio esté disponible.`, 'warning');
    }

    state.page = 1;
    await loadOrders({ silent: true });
    checkHealth();
    openDetail(id);
  } catch (err) {
    showInline(el.formError, friendlyError(err));
    el.formError.scrollIntoView({ block: 'nearest' });
  } finally {
    setSubmitting(false);
  }
}

el.lines.addEventListener('input', (e) => {
  if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid');
  refreshLines();
});

el.lines.addEventListener('click', (e) => {
  const minus = e.target.closest('.l-minus');
  if (minus) {
    const row = minus.closest('.line');
    const qtyInput = row.querySelector('.l-qty');
    const current = Number(qtyInput.value) || 1;
    if (current > 1) {
      qtyInput.value = current - 1;
      refreshLines();
    }
    return;
  }

  const plus = e.target.closest('.l-plus');
  if (plus) {
    const row = plus.closest('.line');
    const qtyInput = row.querySelector('.l-qty');
    const current = Number(qtyInput.value) || 0;
    qtyInput.value = current + 1;
    refreshLines();
    return;
  }

  const del = e.target.closest('.l-del');
  if (!del || el.lines.children.length <= 1) return;
  del.closest('.line').remove();
  refreshLines();
});

el.cliente.addEventListener('input', () => {
  el.cliente.removeAttribute('aria-invalid');
  hideInline(el.errCliente);
  updateClienteCard();
  updatePreview();
});

/* ============================================================
   Detalle del pedido
   ============================================================ */

function eventPayload(p) {
  return {
    evento: 'PedidoCreado',
    pedidoId: p.id,
    clienteId: p.clienteId,
    fecha: p.fecha,
    total: Number(p.total),
    productos: p.productos.map((i) => ({
      productoId: i.productoId,
      cantidad: i.cantidad,
      precio: Number(i.precio)
    }))
  };
}

function renderDetail(p) {
  el.detailTitle.textContent = `Pedido #${p.id}`;
  el.detailSub.textContent = 'Resumen del pedido y evento publicado';

  const rows = p.productos.map((i) => {
    const prodNom = getProductoNombre(i.productoId);
    return `
      <tr>
        <td>
          <span class="cell-main" style="display:block;font-weight:600;color:inherit;">${escapeHtml(prodNom)}</span>
          <span class="sub-name mono" style="font-size:0.8rem;color:var(--c-muted,#64748b);">ID: #${escapeHtml(i.productoId)}</span>
        </td>
        <td class="num">${formatNumber(i.cantidad)}</td>
        <td class="num">${formatMoney(i.precio)}</td>
        <td class="num strong">${formatMoney(i.subtotal)}</td>
      </tr>`;
  }).join('');

  const json = JSON.stringify(eventPayload(p), null, 2);
  const clienteInfo = getClienteInfo(p.clienteId);
  const clienteNom = clienteInfo ? clienteInfo.nombre : (Number(p.clienteId) === 25 ? 'Carlos Gómez' : `Cliente #${p.clienteId}`);

  el.detailBody.innerHTML = `
    <dl class="facts">
      <div><dt>Estado</dt><dd>${statusChipHtml(p.estado)}</dd></div>
      <div><dt>Cliente</dt><dd><strong>${escapeHtml(clienteNom)}</strong> <span style="color:var(--c-muted,#64748b);font-size:0.85rem;">(ID: #${escapeHtml(p.clienteId)})</span></dd></div>
      <div><dt>Fecha</dt><dd>${escapeHtml(formatDateTime(p.fecha))}</dd></div>
      <div><dt>Total</dt><dd class="strong">${formatMoney(p.total)}</dd></div>
    </dl>

    <section class="section">
      <h3>Productos</h3>
      <table class="table table-compact">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col" class="num">Cantidad</th>
            <th scope="col" class="num">Precio unitario</th>
            <th scope="col" class="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <section class="section">
      <div class="section-head">
        <h3>Evento <code>PedidoCreado</code></h3>
        <button type="button" class="btn btn-quiet btn-sm" id="btn-copy">Copiar JSON</button>
      </div>
      <pre class="code" tabindex="0" aria-label="Evento en formato JSON"></pre>
      <p class="field-help">Este es el mensaje que consumen Inventario, Pagos, Notificaciones y Reportes.</p>
    </section>`;

  el.detailBody.querySelector('pre').textContent = json;
  el.detailBody.querySelector('#btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast('JSON copiado al portapapeles.', 'success');
    } catch {
      toast('No se pudo copiar. Selecciona el texto y cópialo manualmente.', 'warning');
    }
  });

  el.detailStatus.disabled = false;
  el.detailResend.disabled = false;
}

async function openDetail(id) {
  state.detailId = id;
  state.detail = null;
  el.detailTitle.textContent = `Pedido #${id}`;
  el.detailSub.textContent = 'Cargando…';
  el.detailBody.innerHTML = `
    <div class="skeleton-block"><span class="skeleton" style="width:60%"></span><span class="skeleton" style="width:85%"></span><span class="skeleton" style="width:40%"></span></div>`;
  el.detailStatus.disabled = true;
  el.detailResend.disabled = true;
  openDialog(el.drawerDetail);

  try {
    const data = await api.obtener(id);
    if (state.detailId !== id) return;
    state.detail = data.pedido;
    renderDetail(data.pedido);
  } catch (err) {
    if (state.detailId !== id) return;
    el.detailSub.textContent = '';
    el.detailBody.innerHTML = `<div class="alert alert-error" role="alert"></div>`;
    el.detailBody.firstElementChild.textContent = `No se pudo cargar el pedido. ${friendlyError(err)}`;
  }
}

/* ============================================================
   Cambiar estado
   ============================================================ */

function openStatus(id) {
  const order = state.orders.find((o) => o.id === id) || (state.detail && state.detail.id === id ? state.detail : null);
  const current = order ? order.estado : 'PENDIENTE';
  state.statusId = id;

  el.statusSelect.innerHTML = ESTADOS.map((s) =>
    `<option value="${s.value}">${escapeHtml(s.label)}</option>`).join('');
  el.statusSelect.value = current;
  el.statusText.textContent = `Pedido #${id}. Estado actual: ${estadoMeta(current).label}.`;
  hideInline(el.statusError);
  el.statusSave.disabled = false;
  el.statusSave.textContent = 'Guardar cambio';
  openDialog(el.dlgStatus);
  el.statusSelect.focus();
}

async function handleStatusSubmit(e) {
  e.preventDefault();
  const id = state.statusId;
  const order = state.orders.find((o) => o.id === id) || state.detail;
  const next = el.statusSelect.value;

  if (order && order.estado === next) {
    showInline(el.statusError, 'El pedido ya está en ese estado. Elige uno distinto.');
    return;
  }

  el.statusSave.disabled = true;
  el.statusSave.textContent = 'Guardando…';
  try {
    await api.cambiarEstado(id, next);
    el.dlgStatus.close();
    toast(`Pedido #${id} actualizado a "${estadoMeta(next).label}".`, 'success');
    await loadOrders({ silent: true });
    if (el.drawerDetail.open && state.detailId === id) {
      const data = await api.obtener(id);
      state.detail = data.pedido;
      renderDetail(data.pedido);
    }
  } catch (err) {
    showInline(el.statusError, friendlyError(err));
    el.statusSave.disabled = false;
    el.statusSave.textContent = 'Guardar cambio';
  }
}

/* ============================================================
   Reenviar evento a RabbitMQ
   ============================================================ */

async function resendEvent(id) {
  el.detailResend.disabled = true;
  try {
    const data = await api.reenviarEvento(id);
    if (data.resultado && data.resultado.success) {
      toast(`Evento del pedido #${id} reenviado a RabbitMQ.`, 'success');
    } else {
      const reason = data.resultado && data.resultado.error ? data.resultado.error : 'RabbitMQ no confirmó el envío.';
      toast(`No se pudo reenviar el evento del pedido #${id}. ${reason}`, 'warning');
    }
  } catch (err) {
    toast(`No se pudo reenviar el evento del pedido #${id}. ${friendlyError(err)}`, 'error');
  } finally {
    el.detailResend.disabled = !state.detail;
    checkHealth();
  }
}

/* ============================================================
   Eventos globales
   ============================================================ */

el.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn) {
    const id = Number(btn.dataset.id);
    switch (btn.dataset.action) {
      case 'menu': openMenu(btn, id); break;
      case 'detail': openDetail(id); break;
      case 'retry': loadOrders(); break;
      case 'new': openNew(); break;
      case 'clear': clearFilters(); break;
    }
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row) openDetail(Number(row.dataset.id));
});

el.btnNew.addEventListener('click', openNew);
el.addLine.addEventListener('click', () => {
  addLine();
  const last = el.lines.lastElementChild;
  if (last) last.querySelector('.l-prod').focus();
});
el.example.addEventListener('click', loadExample);
el.form.addEventListener('submit', handleSubmit);

el.cliente.addEventListener('input', () => {
  updateClienteCard();
  updatePreview();
});
el.cliente.addEventListener('change', () => {
  updateClienteCard();
  updatePreview();
});

el.refresh.addEventListener('click', async () => {
  await Promise.all([loadOrders({ silent: true }), checkHealth(), cargarClientes(), cargarProductos()]);
  if (!state.loadError) toast('Datos actualizados.', 'info');
});

el.search.addEventListener('input', debounce(() => {
  state.query = el.search.value;
  state.page = 1;
  render();
}, 150));

el.filter.addEventListener('change', () => {
  state.filter = el.filter.value;
  state.page = 1;
  render();
});

el.pgPrev.addEventListener('click', () => { state.page -= 1; render(); });
el.pgNext.addEventListener('click', () => { state.page += 1; render(); });

el.detailStatus.addEventListener('click', () => { if (state.detailId) openStatus(state.detailId); });
el.detailResend.addEventListener('click', () => { if (state.detailId) resendEvent(state.detailId); });
el.statusForm.addEventListener('submit', handleStatusSubmit);

// Cierre de diálogos
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
});

function populateDatalists() {
  const cl = $('clientes-datalist');
  if (cl) {
    cl.innerHTML = Object.values(CLIENTES_CATALOGO)
      .map((c) => {
        const extra = c.correo ? ` · ${escapeHtml(c.correo)}` : (c.ciudad ? ` · ${escapeHtml(c.ciudad)}` : '');
        const inactivo = (c.activo === false || c.estado === 0) ? ' [DESACTIVADO]' : '';
        return `<option value="${c.id}">${escapeHtml(c.nombre)} · #${c.id}${extra}${inactivo}</option>`;
      })
      .join('');
  }
  const pl = $('productos-datalist');
  if (pl) {
    pl.innerHTML = Object.values(PRODUCTOS_CATALOGO)
      .map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)} · ${formatMoney(p.precio)}</option>`)
      .join('');
  }
}

// Botón de ejemplo: accesible con ?demo=1 o Ctrl + Shift + E
if (new URLSearchParams(window.location.search).has('demo') || new URLSearchParams(window.location.search).has('ejemplo')) {
  el.example.hidden = false;
}
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') {
    el.example.hidden = !el.example.hidden;
    if (!el.example.hidden) toast('Modo demo activado.', 'info');
  }
});

try { el.toasts.showPopover(); } catch {}

populateDatalists();
cargarClientes();
cargarProductos();
addLine();
renderSkeleton();
checkHealth();
loadOrders();
setInterval(checkHealth, HEALTH_INTERVAL_MS);
