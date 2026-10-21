"""Datos de Reportes en memoria (sin base de datos).

Todo se reconstruye desde las APIs de los otros grupos al arrancar y se mantiene
al día con los eventos de RabbitMQ. Cada cambio llama a `al_cambiar` para avisar
al dashboard en el mismo instante.
"""
import json
import os
import threading
from collections import defaultdict
from datetime import datetime

_lock = threading.RLock()
clientes: dict[int, dict] = {}
pedidos: dict[int, dict] = {}
productos: dict[int, dict] = {}          # catálogo que entrega la API de Productos
inventario: dict[int, dict] = {}         # existencias que entrega la API de Inventario
facturas: dict[int, dict] = {}           # facturas que anuncia Facturación (evento FacturaGenerada)
STOCK_BAJO = int(os.getenv("STOCK_BAJO", "10"))   # mismo criterio que Inventario: por debajo = stock bajo
_pagos_sin_pedido: dict[int, str] = {}   # pago que llegó antes que su pedido
_sin_stock_sin_pedido: set[int] = set()  # aviso de falta de stock que llegó antes que su pedido

# Respaldo en disco de los pedidos y pagos recibidos por RabbitMQ (no es una base de datos: es una copia de lo
# recibido, para no perderlo si la API se reinicia). Se apaga con RESPALDO=0 en el .env.
RESPALDO = os.getenv("RESPALDO", "1") != "0"
_RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos", "respaldo.json")


def _guardar_respaldo():
	if not RESPALDO:
		return
	try:
		os.makedirs(os.path.dirname(_RUTA), exist_ok=True)
		with open(_RUTA + ".tmp", "w", encoding="utf-8") as f:
			json.dump({"pedidos": list(pedidos.values()), "pagos_sin_pedido": _pagos_sin_pedido,
					   "sin_stock_sin_pedido": sorted(_sin_stock_sin_pedido),
					   "facturas": list(facturas.values())}, f, ensure_ascii=False)
		os.replace(_RUTA + ".tmp", _RUTA)
	except OSError:
		pass


def _cargar_respaldo():
	if not RESPALDO or not os.path.exists(_RUTA):
		return
	try:
		with open(_RUTA, encoding="utf-8") as f:
			d = json.load(f)
		for p in d.get("pedidos", []):
			pedidos[int(p["pedido_id"])] = p
		_pagos_sin_pedido.update({int(k): v for k, v in d.get("pagos_sin_pedido", {}).items()})
		_sin_stock_sin_pedido.update(int(x) for x in d.get("sin_stock_sin_pedido", []))
		for f in d.get("facturas", []):
			facturas[int(f["factura_id"])] = f
	except (OSError, ValueError, KeyError, TypeError):
		pass


_cargar_respaldo()
al_cambiar = lambda: None                # lo reemplaza main.py (avisa al navegador)

# Pedidos guarda su propio estado; Reportes lo traduce a estado de pago.
# PAGADO/ENVIADO/COMPLETADO implican pago aprobado. CANCELADO queda como CANCELADO: Pedidos cancela tanto por
# pago rechazado como por inventario insuficiente, y solo el evento de Pagos (PagoRechazado) confirma lo primero.
ESTADO_PAGO = {"PAGADO": "APROBADO", "ENVIADO": "APROBADO",
			   "COMPLETADO": "APROBADO", "CANCELADO": "CANCELADO"}


def _vendido(p: dict) -> bool:
	"""Una venta cuenta cuando el pago está aprobado y el pedido no se canceló por falta de stock."""
	return p["estado_pago"] == "APROBADO" and not p.get("sin_stock")


# ---------- escritura ----------
def nombre_completo(c: dict) -> str:
	return " ".join(p for p in (c.get("primer_nombre"), c.get("segundo_nombre"),
								c.get("primer_apellido"), c.get("segundo_apellido")) if p)


def guardar_cliente(c: dict) -> bool:
	"""Guarda un cliente tal como lo entrega el servicio de Clientes. True si algo cambió."""
	nuevo = dict(cliente_id=c["id"], nombre_completo=nombre_completo(c),
				 correo=c["correo"], estado=c.get("estado"))
	with _lock:
		cambio = clientes.get(c["id"]) != nuevo
		clientes[c["id"]] = nuevo
	if cambio:
		al_cambiar()
	return cambio


def reemplazar_clientes(lista: list) -> None:
	with _lock:
		nuevos = {c["id"]: dict(cliente_id=c["id"], nombre_completo=nombre_completo(c),
								correo=c["correo"], estado=c.get("estado")) for c in lista}
		cambio = nuevos != clientes
		clientes.clear()
		clientes.update(nuevos)
	if cambio:
		al_cambiar()


