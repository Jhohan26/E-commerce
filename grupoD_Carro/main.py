from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

import productos as catalogo
import rabbit

app = FastAPI(title="Carrito de compras")
templates = Jinja2Templates(directory="templates")

# Carritos en memoria: {cliente_id: {producto_id: cantidad}}
# (se pierden al reiniciar el servidor; suficiente para esta versión)
carritos: dict[int, dict[int, int]] = {}


def cop(valor: int) -> str:
    return "$" + f"{valor:,}".replace(",", ".")


templates.env.filters["cop"] = cop


def lineas_carrito(cliente_id: int) -> tuple[list[dict], int]:
    lineas, total = [], 0
    for pid, cant in carritos.get(cliente_id, {}).items():
        p = catalogo.obtener_producto(pid)
        if p:
            subtotal = p["precio"] * cant
            total += subtotal
            lineas.append({**p, "cantidad": cant, "subtotal": subtotal})
    return lineas, total


def cargar_cliente(cliente_id: int):
    """Devuelve (cliente, error)."""
    try:
        cliente = rabbit.consultar_cliente(cliente_id)
    except Exception as e:  # conexión, timeout, error del worker...
        return None, f"No se pudo consultar el cliente: {e}"
    if cliente is None:
        return None, f"No existe un cliente con id {cliente_id}."
    return cliente, None


def pagina_tienda(request: Request, cliente_id: int, mensaje: str | None = None):
    cliente, error = cargar_cliente(cliente_id)
    if error:
        return templates.TemplateResponse(
            request, "inicio.html", {"error": error, "cliente_id": cliente_id}, status_code=404
        )
    lineas, total = lineas_carrito(cliente_id)
    return templates.TemplateResponse(
        request,
        "tienda.html",
        {
            "cliente": cliente,
            "productos": catalogo.listar_productos(),
            "lineas": lineas,
            "total": total,
            "mensaje": mensaje,
        },
    )


@app.get("/", response_class=HTMLResponse)
def inicio(request: Request, cliente_id: int | None = None):
    if cliente_id is not None:
        return RedirectResponse(f"/cliente/{cliente_id}", status_code=303)
    return templates.TemplateResponse(request, "inicio.html", {"error": None, "cliente_id": ""})


@app.get("/cliente/{cliente_id}", response_class=HTMLResponse)
def tienda(request: Request, cliente_id: int):
    return pagina_tienda(request, cliente_id)


@app.post("/cliente/{cliente_id}/agregar")
def agregar(cliente_id: int, producto_id: int = Form(...), cantidad: int = Form(1)):
    if catalogo.obtener_producto(producto_id) and cantidad > 0:
        carrito = carritos.setdefault(cliente_id, {})
        carrito[producto_id] = carrito.get(producto_id, 0) + cantidad
    return RedirectResponse(f"/cliente/{cliente_id}", status_code=303)


@app.post("/cliente/{cliente_id}/quitar")
def quitar(cliente_id: int, producto_id: int = Form(...)):
    carritos.get(cliente_id, {}).pop(producto_id, None)
    return RedirectResponse(f"/cliente/{cliente_id}", status_code=303)


@app.post("/cliente/{cliente_id}/vaciar")
def vaciar(cliente_id: int):
    carritos.pop(cliente_id, None)
    return RedirectResponse(f"/cliente/{cliente_id}", status_code=303)


@app.post("/cliente/{cliente_id}/pedido", response_class=HTMLResponse)
def hacer_pedido(request: Request, cliente_id: int):
    cliente, error = cargar_cliente(cliente_id)
    if error:
        return pagina_tienda(request, cliente_id)
    if cliente.get("estado") == 0:
        return pagina_tienda(request, cliente_id, "Este cliente está deshabilitado y no puede comprar.")

    lineas, total = lineas_carrito(cliente_id)
    if not lineas:
        return pagina_tienda(request, cliente_id, "El carrito está vacío.")

    items = [{"productoId": l["id"], "cantidad": l["cantidad"], "precio": l["precio"]} for l in lineas]
    try:
        evento = rabbit.publicar_pedido(cliente_id, items)
    except Exception as e:
        return pagina_tienda(request, cliente_id, f"No se pudo enviar el pedido: {e}")

    carritos.pop(cliente_id, None)
    return templates.TemplateResponse(
        request, "confirmacion.html", {"cliente": cliente, "evento": evento, "lineas": lineas}
    )
