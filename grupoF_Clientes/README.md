# Clientes (FastAPI + MariaDB, sin ORM)

## Ejecutar
    pip install -r requirements.txt
    uvicorn main:app --reload

## Páginas
 
| Ruta               | Descripción                                             | Acceso            |
|--------------------|---------------------------------------------------------|-------------------|
| `/registro`        | Crear una cuenta                                        | Público           |
| `/login`           | Iniciar sesión                                          | Público           |
| `/perfil`          | Ver y editar los datos propios                          | Usuario con sesión|
| `/admin/clientes`  | Listar clientes y habilitarlos o deshabilitarlos        | Solo administradores |
 
Un cliente deshabilitado (`estado = 0`) no puede iniciar sesión, y si ya tenía una sesión abierta se cierra en su siguiente petición. Un administrador no puede deshabilitar su propia cuenta.
 
El botón "Administrar clientes" aparece en `/perfil` solo para los correos incluidos en `ADMIN_CORREOS`.

## API
    curl -X POST http://localhost:8000/cliente \
      -H "Content-Type: application/json" \
      -d '{"id": 1}'

# Consumo de la API

# API de Clientes

API para consultar la información de un cliente a partir de su `id`.

## Endpoint

| Método | Ruta        | Autenticación |
|--------|-------------|---------------|
| `POST` | `/cliente`  | Ninguna       |
| `POST` | `/clientes` | Ninguna       |

**La ruta /clientes devuelve una lista con la informacion de los usuarios de la misma manera que en un solo cliente**

## Petición

**Headers**

```
Content-Type: application/json
```

**Cuerpo (JSON)**

| Campo | Tipo    | Requerido | Descripción                  |
|-------|---------|-----------|------------------------------|
| `id`  | entero  | Sí        | Identificador del cliente    |

```json
{
  "id": 1
}
```

## Respuestas

### 200 OK: cliente encontrado

```json
{
  "id": 1,
  "primer_nombre": "Juan",
  "segundo_nombre": "Carlos",
  "primer_apellido": "Pérez",
  "segundo_apellido": null,
  "correo": "juan@example.com",
  "estado": 1
}
```

| Campo              | Tipo            | Descripción                          |
|--------------------|-----------------|--------------------------------------|
| `id`               | entero          | Identificador del cliente            |
| `primer_nombre`    | texto           | Primer nombre                        |
| `segundo_nombre`   | texto o `null`  | Segundo nombre (opcional)            |
| `primer_apellido`  | texto           | Primer apellido                      |
| `segundo_apellido` | texto o `null`  | Segundo apellido (opcional)          |
| `correo`           | texto           | Correo electrónico                   |
| `estado`           | entero o `null` | `1` activo, `0` desactivado          |

> La contraseña nunca se incluye en la respuesta.

### 404 Not Found: el cliente no existe

```json
{
  "detail": "Cliente no encontrado"
}
```

### 422 Unprocessable Entity: petición inválida

Ocurre cuando falta el campo `id` o no es un número entero.

```json
{
  "detail": [
    {
      "type": "int_parsing",
      "loc": ["body", "id"],
      "msg": "Input should be a valid integer, unable to parse string as an integer",
      "input": "abc"
    }
  ]
}
```

## Ejemplos de uso

### cURL

```bash
curl -X POST http://localhost:8000/cliente \
  -H "Content-Type: application/json" \
  -d '{"id": 1}'
```

### Python (requests)

```python
import requests

respuesta = requests.post("http://localhost:8000/cliente", json={"id": 1})

if respuesta.status_code == 200:
    cliente = respuesta.json()
    print(cliente["primer_nombre"], cliente["correo"])
elif respuesta.status_code == 404:
    print("El cliente no existe")
else:
    print("Error:", respuesta.status_code, respuesta.text)
```

### JavaScript (fetch)

```javascript
const respuesta = await fetch("http://localhost:8000/cliente", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: 1 }),
});

if (respuesta.ok) {
  const cliente = await respuesta.json();
  console.log(cliente);
} else if (respuesta.status === 404) {
  console.log("El cliente no existe");
}
```

## Documentación interactiva

FastAPI genera documentación automática donde puedes probar el endpoint desde el navegador:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`