def reemplazar_productos(lista: list) -> None:
	"""lista: respuesta de GET /api/productos (id, nombre, precio, categoria...)."""
	with _lock:
		nuevos = {int(p["id"]): dict(producto_id=int(p["id"]), nombre=p.get("nombre"),
									 categoria=p.get("categoria"), precio=float(p.get("precio") or 0)) for p in lista}
		cambio = nuevos != productos
		productos.clear()
		productos.update(nuevos)
	if cambio:
		al_cambiar()


def reemplazar_inventario(lista: list) -> None:
	"""lista: respuesta de GET /api/inventario (producto_id, nombre, cantidad, actualizado)."""
	with _lock:
		nuevos = {int(p["producto_id"]): dict(producto_id=int(p["producto_id"]), nombre=p.get("nombre"),
											  cantidad=int(p["cantidad"]), actualizado=p.get("actualizado")) for p in lista}
		cambio = nuevos != inventario
		inventario.clear()
		inventario.update(nuevos)
	if cambio:
		al_cambiar()


def registrar_factura(d: dict) -> bool:
	"""Evento FacturaGenerada. Facturación avisa que puede llegar repetido: un facturaId ya registrado no cambia nada."""
	fid = int(d["facturaId"])
	nueva = dict(factura_id=fid, numero=d.get("numeroFactura"), pedido_id=int(d["pedidoId"]),
				 cliente_id=d.get("clienteId"), total=float(d.get("total") or 0), fecha=str(d.get("fecha") or ""))
	with _lock:
		cambio = facturas.get(fid) != nueva
		facturas[fid] = nueva
		if cambio:
			_guardar_respaldo()
	if cambio:
		al_cambiar()
	return cambio


def guardar_pedido(p: dict, estado_pedido: str | None = None) -> bool:
	"""p: pedidoId/clienteId/fecha/total/productos (formato del evento PedidoCreado).
	estado_pedido: el estado de Pedidos por REST; si el pago ya llegó por evento, no se pisa."""
	pid = p["pedidoId"]
	with _lock:
		previo = pedidos.get(pid)
		estado_pago = ESTADO_PAGO.get(str(estado_pedido or "").upper(), "PENDIENTE")
		pago_evento = False
		sin_stock = bool(previo and previo.get("sin_stock")) or pid in _sin_stock_sin_pedido
		_sin_stock_sin_pedido.discard(pid)
		if previo and previo.get("pago_evento"):
			estado_pago, pago_evento = previo["estado_pago"], True
		elif pid in _pagos_sin_pedido:
			estado_pago, pago_evento = _pagos_sin_pedido.pop(pid), True
		nuevo = dict(pedido_id=pid, cliente_id=p["clienteId"], fecha=str(p["fecha"]),
					 total=float(p.get("total") or 0), estado_pago=estado_pago, pago_evento=pago_evento, sin_stock=sin_stock,
					 productos=[dict(producto_id=x["productoId"], cantidad=x["cantidad"],
									 precio=float(x["precio"])) for x in p.get("productos", [])])
		cambio = previo != nuevo
		pedidos[pid] = nuevo
		if cambio:
			_guardar_respaldo()
	if cambio:
		al_cambiar()
	return cambio


def registrar_pago(pedido_id: int, aprobado: bool) -> None:
	estado = "APROBADO" if aprobado else "RECHAZADO"
	with _lock:
		p = pedidos.get(pedido_id)
		if p:
			cambio = p["estado_pago"] != estado
			p["estado_pago"], p["pago_evento"] = estado, True
		else:
			_pagos_sin_pedido[pedido_id] = estado
			cambio = False
		_guardar_respaldo()
	if cambio:
		al_cambiar()


def registrar_sin_stock(pedido_id: int) -> None:
	"""Evento InventarioInsuficiente: Pedidos cancela el pedido por falta de existencias."""
	with _lock:
		p = pedidos.get(pedido_id)
		if p:
			cambio = not p.get("sin_stock")
			p["sin_stock"] = True
		else:
			_sin_stock_sin_pedido.add(pedido_id)
			cambio = False
		_guardar_respaldo()
	if cambio:
		al_cambiar()


# ---------- lectura / reportes ----------
def _pedidos():
	with _lock:
		return [dict(p) for p in pedidos.values()]


def resumen() -> dict:
	ps = _pedidos()
	por_cliente = defaultdict(float)
	for p in ps:
		por_cliente[p["cliente_id"]] += p["total"]
	top = sorted(por_cliente.items(), key=lambda x: -x[1])[:5]
	return dict(
		total_pedidos=len(ps),
		clientes_con_compras=len(por_cliente),
		ventas_aprobadas=sum(p["total"] for p in ps if _vendido(p)),
		sin_stock=sum(1 for p in ps if p.get("sin_stock")),
		mejores_clientes=[dict(cliente_id=c, total_comprado=t) for c, t in top],
		total_clientes=len(clientes),
		facturas=len(facturas),
		total_facturado=sum(f["total"] for f in facturas.values()),
	)


