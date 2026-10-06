"""Genera la factura en PDF (fpdf2) a partir de una fila de la tabla Factura."""
from fpdf import FPDF


def _t(texto) -> str:
    # Las fuentes base de PDF solo admiten latin-1: lo demás se reemplaza por '?'
    return str(texto).encode("latin-1", "replace").decode("latin-1")


def _dinero(valor) -> str:
    return f"${float(valor):,.0f}"


def generar_pdf(f: dict) -> bytes:
    pdf = FPDF()
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 12, "FACTURA", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, _t(f["numero"]), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", size=11)
    lineas = [f"Fecha: {f['fecha'].replace('T', ' ')}", f"Pedido: {f['pedido_id']}"]
    if f.get("pago_id") is not None:
        lineas.append(f"Pago: {f['pago_id']}")
    if f.get("cliente_nombre"):
        lineas.append(f"Cliente: {f['cliente_nombre']}")
        if f.get("cliente_correo"):
            lineas.append(f"Correo: {f['cliente_correo']}")
    else:
        lineas.append(f"Cliente: #{f['cliente_id']}" if f.get("cliente_id") is not None else "Cliente: -")
    for linea in lineas:
        pdf.cell(0, 7, _t(linea), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    if f["productos"]:
        pdf.set_font("Helvetica", "B", 11)
        for ancho, titulo in ((60, "Producto"), (30, "Cantidad"), (50, "Precio"), (50, "Subtotal")):
            pdf.cell(ancho, 8, titulo, border=1)
        pdf.ln()
        pdf.set_font("Helvetica", size=11)
        for p in f["productos"]:
            pdf.cell(60, 8, _t(f"Producto #{p['productoId']}"), border=1)
            pdf.cell(30, 8, str(p["cantidad"]), border=1)
            pdf.cell(50, 8, _dinero(p["precio"]), border=1)
            pdf.cell(50, 8, _dinero(p["cantidad"] * p["precio"]), border=1)
            pdf.ln()
        pdf.ln(4)

    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, f"TOTAL: {_dinero(f['total'])}", new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())
