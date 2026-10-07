"""Datos de Reportes en memoria (sin base de datos).

Todo se reconstruye desde las APIs de los otros grupos al arrancar y se mantiene
al día con los eventos de RabbitMQ. Cada cambio llama a `al_cambiar` para avisar
al dashboard en el mismo instante.
"""
import threading
from collections import defaultdict
from datetime import datetime

_lock = threading.RLock()
clientes: dict[int, dict] = {}
pedidos: dict[int, dict] = {}
_pagos_sin_pedido: dict[int, str] = {}   # pago que llegó antes que su pedido

al_cambiar = lambda: None                # lo reemplaza main.py (avisa al navegador)

# Pedidos guarda su propio estado; Reportes lo traduce a estado de pago.
# PAGADO/ENVIADO/COMPLETADO implican pago aprobado; CANCELADO se cuenta como rechazado.
ESTADO_PAGO = {"PAGADO": "APROBADO", "ENVIADO": "APROBADO",
			   "COMPLETADO": "APROBADO", "CANCELADO": "RECHAZADO"}


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


def guardar_pedido(p: dict, estado_pedido: str | None = None) -> bool:
	"""p: pedidoId/clienteId/fecha/total/productos (formato del evento PedidoCreado).
	estado_pedido: el estado de Pedidos por REST; si el pago ya llegó por evento, no se pisa."""
	pid = p["pedidoId"]
	with _lock:
		previo = pedidos.get(pid)
		estado_pago = ESTADO_PAGO.get(str(estado_pedido or "").upper(), "PENDIENTE")
		pago_evento = False
		if previo and previo.get("pago_evento"):
			estado_pago, pago_evento = previo["estado_pago"], True
		elif pid in _pagos_sin_pedido:
			estado_pago, pago_evento = _pagos_sin_pedido.pop(pid), True
		nuevo = dict(pedido_id=pid, cliente_id=p["clienteId"], fecha=str(p["fecha"]),
					 total=float(p.get("total") or 0), estado_pago=estado_pago, pago_evento=pago_evento,
					 productos=[dict(producto_id=x["productoId"], cantidad=x["cantidad"],
									 precio=float(x["precio"])) for x in p.get("productos", [])])
		cambio = previo != nuevo
		pedidos[pid] = nuevo
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
		ventas_aprobadas=sum(p["total"] for p in ps if p["estado_pago"] == "APROBADO"),
		mejores_clientes=[dict(cliente_id=c, total_comprado=t) for c, t in top],
		total_clientes=len(clientes),
	)


def ventas_por_dia() -> list:
	dias = defaultdict(lambda: [0, 0.0])
	for p in _pedidos():
		d = dias[p["fecha"][:10]]
		d[0] += 1
		if p["estado_pago"] == "APROBADO":
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
	return [dict(producto_id=i, unidades=v[0], ingresos=v[1]) for i, v in orden]


def pedidos_recientes(n: int = 8) -> list:
	ps = sorted(_pedidos(), key=lambda p: p["fecha"], reverse=True)[:n]
	with _lock:
		nombres = {i: c["nombre_completo"] for i, c in clientes.items()}
	return [dict(pedido_id=p["pedido_id"], cliente_id=p["cliente_id"], cliente=nombres.get(p["cliente_id"]),
				 fecha=p["fecha"], total=p["total"], estado_pago=p["estado_pago"],
				 unidades=sum(x["cantidad"] for x in p["productos"])) for p in ps]


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
			total_pagado=sum(p["total"] for p in ps if p["estado_pago"] == "APROBADO"),
			ticket_promedio=(sum(p["total"] for p in ps) / len(ps)) if ps else 0,
			pagos_aprobados=cuenta("APROBADO"), pagos_rechazados=cuenta("RECHAZADO"),
			pagos_pendientes=cuenta("PENDIENTE"),
			ultimo_pedido=ps[0]["fecha"] if ps else None),
		top_productos=[dict(producto_id=i, unidades=u)
					   for i, u in sorted(unidades.items(), key=lambda x: -x[1])[:5]],
		ultimos_pedidos=[{k: p[k] for k in ("pedido_id", "fecha", "total", "estado_pago")} for p in ps[:10]],
	)
