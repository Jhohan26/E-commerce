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


# Consulta de clientes vía RabbitMQ (CloudAMQP)

Además de la API HTTP, los datos de clientes se pueden consultar mediante **mensajería con RabbitMQ**, alojado en CloudAMQP. Esta guía explica cómo conectarse y pedir datos.

## ¿Cómo funciona?

Se usa el patrón **RPC (petición y respuesta) sobre colas**:

```
 Tu aplicación                  CloudAMQP                    Worker
			│                       (RabbitMQ)                   (worker.py)
			│  1. publica petición      │                             │
			│ ────────────────────────► │  cola "cliente.consultar"   │
			│    reply_to + corr. id    │ ──────────────────────────► │
			│                           │                             │ 2. consulta MariaDB
			│                           │  3. publica respuesta       │
			│  4. recibe respuesta      │ ◄────────────────────────── │
			│ ◄──────────────────────── │   cola indicada en reply_to │
```

1. Tu aplicación crea una **cola temporal exclusiva** donde recibirá la respuesta.
2. Publica un mensaje en la cola de la operación, indicando dos propiedades:
	 - `reply_to`: el nombre de tu cola temporal.
	 - `correlation_id`: un identificador único (por ejemplo, un UUID).
3. El worker procesa la petición y publica la respuesta en `reply_to`, copiando el mismo `correlation_id`.
4. Tu aplicación ignora cualquier mensaje cuyo `correlation_id` no coincida con el suyo.

## Requisitos para conectarse

Necesitas la **AMQP URL** de la instancia de CloudAMQP, con este formato:

```
amqps://USUARIO:PASSWORD@HOST.rmq.cloudamqp.com/VHOST
```

- Usa `amqps://` (conexión cifrada con TLS, puerto 5671).
- Esa URL contiene credenciales: **trátala como un secreto**. Guárdala en una variable de entorno y no la subas a repositorios.
- Si vas a dar acceso a otro sistema, lo recomendable es crear un usuario aparte con permisos limitados desde el panel de administración de RabbitMQ de la instancia, en lugar de compartir las credenciales principales.

> **Importante:** el worker (`python worker.py`) debe estar en ejecución. Si está apagado, las peticiones no se atienden.

## Colas disponibles

| Cola                | Descripción                          | Cuerpo de la petición | Respuesta (`data`)        |
|---------------------|--------------------------------------|-----------------------|---------------------------|
| `cliente.consultar` | Devuelve un cliente por su `id`      | `{"id": 1}`           | Un objeto cliente         |
| `clientes.listar`   | Devuelve todos los clientes          | Vacío (sin cuerpo)    | Lista de objetos cliente  |

Ambas colas son **durables**.

## Formato de los mensajes

### Petición

- **Exchange:** el exchange por defecto (`""`).
- **Routing key:** el nombre de la cola (`cliente.consultar` o `clientes.listar`).
- **Propiedades obligatorias:** `reply_to` y `correlation_id`.
- **Propiedad recomendada:** `expiration` (en milisegundos), para que la petición se descarte si nadie la atiende a tiempo.
- **Cuerpo:** JSON en UTF-8 (solo para `cliente.consultar`).

```json
{ "id": 1 }
```

### Respuesta

Siempre es un JSON con un campo `status` que imita los códigos HTTP.

**Éxito (`cliente.consultar`):**

```json
{
	"status": 200,
	"data": {
		"id": 1,
		"primer_nombre": "Juan",
		"segundo_nombre": "Carlos",
		"primer_apellido": "Pérez",
		"segundo_apellido": null,
		"correo": "juan@example.com",
		"estado": 1
	}
}
```

**Éxito (`clientes.listar`):**

```json
{
	"status": 200,
	"data": [
		{ "id": 1, "primer_nombre": "Juan", "...": "..." },
		{ "id": 2, "primer_nombre": "Ana",  "...": "..." }
	]
}
```

**Error:**

```json
{ "status": 404, "error": "Cliente no encontrado" }
```

| `status` | Significado                                              |
|----------|----------------------------------------------------------|
| `200`    | Operación exitosa                                        |
| `400`    | Petición inválida (el cuerpo no es `{"id": <número>}`)   |
| `404`    | El cliente no existe                                     |
| `500`    | Error interno del worker                                 |

### Campos de un cliente

| Campo              | Tipo            | Descripción                    |
|--------------------|-----------------|--------------------------------|
| `id`               | entero          | Identificador del cliente      |
| `primer_nombre`    | texto           | Primer nombre                  |
| `segundo_nombre`   | texto o `null`  | Segundo nombre                 |
| `primer_apellido`  | texto           | Primer apellido                |
| `segundo_apellido` | texto o `null`  | Segundo apellido               |
| `correo`           | texto           | Correo electrónico             |
| `estado`           | entero o `null` | `1` activo, `0` deshabilitado  |

