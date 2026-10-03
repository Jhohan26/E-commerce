# Microservicio de Notificaciones Grupo J

Recibe eventos del comercio electrónico por RabbitMQ, genera mensajes para el cliente, los guarda en SQLite y permite consultarlos por HTTP. Implementa únicamente la responsabilidad del Grupo J. El script de publicación es una herramienta de prueba, no un microservicio de Pedidos o Pagos.

## Frontend

Abrir la raíz del servicio, **http://localhost:3010/** en este computador. `/api/notificaciones` sigue siendo el endpoint JSON para integrar otros sistemas; la raíz muestra una interfaz web.

La bandeja permite filtrar por cliente, evento y estado de lectura, consultar páginas de 100 registros, actualizar y marcar cada notificación como leída. Los filtros de evento/estado y los contadores corresponden a la página cargada. Muestra fechas en `America/Bogota` y el estado real de conexión del consumidor. Un cliente sin resultados muestra un estado vacío, y los errores de consulta se presentan en pantalla.

El frontend está en `public/index.html`, `public/styles.css` y `public/app.js`; Express lo sirve en el mismo origen que la API. No requiere iniciar otra aplicación ni instalar dependencias adicionales. No publica eventos ni sustituye el panel de RabbitMQ.

La interfaz no descarga recursos externos y funciona con las fuentes disponibles en el computador. Sus pruebas funcionales simulan el DOM con [jsdom](https://github.com/jsdom/jsdom) y usan solicitudes HTTP reales para cargar, filtrar, paginar y persistir el marcado de lectura. No sustituyen una inspección visual en un navegador real.

En RabbitMQ, el exchange `grupo-j.notificaciones.errores.exchange` con binding `error` es la infraestructura de mensajes rechazados. Para eventos de negocio usar `comercio.eventos` y la cola `grupo-j.notificaciones`.

## Comprensión del enunciado

Semana8 propone nueve microservicios que colaboran mediante REST/HTTP y RabbitMQ con mensajes JSON. Para Grupo J se requiere informar al usuario sobre pedidos, pagos, facturas e inventario. Esta entrega añade almacenamiento persistente y API según la solicitud del usuario. Los dos flujos sincrónicos y la compra completa son objetivos del ecosistema; no corresponde construir los otros ocho servicios en este repositorio.

## Propuesta recomendada

JavaScript sobre Node.js 24, Express 5 para HTTP, `amqplib` para AMQP y SQLite mediante `node:sqlite`. Son apropiados para una demostración académica portátil: no se requiere compilación ni servidor de base de datos. SQLite guarda un archivo en un volumen Docker; por ser embebida, no necesita un contenedor adicional. Las consultas usan parámetros y el guardado es atómico. Las versiones resueltas están en `package-lock.json` y Docker utiliza `npm ci`.

## Arquitectura y estructura

```text
Productor externo → exchange comercio.eventos → grupo-j.notificaciones
                                                 ↓ consumidor
                                          validar JSON y evento
                                                 ↓
                                          generar texto
                                                 ↓
                                           guardar SQLite → ACK
                                                 ↓
                                           API Express → usuario

Mensaje inválido → NACK sin requeue → grupo-j.notificaciones.errores
Fallo de almacenamiento/conexión → sin ACK → reconexión → reentrega
```

```text
src/
  config/         Variables, logs y topología RabbitMQ
  models/         Tipos de eventos y validación
  repositories/   Persistencia SQLite
  services/       Plantillas y procesamiento con deduplicación
  consumers/      Entregas, ACK, NACK y reconexión
  controllers/    Validación de solicitudes HTTP
  routes/         Endpoints
  app.js          Aplicación HTTP independiente para pruebas
  index.js        Inicio y cierre del proceso
examples/         JSON de prueba
scripts/          Publicador AMQP de demostración
tests/            Pruebas locales e integración real
database/         Esquema SQL de referencia para MySQL
configuraciones.txt Tecnologías, puertos y variables utilizadas
```

## Contratos y supuestos sugeridos

`PedidoCreado` conserva exactamente los nombres y el ejemplo de Semana8:

```json
{
  "evento": "PedidoCreado",
  "pedidoId": 1001,
  "clienteId": 25,
  "fecha": "2026-10-01T10:30:00",
  "total": 5000000,
  "productos": [{ "productoId": 15, "cantidad": 2, "precio": 2500000 }]
}
```

La guía enumera los otros cuatro eventos pero no establece su JSON. **Supuesto sugerido, pendiente de acuerdo:** el adaptador local lee `evento`, `pedidoId`, `clienteId` y `fecha` para esos eventos. No se afirma que sea un contrato oficial. Los campos adicionales se permiten. Antes de integrar, acordar con Pagos, Facturación e Inventario y adaptar `src/models/event.js` si sus contratos difieren. No se requiere agregar un identificador al mensaje.

Ejemplo local de cada uno (los archivos completos están en `examples/`):

```json
{"evento":"PagoAprobado","pedidoId":1001,"clienteId":25,"fecha":"2026-10-01T10:31:00"}
{"evento":"PagoRechazado","pedidoId":1002,"clienteId":25,"fecha":"2026-10-01T10:32:00"}
{"evento":"FacturaGenerada","pedidoId":1001,"clienteId":25,"fecha":"2026-10-01T10:33:00"}
{"evento":"InventarioInsuficiente","pedidoId":1003,"clienteId":25,"fecha":"2026-10-01T10:34:00"}
```

Son cuatro objetos independientes, no un único documento JSON. Los identificadores y cantidades son enteros positivos; importes no negativos; `fecha` admite ISO con o sin zona para respetar el ejemplo académico. Se almacena su texto original como metadato interno. La `fecha` pública corresponde a la creación de la notificación en UTC.

También son **supuestos sugeridos** los nombres de exchange y queue, tipo `topic` y routing keys iguales a los cinco nombres de evento. Se pueden configurar para los acuerdos del equipo.

## Requisitos e instalación

Para Docker: Docker Desktop activo con contenedores Linux y Docker Compose. Para ejecución local: Node.js 24 o posterior y RabbitMQ accesible.

En PowerShell, desde la carpeta del proyecto:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

`.env` es opcional porque los valores predeterminados coinciden con el entorno local de demostración.

## Ejecutar todo con Docker

```powershell
docker compose up -d --build
docker compose ps
docker compose logs -f notificaciones
```

API: `http://localhost:3000`. Panel RabbitMQ: `http://localhost:15672`, usuario `notificaciones`, contraseña local `local-demo`. Estas credenciales son para la demostración en el computador. Los puertos se publican solo en localhost.

En este computador el puerto 3000 ya estaba ocupado, por lo que el `.env` local contiene `HOST_PORT=3010`: la API Docker se consulta en `http://localhost:3010`. En otro computador se usa 3000 por defecto. Si cambias `HOST_PORT`, reemplaza el puerto en los ejemplos de consulta y demostración. No sobrescribas un `.env` existente sin revisar sus valores.

SQLite se crea automáticamente en `/app/data/notificaciones.sqlite`. El volumen `notificaciones_data` conserva las filas al recrear el contenedor. `rabbitmq_data` conserva la configuración y mensajes persistentes. `docker compose down` detiene y retira contenedores conservando volúmenes; añadir `-v` elimina los datos.

## Ejecutar Node.js local y RabbitMQ en Docker

```powershell
docker compose up -d rabbitmq
npm.cmd start
```

No ejecutar simultáneamente la API local y el contenedor del servicio en el puerto 3000. La base local se crea en `data/notificaciones.sqlite`. Para desarrollo: `npm.cmd run dev`.

## Variables de entorno

- `PORT`: puerto HTTP, 3000.
- `HOST_PORT`: puerto externo de Docker, 3000 por defecto; el puerto interno sigue siendo 3000. Para ejecución Node local cambiar `PORT` si está ocupado.
- `DATABASE_PATH`: ruta del archivo SQLite, `./data/notificaciones.sqlite`.
- `RABBITMQ_URL`: conexión AMQP opcional; ejemplo comentado en `.env.example`.
- Si `RABBITMQ_URL` no está definida, Node usa `localhost` y el Compose local usa `rabbitmq`. Si defines una URL personalizada, también la usará el contenedor; no poner `localhost` para un broker de otro contenedor.
- `RABBITMQ_EXCHANGE`: exchange compartido, `comercio.eventos`.
- `RABBITMQ_EXCHANGE_TYPE`: `topic`, `direct` o `fanout`; debe coincidir con el exchange existente.
- `RABBITMQ_QUEUE`: cola exclusiva de Notificaciones, `grupo-j.notificaciones`.
- `RABBITMQ_BINDINGS`: routing keys separadas por coma; vacío utiliza los cinco eventos.
- `RABBITMQ_PREFETCH`: entregas máximas sin confirmar, 10.
- `RABBITMQ_RECONNECT_MS`: pausa de reconexión, 5000 ms.
- `RABBITMQ_PASSWORD`: variable de Compose para cambiar la contraseña de demostración; si ya existe el volumen del broker, cambiar esta variable no cambia automáticamente la cuenta existente.

En Compose se utiliza el hostname `rabbitmq`; localmente se utiliza `localhost`. Para contraseñas personalizadas, codificar caracteres especiales al construir la URL AMQP.

## Probar los eventos

Con Docker completo:

```powershell
docker compose exec notificaciones node scripts/publish.js examples/PedidoCreado.json
docker compose exec notificaciones node scripts/publish.js examples/PagoAprobado.json
docker compose exec notificaciones node scripts/publish.js examples/PagoRechazado.json
docker compose exec notificaciones node scripts/publish.js examples/FacturaGenerada.json
docker compose exec notificaciones node scripts/publish.js examples/InventarioInsuficiente.json
```

Con Node local y broker disponible:

```powershell
npm.cmd run publish -- examples/PedidoCreado.json
npm.cmd run publish -- examples/PagoAprobado.json
npm.cmd run publish -- examples/PagoRechazado.json
npm.cmd run publish -- examples/FacturaGenerada.json
npm.cmd run publish -- examples/InventarioInsuficiente.json
```

El publicador espera confirmación del broker, declara la topología de demostración y publica mensajes persistentes. El consumidor usa ACK manual después del INSERT. Cada grupo consumidor necesita su propia cola; compartir una cola con Reportes repartiría mensajes entre los dos servicios.

## API de Notificaciones

- `GET /api/notificaciones`: lista en orden más reciente primero.
- `GET /api/notificaciones/{id}`: detalle o 404.
- `GET /api/notificaciones/cliente/{clienteId}`: lista de un cliente.
- `PATCH /api/notificaciones/{id}/leida`: marca como leída; es idempotente y no exige cuerpo.
- `GET /health/live`: proceso HTTP activo.
- `GET /health/ready`: 200 si hay consumidor conectado; 503 durante desconexión.

Las listas admiten `?limit=100&offset=0`; máximo 500 por página. Para consultar todas las filas, avanzar offset hasta recibir un arreglo vacío. Parámetros inválidos devuelven 400 y fallos internos 500.

```powershell
Invoke-RestMethod http://localhost:3000/api/notificaciones
Invoke-RestMethod http://localhost:3000/api/notificaciones/cliente/25
Invoke-RestMethod http://localhost:3000/api/notificaciones/1
Invoke-RestMethod -Method Patch http://localhost:3000/api/notificaciones/1/leida
```

Cada notificación expone `id`, `clienteId`, `pedidoId`, `tipoEvento`, `titulo`, `mensaje`, `fecha`, `leida`. La consulta y actualización son para un laboratorio local: antes de exponerlas a usuarios, incorporar autenticación y autorización por cliente.

## Errores, recuperación y deduplicación

JSON inválido, evento no admitido o campos inválidos producen NACK con `requeue=false`; la topología enruta a `grupo-j.notificaciones.errores`. Revisar la causa, corregir y volver a publicar manualmente. No hay reintentos automáticos de mensajes inválidos.

Si SQLite falla, no se emite ACK ni se descarta el mensaje. Se cierra la conexión y se reconecta tras la pausa configurada; RabbitMQ vuelve a entregar mensajes pendientes. Los errores de conexión se registran sin imprimir credenciales ni payload completo. Un fallo persistente necesita intervención del operador; no se limita arbitrariamente el número de recuperaciones para no descartar pedidos.

La clave de deduplicación es SHA-256 del JSON canónico, con restricción UNIQUE. Reentregas idénticas y cambios en el orden de propiedades no duplican filas. Dos mensajes con contenido idéntico se consideran el mismo evento; cambios en datos o fecha producen una notificación nueva. Esta estrategia no garantiza deduplicación de eventos semánticamente iguales con payload diferente; un identificador oficial permitiría mejorarla cuando los grupos acuerden el contrato.

SQLite es adecuado para una instancia académica. Para varias réplicas independientes, migrar el repositorio a una base compartida como PostgreSQL con la misma restricción de unicidad; no montar este archivo en varios equipos.

## Pruebas

```powershell
npm.cmd test
docker compose up -d rabbitmq
npm.cmd run test:integration
```

Las pruebas locales usan SQLite real y un servidor HTTP real, con el canal AMQP simulado para verificar ACK/NACK. La integración requiere RabbitMQ real y falla si el broker no está disponible: comprueba los cinco eventos, consulta HTTP, cola de errores, mensajes en espera durante la parada y recuperación. Utiliza colas temporales exclusivas y las elimina al finalizar. No modifica la cola de demostración.

La última revisión aprobó 16 pruebas locales y una integración real con RabbitMQ. Las pruebas del frontend incluyen marcado de lectura, actualización durante el guardado y conservación del contador al recargar.

## Integración con los compañeros

La tabla `Notificacion` usa `Cliente_id` y `Pedido_id` como referencias lógicas al diagrama del equipo; los contratos JSON conservan `clienteId` y `pedidoId`. Incluye migración automática de la base SQLite anterior y un [esquema SQL de referencia para MySQL](database/mysql/001_notificacion.sql). El motor activo es SQLite; no hay adaptador MySQL ni envío SMTP implementados.

Todos los grupos deben acordar broker, vhost, exchange, routing keys y contratos. Cada consumidor usa una cola propia. Pedidos publica PedidoCreado; Pagos, PagoAprobado o PagoRechazado; Facturación, FacturaGenerada; e Inventario, InventarioInsuficiente. El frontend general puede consultar `/api/notificaciones/cliente/{clienteId}` mediante el gateway del equipo.

Para usar un broker compartido, copiar `.env.integracion.example` a `.env.integracion`, configurar la URL y ejecutar:

```powershell
docker compose stop notificaciones
docker compose --env-file .env.integracion -f docker-compose.integracion.yml up -d --build
```

El Compose de integración ejecuta solo Grupo J y conserva su base de datos. No inicia otro RabbitMQ. No utilizar la URL de ejemplo sin reemplazar host, usuario y contraseña.

## Referencias técnicas

- Semana8.docx: enunciado académico proporcionado para la actividad.
- [Confirmaciones y ACK de RabbitMQ](https://www.rabbitmq.com/docs/confirms).
- [Fiabilidad de RabbitMQ](https://www.rabbitmq.com/docs/reliability).
- [SQLite en Node.js](https://nodejs.org/api/sqlite.html).
