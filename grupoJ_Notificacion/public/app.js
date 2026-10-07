const $ = selector => document.querySelector(selector);
let rows = [], offset = 0, busy = false, marking = false, loadedClient = '', pendingRefresh = false;
const pageSize = 100;
const icons = { PedidoCreado: '▣', PagoAprobado: '✓', PagoRechazado: '×', FacturaGenerada: '▤', InventarioInsuficiente: '!' };
const dateFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });
async function request(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo completar la solicitud. Intenta nuevamente.');
  }
  return response.json();
}
function notice(message = '') { $('#notice').textContent = message; }
function render() {
  $('#total').textContent = rows.length;
  $('#unread').textContent = rows.filter(row => !row.leida).length;
  $('#read').textContent = rows.filter(row => row.leida).length;
  const type = $('#event').value, state = $('#state').value;
  const visible = rows.filter(row => (!type || row.tipoEvento === type) && (!state || row.leida === (state === 'read')));
  $('#list').replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const title = document.createElement('strong'); title.textContent = 'No hay notificaciones para mostrar';
    empty.append(title, 'Prueba otros filtros o actualiza cuando lleguen nuevos eventos.'); $('#list').append(empty);
  }
  for (const row of visible) {
    const card = $('#notification-template').content.firstElementChild.cloneNode(true);
    card.classList.toggle('unread', !row.leida);
    const icon = card.querySelector('.event-icon'); icon.classList.add(row.tipoEvento); icon.textContent = icons[row.tipoEvento] || '•';
    card.querySelector('h3').textContent = row.titulo;
    const badge = card.querySelector('.badge'); badge.textContent = row.leida ? 'Leída' : 'Sin leer'; badge.classList.toggle('read', row.leida);
    card.querySelector('.message').textContent = row.mensaje;
    card.querySelector('.metadata').textContent = `Pedido #${row.pedidoId} · Cliente #${row.clienteId} · ${row.tipoEvento}`;
    const time = card.querySelector('time'); time.dateTime = row.fecha; time.textContent = dateFormat.format(new Date(row.fecha));
    const button = card.querySelector('.mark-read'); button.hidden = row.leida;
    button.addEventListener('click', async () => {
      if (busy || marking) return;
      marking = true;
      $('#list').querySelectorAll('.mark-read').forEach(node => { node.disabled = true; });
      button.disabled = true; notice();
      try {
        const updated = await request(`/api/notificaciones/${row.id}/leida`, { method: 'PATCH', keepalive: true });
        rows = rows.map(item => item.id === updated.id ? updated : item); render();
      } catch (error) { notice(error.message); button.disabled = false; }
      finally {
        marking = false;
        render();
        if (pendingRefresh) { pendingRefresh = false; void load(); }
      }
    });
    $('#list').append(card);
  }
  $('#page-info').textContent = `Página ${offset / pageSize + 1} · ${visible.length} visibles de ${rows.length} cargadas`;
  $('#previous').disabled = busy || offset === 0;
  $('#next').disabled = busy || rows.length < pageSize;
}
async function health() {
  const node = $('#connection');
  try {
    const response = await fetch('/health/ready');
    node.textContent = response.ok ? '● RabbitMQ conectado' : '● RabbitMQ desconectado';
    node.className = `connection ${response.ok ? 'ok' : 'warn'}`;
  } catch { node.textContent = '● Servicio no disponible'; node.className = 'connection warn'; }
}
async function load(targetOffset = offset) {
  if (marking) { pendingRefresh = true; return; }
  if (busy) return;
  const client = $('#client').value.trim();
  if (client && (!/^\d+$/.test(client) || !Number.isSafeInteger(Number(client)) || Number(client) <= 0)) { notice('Escribe un identificador de cliente entero positivo.'); return; }
  if (client !== loadedClient) targetOffset = 0;
  busy = true; notice(); $('#refresh').disabled = true; $('#filters button').disabled = true;
  $('#previous').disabled = true; $('#next').disabled = true; $('#list').setAttribute('aria-busy', 'true');
  try {
    const path = client ? `/api/notificaciones/cliente/${client}` : '/api/notificaciones';
    rows = await request(`${path}?limit=${pageSize}&offset=${targetOffset}`);
    offset = targetOffset;
    loadedClient = client;
    $('#updated').textContent = `Actualizado ${new Intl.DateTimeFormat('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date())}`;
  } catch (error) { notice(`${error.message} Se conservan los resultados de la última consulta correcta.`); }
  finally { busy = false; $('#refresh').disabled = false; $('#filters button').disabled = false; $('#list').setAttribute('aria-busy', 'false'); render(); void health(); }
}
$('#filters').addEventListener('submit', event => { event.preventDefault(); void load(0); });
$('#refresh').addEventListener('click', () => void load());
$('#event').addEventListener('change', render);
$('#state').addEventListener('change', render);
$('#previous').addEventListener('click', () => void load(Math.max(0, offset - pageSize)));
$('#next').addEventListener('click', () => void load(offset + pageSize));
void load();