La contraseña nunca se incluye.

## Ejemplos

### Python (pika)

Instalación: `pip install pika`

```python
import json
import os
import uuid

import pika

URL = os.environ["CLOUDAMQP_URL"]


def llamar(cola, payload=None, timeout=10):
		connection = pika.BlockingConnection(pika.URLParameters(URL))
		try:
				channel = connection.channel()
				cola_respuesta = channel.queue_declare(queue="", exclusive=True).method.queue
				corr_id = str(uuid.uuid4())
				resultado = {}

				def on_response(ch, method, props, body):
						if props.correlation_id == corr_id:
								resultado["data"] = json.loads(body)

				channel.basic_consume(queue=cola_respuesta, on_message_callback=on_response, auto_ack=True)

				channel.basic_publish(
						exchange="",
						routing_key=cola,
						properties=pika.BasicProperties(
								reply_to=cola_respuesta,
								correlation_id=corr_id,
								expiration=str(timeout * 1000),
						),
						body=json.dumps(payload).encode() if payload is not None else b"",
				)

				for _ in range(timeout):
						connection.process_data_events(time_limit=1)
						if "data" in resultado:
								return resultado["data"]
				raise TimeoutError("El worker no respondió a tiempo")
		finally:
				connection.close()


# Un cliente
print(llamar("cliente.consultar", {"id": 1}))

# Todos los clientes
print(llamar("clientes.listar"))
```

El proyecto incluye `cliente_rpc.py`, con la clase `ClienteRPC` que reutiliza una misma conexión para varias llamadas:

```bash
python cliente_rpc.py 1     # un cliente
python cliente_rpc.py       # todos
```

### Node.js (amqplib)

Instalación: `npm install amqplib`

```javascript
const amqp = require("amqplib");
const { randomUUID } = require("crypto");

const URL = process.env.CLOUDAMQP_URL;

async function llamar(cola, payload, timeout = 10000) {
	const conn = await amqp.connect(URL);
	let timer;
	try {
		const ch = await conn.createChannel();
		const { queue } = await ch.assertQueue("", { exclusive: true });
		const corrId = randomUUID();

		let resolver, rechazar;
		const respuesta = new Promise((res, rej) => {
			resolver = res;
			rechazar = rej;
		});

		await ch.consume(
			queue,
			(msg) => {
				if (msg.properties.correlationId === corrId) {
					resolver(JSON.parse(msg.content.toString()));
				}
			},
			{ noAck: true }
		);

		timer = setTimeout(
			() => rechazar(new Error("El worker no respondió a tiempo")),
			timeout
		);

		ch.sendToQueue(
			cola,
			Buffer.from(payload ? JSON.stringify(payload) : ""),
			{ correlationId: corrId, replyTo: queue, expiration: String(timeout) }
		);

		return await respuesta;
	} finally {
		clearTimeout(timer);
		await conn.close();
	}
}

(async () => {
	console.log(await llamar("cliente.consultar", { id: 1 }));
	console.log(await llamar("clientes.listar"));
})();
```

### Otros lenguajes