def ventas_por_dia() -> list:
	dias = defaultdict(lambda: [0, 0.0])
	for p in _pedidos():
		d = dias[p["fecha"][:10]]
		d[0] += 1
		if _vendido(p):
			d[1] += p["total"]
	return [dict(dia=d, pedidos=v[0], ventas=v[1]) for d, v in sorted(dias.items())]


def pagos_por_estado() -> list:
	cuenta = defaultdict(int)
	for p in _pedidos():
		cuenta[p["estado_pago"]] += 1
	return [dict(estado_pago=e, cantidad=n) for e, n in cuenta.items()]


def top_productos() -> list:
	acc = defaultdict(lambda: [0, 0.0])
	for p in _pedidos():
		for x in p["productos"]:
			acc[x["producto_id"]][0] += x["cantidad"]
			acc[x["producto_id"]][1] += x["cantidad"] * x["precio"]
	orden = sorted(acc.items(), key=lambda x: -x[1][0])[:10]
	with _lock:
		cat = dict(productos)
	return [dict(producto_id=i, unidades=v[0], ingresos=v[1],
				 nombre=cat.get(i, {}).get("nombre"), categoria=cat.get(i, {}).get("categoria")) for i, v in orden]


def pedidos_recientes(n: int = 8) -> list:
	ps = sorted(_pedidos(), key=lambda p: p["fecha"], reverse=True)[:n]
	with _lock:
		nombres = {i: c["nombre_completo"] for i, c in clientes.items()}
		factura_de = {f["pedido_id"]: f["numero"] or ("#" + str(f["factura_id"])) for f in facturas.values()}
	return [dict(pedido_id=p["pedido_id"], cliente_id=p["cliente_id"], cliente=nombres.get(p["cliente_id"]),
				 fecha=p["fecha"], total=p["total"], estado_pago=p["estado_pago"], sin_stock=bool(p.get("sin_stock")), factura=factura_de.get(p["pedido_id"]),
				 unidades=sum(x["cantidad"] for x in p["productos"])) for p in ps]


def stock() -> dict:
	"""Existencias por producto, de menor a mayor, con su nivel (AGOTADO / BAJO / DISPONIBLE)."""
	with _lock:
		items = [dict(p) for p in inventario.values()]
		catalogo = {i: p.get("nombre") for i, p in productos.items()}
	for p in items:
		p["nombre"] = p["nombre"] or catalogo.get(p["producto_id"])
		p["nivel"] = "AGOTADO" if p["cantidad"] <= 0 else "BAJO" if p["cantidad"] < STOCK_BAJO else "DISPONIBLE"
	items.sort(key=lambda p: (p["cantidad"], p["producto_id"]))
	return dict(umbral=STOCK_BAJO, productos=items, resumen=dict(
		total=len(items), unidades=sum(p["cantidad"] for p in items),
		agotados=sum(p["nivel"] == "AGOTADO" for p in items),
		bajos=sum(p["nivel"] == "BAJO" for p in items),
		disponibles=sum(p["nivel"] == "DISPONIBLE" for p in items)))


def lista_clientes() -> list:
	with _lock:
		return sorted((dict(c) for c in clientes.values()), key=lambda c: c["nombre_completo"])


def reporte_cliente(cliente_id: int) -> dict | None:
	with _lock:
		cliente = dict(clientes[cliente_id]) if cliente_id in clientes else None
	if not cliente:
		return None
	ps = sorted((p for p in _pedidos() if p["cliente_id"] == cliente_id),
				key=lambda p: p["fecha"], reverse=True)
	cuenta = lambda e: sum(1 for p in ps if p["estado_pago"] == e)
	unidades = defaultdict(int)
	for p in ps:
		for x in p["productos"]:
			unidades[x["producto_id"]] += x["cantidad"]
	return dict(
		cliente=cliente,
		resumen=dict(
			total_pedidos=len(ps),
			total_comprado=sum(p["total"] for p in ps),
			total_pagado=sum(p["total"] for p in ps if _vendido(p)),
			ticket_promedio=(sum(p["total"] for p in ps) / len(ps)) if ps else 0,
			pagos_aprobados=cuenta("APROBADO"), pagos_rechazados=cuenta("RECHAZADO"),
			pagos_pendientes=cuenta("PENDIENTE"), pagos_cancelados=cuenta("CANCELADO"),
			sin_stock=sum(1 for p in ps if p.get("sin_stock")),
			ultimo_pedido=ps[0]["fecha"] if ps else None),
		top_productos=[dict(producto_id=i, unidades=u, nombre=productos.get(i, {}).get("nombre"))
					   for i, u in sorted(unidades.items(), key=lambda x: -x[1])[:5]],
		ultimos_pedidos=[dict({k: p[k] for k in ("pedido_id", "fecha", "total", "estado_pago")}, sin_stock=bool(p.get("sin_stock")))
						  for p in ps[:10]],
	)
