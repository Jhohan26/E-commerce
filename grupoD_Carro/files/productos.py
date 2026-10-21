"""Catálogo de productos.

Por ahora son datos de ejemplo. Cuando el microservicio de productos esté
disponible en CloudAMQP, solo hay que reemplazar el cuerpo de
`listar_productos()` por una llamada RPC (ver rabbit.llamar_rpc).
"""

PRODUCTOS_EJEMPLO = [
    {"id": 1, "nombre": "Portátil 14\" Ryzen 5", "precio": 2500000},
    {"id": 2, "nombre": "Mouse inalámbrico", "precio": 65000},
    {"id": 3, "nombre": "Teclado mecánico", "precio": 220000},
    {"id": 4, "nombre": "Monitor 24\" Full HD", "precio": 680000},
    {"id": 5, "nombre": "Audífonos Bluetooth", "precio": 150000},
    {"id": 6, "nombre": "Disco SSD 1 TB", "precio": 310000},
]


def listar_productos() -> list[dict]:
    return PRODUCTOS_EJEMPLO


def obtener_producto(producto_id: int) -> dict | None:
    return next((p for p in listar_productos() if p["id"] == producto_id), None)