Cualquier librería AMQP 0-9-1 sirve (Java, C#, Go, PHP, Ruby, etc.). Los pasos son siempre los mismos: crear cola exclusiva, publicar con `reply_to` y `correlation_id`, esperar la respuesta con el mismo `correlation_id`.

## Buenas prácticas

- **Siempre usa un timeout.** Si el worker no responde, tu aplicación no debe quedarse esperando indefinidamente.
- **Usa `expiration`** en la petición para que no se procesen peticiones antiguas cuando el worker vuelva a estar en línea.
- **No declares las colas de operación** (`cliente.consultar`, `clientes.listar`). Ya las crea el worker. Si decides declararlas, debe ser con `durable=True`, de lo contrario RabbitMQ rechaza la operación.
- **Valida el `status`** de la respuesta antes de usar `data`.
- **Reutiliza la conexión** si haces muchas consultas seguidas (abrir una conexión TLS en cada llamada es costoso).
- `clientes.listar` devuelve **todos** los registros en un solo mensaje. Si la tabla crece mucho, conviene paginar.

## Solución de problemas

| Síntoma                                           | Causa probable                                                                                     |
|---------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `ACCESS_REFUSED` al conectar                      | Usuario o contraseña incorrectos, o el usuario no tiene permisos sobre el vhost                    |
| `PRECONDITION_FAILED` al declarar una cola        | La cola ya existe con otros parámetros. Declárala con `durable=True` o no la declares              |
| `TimeoutError` / no llega respuesta               | El worker está apagado, no llega a MariaDB, o el `reply_to` / `correlation_id` no se enviaron bien |
| Respuesta con `"status": 400`                     | El cuerpo no es un JSON válido con un `id` numérico                                                |
| Respuesta con `"status": 500`                     | Error en el worker (revisa sus logs, por ejemplo problemas de conexión a la base de datos)         |
| Se corta la conexión tras un rato                 | Configura un `heartbeat` (por ejemplo 30 s) y reconecta si se pierde la conexión                   |


---
 
## 1. Arquitectura
 
```
Cliente ──(petición + reply_to + correlation_id)──▶ Cola del servicio ──▶ Worker ──▶ MySQL
   ▲                                                                         │
   └────────────(respuesta JSON)── Cola temporal del cliente ◀───────────────┘
```
 
### Colas disponibles
 
| Cola                | Requiere token | Descripción                        |
|---------------------|:--------------:|------------------------------------|
| `auth.login`        | No             | Valida credenciales y devuelve JWT |
| `cliente.consultar` | Sí             | Devuelve un cliente por `id`       |
| `clientes.listar`   | Sí             | Devuelve todos los clientes        |
 
---
 
## 2. Flujo de autenticación
 
1. Enviar usuario y contraseña a `auth.login`.
2. Recibir un token JWT (válido por `JWT_EXPIRA_MINUTOS`, 30 por defecto).
3. Enviar ese token en cada petición a las demás colas.
4. Si el token expira (respuesta `401`), repetir el login.
### 2.1 Login
 
**Cola:** `auth.login`
 
**Petición (cuerpo):**
 
```json
{"usuario": "demo", "password": "demo123"}
```
 
**Respuesta exitosa:**
 
```json
{
  "status": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "tipo": "Bearer",
    "expira_en_segundos": 1800
  }
}
```
 
### 2.2 Enviar el token
 
Hay dos formas. El worker busca primero en el header.
 
**Opción A (recomendada): header AMQP**
 
```
Authorization: Bearer <token>
```
 
**Opción B: campo `token` en el cuerpo JSON**
 
```json
{"id": 1, "token": "eyJhbGciOiJIUzI1NiIs..."}
```
 
---
 
## 3. Peticiones
 
### 3.1 Consultar un cliente
 
**Cola:** `cliente.consultar`
**Cuerpo:** `{"id": 1}`
 
```json
{"status": 200, "data": { "...campos de CAMPOS_PUBLICOS..." }}
```
 
### 3.2 Listar clientes
 
**Cola:** `clientes.listar`
**Cuerpo:** vacío
 
```json
{"status": 200, "data": [ { "...": "..." }, { "...": "..." } ]}
```
 
---
 
## 4. Códigos de respuesta
 
Todas las respuestas tienen el formato `{"status": <código>, "data": ...}` o `{"status": <código>, "error": "..."}`.
 
| Status | Significado                                                                      |
|--------|----------------------------------------------------------------------------------|
| 200    | OK                                                                               |
| 400    | Cuerpo mal formado (JSON inválido o faltan campos)                               |
| 401    | Credenciales inválidas, token ausente, inválido o expirado                       |
| 404    | Cliente no encontrado                                                            |
| 500    | Error interno del worker                                                         |
 
---
 
## 5. Usar el cliente de prueba (`cliente_rpc.py`)
 
```bash
# Listar todos los clientes
python cliente_rpc.py -u demo -p demo123
 
# Consultar el cliente con id 1
python cliente_rpc.py 1 -u demo -p demo123
```
 
Si defines `API_USUARIO` y `API_PASSWORD` en el `.env`, se puede omitir `-u` y `-p`.
 
### Uso desde código
 
```python
from cliente_rpc import ClienteRPC
 
rpc = ClienteRPC("demo", "demo123")
try:
    token = rpc.login()                           # opcional: se hace solo en la primera llamada
    print(rpc.llamar("clientes.listar"))
    print(rpc.llamar("cliente.consultar", {"id": 1}))
finally:
    rpc.cerrar()
```
 
El cliente guarda el token y, si el worker responde `401`, vuelve a hacer login y reintenta una vez.
 
---
 
## 6. Conectarse desde otro cliente (cualquier lenguaje)
 
Cualquier cliente AMQP 0-9-1 sirve. Los pasos son:
 
1. Conectarse a `CLOUDAMQP_URL`.
2. Declarar una cola temporal exclusiva y consumir de ella (será el `reply_to`).
3. Publicar en la cola del servicio con estas propiedades:
   - `reply_to`: nombre de la cola temporal.
   - `correlation_id`: un identificador único (por ejemplo, un UUID).
   - `headers`: `{"Authorization": "Bearer <token>"}` (salvo en `auth.login`).
4. Leer la respuesta de la cola temporal y comprobar que su `correlation_id` coincide con el enviado.
---