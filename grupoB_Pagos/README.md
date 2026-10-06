# Microservicio Pagos - Grupo B

Microservicio encargado de procesar de forma simulada los pagos del e-commerce.

Pagos recibe pedidos mediante RabbitMQ, valida la información necesaria, registra el resultado en su propia base de datos y publica uno de estos eventos:

- `PagoAprobado`
- `PagoRechazado`

El servicio no realiza cobros bancarios reales y no accede directamente a las bases de datos de otros microservicios.

---

## Flujo del servicio

```text
Pedidos
   ↓
RabbitMQ
   ↓
Cola de Pagos
   ↓
Consumer PHP
   ↓
Validación
   ↓
Simulación del pago
   ↓
MySQL / MariaDB
   ↓
RabbitMQ
   ├── PagoAprobado
   └── PagoRechazado
```

Los resultados pueden ser consumidos por otros microservicios mediante sus propias colas.

```text
PagoAprobado
   ├── Facturación
   ├── Notificaciones
   └── Reportes

PagoRechazado
   ├── Notificaciones
   └── Reportes
```

---

## Tecnologías

- PHP 8.2+
- Composer
- MariaDB / MySQL
- RabbitMQ
- php-amqplib
- HTML, CSS y JavaScript
- Apache/XAMPP para desarrollo local

No requiere Node.js, React, Laravel ni Docker.

---

## Instalación

### 1. Instalar dependencias

Desde la carpeta `grupoB_Pagos`:

```bash
composer install
```

### 2. Crear la configuración local

Copiar:

```text
.env.example
```

como:

```text
.env
```

En PowerShell:

```powershell
Copy-Item .env.example .env
```

Después configurar las credenciales locales de MySQL y RabbitMQ.

El archivo `.env` es local y no debe subirse al repositorio.

### 3. Crear la base de datos

Importar:

```text
database/schema.sql
```

El script crea la base:

```text
db_pagos
```

y la tabla:

```text
pagos
```

El archivo contiene únicamente la estructura y no incluye datos de prueba.

---

## Ejecutar el microservicio

Antes de iniciar Pagos deben estar disponibles:

- MySQL / MariaDB
- RabbitMQ
- Apache, si se utilizará la interfaz web

Preparar la topología local de RabbitMQ:

```powershell
php -d extension=sockets bin\console.php setup
```

Iniciar el consumidor:

```powershell
php -d extension=sockets bin\console.php consume
```

Si todo está correcto aparecerá:

```text
Consumidor activo. Ctrl+C para detener.
```

El consumidor debe permanecer activo para procesar los mensajes recibidos.

### Atajo en Windows

También puede utilizarse:

```powershell
.\pagos.ps1 consume
```

`pagos.ps1` es únicamente un atajo de PowerShell que localiza PHP, comprueba la extensión `sockets` y ejecuta `bin/console.php`.

Su uso es opcional.

---

## Interfaz web

Si el repositorio completo está ubicado en:

```text
C:\xampp\htdocs\E-commerce
```

la interfaz puede abrirse en:

```text
http://localhost/E-commerce/grupoB_Pagos/
```

Si el proyecto se instala directamente como una carpeta llamada `pagos` dentro de `htdocs`:

```text
http://localhost/pagos/
```

La aplicación tiene dos vistas principales:

- **Pago:** consulta el estado de un pedido.
- **Historial:** muestra los pagos registrados.

---

## Puertos utilizados

| Servicio | Puerto habitual |
|---|---:|
| Apache / HTTP | 80 |
| MySQL / MariaDB | 3306 |
| RabbitMQ AMQP | 5672 |
| RabbitMQ Management | 15672 |

Los microservicios se conectan a RabbitMQ mediante el puerto:

```text
5672
```

El puerto `15672` corresponde únicamente al panel administrativo de RabbitMQ.

---

## Configuración RabbitMQ actual

Valores predeterminados para desarrollo local:

```env
AMQP_HOST=localhost
AMQP_PORT=5672
AMQP_VHOST=/

AMQP_EXCHANGE=ecommerce.eventos
AMQP_QUEUE=pagos.pedido_creado

AMQP_EVENT_INPUT=PedidoCreado
AMQP_KEY_INPUT=pedido.creado

AMQP_KEY_APPROVED=pago.aprobado
AMQP_KEY_REJECTED=pago.rechazado
```

Estos valores son configurables mediante `.env`.

Los nombres actuales fueron utilizados durante el desarrollo local y pueden cambiar cuando todos los grupos acuerden el broker, exchange y routing keys definitivos.

---

# Contrato de entrada

Actualmente Pagos consume un evento `PedidoCreado`.

Ejemplo:

```json
{
  "evento": "PedidoCreado",
  "pedidoId": 1001,
  "clienteId": 25,
  "fecha": "2026-10-05T10:30:00",
  "total": 95000,
  "productos": [
    {
      "productoId": 20,
      "cantidad": 1,
      "precio": 95000
    }
  ]
}
```

Para procesar el pago, Pagos utiliza:

- `evento`
- `pedidoId`
- `clienteId`
- `total`

Pagos no necesita consultar directamente las bases de datos de Pedidos, Clientes o Productos.

---

# Eventos publicados

## Pago aprobado

Routing key actual:

```text
pago.aprobado
```

Ejemplo:

```json
{
  "evento": "PagoAprobado",
  "pedidoId": 1001,
  "clienteId": 25,
  "pagoId": 1,
  "total": 95000,
  "estado": "APROBADO",
  "fecha": "2026-10-05T10:31:00Z"
}
```

---

## Pago rechazado

Routing key actual:

```text
pago.rechazado
```

Ejemplo:

```json
{
  "evento": "PagoRechazado",
  "pedidoId": 1002,
  "clienteId": 25,
  "pagoId": 2,
  "total": 95000,
  "estado": "RECHAZADO",
  "fecha": "2026-10-05T10:32:00Z",
  "motivo": "Rechazo de prueba configurado"
}
```

---

# Simulación de pagos

El valor del pedido no determina si un pago es aprobado o rechazado.

Por defecto, todo pago válido se aprueba:

```env
PAYMENT_REJECT_ORDER_IDS=
```

Para demostrar el flujo `PagoRechazado` durante el laboratorio se pueden configurar pedidos específicos:

```env
PAYMENT_REJECT_ORDER_IDS=2011
PAYMENT_REJECTION_REASON=Rechazo de prueba configurado
```

También pueden configurarse varios pedidos:

```env
PAYMENT_REJECT_ORDER_IDS=2011,2012,2013
```

Los demás pedidos continuarán siendo aprobados normalmente.

En una implementación real, la aprobación o rechazo sería determinada por una pasarela o entidad financiera.

Errores técnicos como una caída de MySQL, RabbitMQ o un mensaje inválido no se convierten en `PagoRechazado`.

---

# Prueba local desde la web

Para desarrollo puede habilitarse:

```env
WEB_TEST_ENABLED=1
```

Esto muestra la opción:

```text
Prueba local de integración
```

La prueba no inserta directamente en MySQL.

Utiliza el mismo flujo del microservicio:

```text
Web
 ↓
RabbitMQ
 ↓
Consumer Pagos
 ↓
MySQL
 ↓
RabbitMQ
```

Cuando Pedidos esté integrado puede utilizarse:

```env
WEB_TEST_ENABLED=0
```

En ese caso los pedidos llegarán directamente desde el microservicio Pedidos.

---

# Integración con otros microservicios

## Pedidos → Pagos

Pedidos debe publicar el evento acordado en RabbitMQ.

```text
Pedidos
   ↓
pedido.creado
   ↓
RabbitMQ
   ↓
Pagos
```

Pagos no necesita acceso directo a la base de datos de Pedidos.

## Pagos → Facturación

Facturación debe consumir los pagos aprobados:

```text
pago.aprobado
```

Un pago rechazado no debe generar una factura.

## Pagos → Notificaciones

Notificaciones puede consumir:

```text
pago.aprobado
pago.rechazado
```

## Pagos → Reportes

Reportes puede consumir ambos resultados para generar estadísticas.

---

## Colas independientes

Cada consumidor debe utilizar su propia cola.

No se debe compartir una misma cola entre Facturación, Notificaciones y Reportes.

```text
                 pago.aprobado
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
    Facturación  Notificaciones  Reportes
       cola A        cola B       cola C
```

De esta manera cada microservicio recibe su propia copia del evento.

---

# Base de datos

La tabla `pagos` contiene:

```text
id
pedido_id
cliente_id
total
estado
motivo_rechazo
fecha_procesamiento
evento_publicado
```

`pedido_id` es único.

Esto permite evitar registros duplicados cuando RabbitMQ vuelve a entregar un mismo pedido.

`evento_publicado = 1` indica que RabbitMQ confirmó la publicación del resultado del pago.

No significa que Facturación, Notificaciones o Reportes ya hayan procesado el evento.

---

# Recuperación ante caída del consumidor

La cola de Pagos es durable y los mensajes se publican como persistentes.

Si el consumidor está detenido:

```text
Pedido
   ↓
RabbitMQ
   ↓
mensaje pendiente
```

Cuando Pagos vuelve a iniciar:

```text
mensaje pendiente
   ↓
Consumer Pagos
   ↓
procesamiento
```

Esto permite continuar procesando mensajes pendientes después de una caída temporal del servicio.

---

# Pruebas realizadas

Durante el desarrollo se verificaron:

- recepción de pedidos mediante RabbitMQ;
- pagos aprobados;
- pagos rechazados configurables;
- pagos superiores a $5.000.000 sin rechazo por importe;
- persistencia en MySQL / MariaDB;
- publicación de `PagoAprobado`;
- publicación de `PagoRechazado`;
- mensajes conservados mientras el consumidor estaba detenido;
- procesamiento después de reiniciar el consumidor;
- pedidos duplicados sin crear filas duplicadas;
- descarte de mensajes inválidos;
- distribución de un mismo resultado a varias colas;
- interfaz de Pago;
- interfaz de Historial.

Última ejecución de pruebas automáticas:

```text
102 comprobaciones de lógica
20 comprobaciones de interfaz
12 comprobaciones AMQP
```

Pruebas generales:

```powershell
composer test
```

Pruebas RabbitMQ:

```powershell
php -d extension=sockets tests\rabbitmq.php
```

---

# Integración global pendiente

Para integrar los nueve microservicios, los grupos deben acordar:

- broker RabbitMQ compartido;
- host;
- puerto;
- usuario y contraseña;
- vhost;
- exchange;
- tipo de exchange;
- routing keys;
- nombres de eventos;
- contratos JSON.

Todos los microservicios que intercambien eventos deben conectarse al mismo broker RabbitMQ.

Los valores actuales de `.env.example` corresponden al entorno de desarrollo y pueden modificarse sin cambiar la lógica del microservicio.