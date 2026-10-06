# Microservicio Pagos

## Descripción

Pagos consume un evento de pedido desde RabbitMQ, valida el mensaje, evita registros duplicados, simula el procesamiento, guarda el resultado en su base MySQL y publica `PagoAprobado` o `PagoRechazado`. Es PHP puro con PDO y php-amqplib. No realiza cobros bancarios ni accede a bases de otros microservicios.

El importe no determina el resultado. Todo pago estructuralmente válido se aprueba por defecto; los rechazos de laboratorio se configuran exclusivamente por pedidoId. La interfaz tiene dos vistas: Pago e Historial. La herramienta web de prueba utiliza el consumidor real, sin escribir directamente en la tabla.

## Arquitectura

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
Simulación de pago
   ↓
MySQL
   ↓
RabbitMQ
   ├── PagoAprobado
   └── PagoRechazado
```

| Componente | Responsabilidad |
|---|---|
| `src/Config.php`, `Database.php` | Configuración y conexión PDO de la base propia |
| `src/Order.php`, `Money.php` | Interpretación y validación exacta del evento |
| `src/Simulator.php` | Simulación configurable por pedidoId |
| `src/PaymentRepository.php` | Registro idempotente, publicación pendiente e historial |
| `src/PaymentEvent.php` | Contratos de salida desde datos persistidos |
| `src/Broker.php` | Topología AMQP, mensajes persistentes y publisher confirms |
| `src/Processor.php`, `PendingRecovery.php`, `PublicationException.php` | Coordinación, recuperación y errores de publicación |
| `bin/console.php` | Consumidor y utilidades de laboratorio |
| `public/` | Consulta del pago, historial y prueba web configurable |

No existe un procesador alternativo en el frontend. Las consultas HTTP actuales devuelven HTML; la consulta JSON de la propia vista sirve para actualizar el resultado y no acepta pedidos externos para procesarlos.

## Estructura para el repositorio

```text
pagos/
├── .env.example
├── .gitignore
├── .htaccess
├── bootstrap.php
├── composer.json
├── composer.lock
├── index.php
├── pagos.ps1
├── README.md
├── bin/console.php
├── database/schema.sql
├── src/       11 clases PHP
├── public/    Pago, Historial, plantillas, CSS y JavaScript
├── tests/     run.php, regressions.php, views.php, rabbitmq.php
└── examples/  siete ejemplos JSON de entrada y salida
```

`.env` y `vendor/` pueden existir localmente y están excluidos. `.env.example` es una plantilla sin contraseñas reales. `.gitignore` también excluye logs, temporales, cachés, depuración, archivos de credenciales y dumps; solo `database/schema.sql` se permite entre los SQL. Los ejemplos JSON son muestras de contratos, no una exportación de la base ni datos que el instalador cargue.

Para copiar el proyecto a `grupoB_Pagos`, conservar los archivos del árbol y omitir `.env`, `vendor/`, archivos locales y dumps. No copiar toda la carpeta indiscriminadamente: `.gitignore` no elimina secretos de archivos ya versionados ni impide forzar su inclusión. Este checkout aún no tiene `.git`; no se inició Git ni se accedió al repositorio remoto durante esta preparación.

## Requisitos

- PHP 8.2+ de 64 bits, dentro de la compatibilidad `^8.2` fijada en Composer.
- Composer 2 y extensiones PHP PDO, pdo_mysql, json, mbstring y sockets. Zip facilita las descargas de dependencias.
- MariaDB/MySQL con soporte InnoDB y RabbitMQ accesible.
- Apache u otro servidor HTTP con PHP para la interfaz.

No se requieren Node.js, npm, React, Bootstrap, Tailwind, Laravel ni Docker. CLI y servidor HTTP pueden utilizar configuraciones PHP distintas; comprobar sus extensiones y que el usuario HTTP pueda leer `.env` y utilizar sesiones PHP.

## Instalación

1. Abrir una terminal en la raíz del proyecto e instalar las versiones fijadas:

```sh
composer install --no-interaction --prefer-dist
```

No sustituirlo por `composer update`. `composer.json` declara las dependencias y el autoload; `composer.lock` fija sus versiones. `vendor/` se reconstruye y no debe subirse.

2. Copiar `.env.example` como `.env`, únicamente si no existe:

```powershell
Copy-Item .env.example .env
```

En Linux usar `cp .env.example .env`. Completar DB_USER, DB_PASSWORD, AMQP_USER y AMQP_PASSWORD localmente, junto con los servidores y permisos correspondientes. Las variables del entorno del proceso tienen prioridad sobre `.env`. No compartir credenciales.

3. En una instalación nueva, importar `database/schema.sql` con phpMyAdmin o el cliente MariaDB/MySQL:

```sh
mysql -u USUARIO -p < database/schema.sql
```

En Windows, importar desde phpMyAdmin si la terminal no admite esta redirección. El archivo crea exclusivamente `db_pagos` y una tabla `pagos` vacía con los ocho campos existentes; no contiene INSERT, datos locales ni comandos de borrado. Es para instalaciones limpias: si la tabla ya existe, CREATE TABLE produce un error en lugar de sustituirla. No importarlo sobre la base de trabajo existente. El administrador puede importar con permisos de creación; el consumidor utiliza SELECT, INSERT y UPDATE en la tabla propia.

Se fija InnoDB para transacciones y bloqueo de filas y utf8mb4 para textos. Columnas: `id`, `pedido_id`, `cliente_id`, `total`, `estado`, `motivo_rechazo`, `fecha_procesamiento`, `evento_publicado`. No hay relaciones con bases de otros grupos.

4. Comprobar la conexión en lectura, preparar la topología y arrancar el consumidor:

```powershell
php -d extension=sockets bin\console.php check-db
php -d extension=sockets bin\console.php setup
php -d extension=sockets bin\console.php consume
```

Si sockets ya está habilitada en PHP, utilizar `php bin/console.php ...` para evitar cargarla dos veces. En Linux usar barras `/`. `check-db` muestra columnas, tipos, claves y motor; no repara el esquema. Se requiere UNIQUE pedido_id e InnoDB.

En este entorno Windows PHP está en `C:\xampp\php\php.exe`; esa ruta es opcional y no una dependencia del proyecto. `pagos.ps1` admite PHP_EXECUTABLE en el entorno, después busca PHP en PATH y finalmente la ruta local de XAMPP. Por ejemplo `powershell -NoProfile -ExecutionPolicy Bypass -File .\pagos.ps1 consume`; la política se aplica solo a ese proceso.

5. Abrir la interfaz. En XAMPP, desde una carpeta `pagos`, usar `http://localhost/pagos/`; si se copia a `grupoB_Pagos` dentro de htdocs, usar `http://localhost/grupoB_Pagos/`. Para consultar un pedido: `/public/?pedidoId=2005`; para historial: `/public/history.php`. La ruta raíz conserva los parámetros al redirigir.

En otro servidor configurar el document root en `public/`, mantener `.env` y fuentes internas fuera del acceso HTTP y bloquear `_*.php`. `.htaccess` protege el entorno Apache local; otros servidores deben reproducir estas restricciones. El servidor incorporado de PHP no aplica `.htaccess`.

## Configuración RabbitMQ

| Parámetro | Valor local predeterminado |
|---|---|
| AMQP_HOST / AMQP_PORT | localhost / 5672 |
| AMQP_EXCHANGE | ecommerce.eventos |
| Tipo de exchange | topic, duradero |
| AMQP_QUEUE | pagos.pedido_creado, duradera |
| AMQP_EVENT_INPUT | PedidoCreado |
| AMQP_KEY_INPUT | pedido.creado |
| AMQP_KEY_APPROVED | pago.aprobado |
| AMQP_KEY_REJECTED | pago.rechazado |
| AMQP_VHOST | / |

**5672 es el puerto AMQP utilizado por los microservicios. 15672 corresponde únicamente al panel web de administración**, si el plugin de administración está habilitado. No configurar AMQP_PORT=15672.

Host, puerto, cuenta, contraseña, vhost, exchange, cola, nombre de evento y routing keys se ajustan mediante `.env`; el tipo de exchange sigue siendo topic en la implementación. Los nombres locales son provisionales. `ecommerce.eventos` no se presenta como el exchange definitivo del curso.

También se incluyen AMQP_CONNECT_TIMEOUT=5, AMQP_READ_TIMEOUT=65, AMQP_HEARTBEAT=30 y AMQP_CONFIRM_TIMEOUT=5. Mantener el timeout de lectura mayor que el doble del heartbeat. Reiniciar el consumidor tras modificar código o configuración. Si ya existe topología incompatible, coordinar con los equipos; no borrar entidades compartidas.

## Contrato de entrada

Pedidos publica la información mediante RabbitMQ; Pagos no consulta directamente su base. Ejemplo del formato actual:

```json
{
  "evento": "PedidoCreado",
  "pedidoId": 2005,
  "clienteId": 35,
  "fecha": "2026-10-05T03:45:00",
  "total": 95000,
  "productos": [{"productoId": 20, "cantidad": 1, "precio": 95000}]
}
```

Se valida el nombre exacto configurado en AMQP_EVENT_INPUT, pedidoId y clienteId enteros positivos hasta 2147483647 y total positivo compatible con DECIMAL(12,2). Fecha y productos se aceptan sin recalcular el total. No se exigen campos adicionales.

El importe se interpreta desde su texto JSON original: admite número JSON o cadena decimal ordinaria, máximo `9999999999.99` y dos decimales, sin redondear escalas adicionales. `5000000.01` es válido; `5000000.00000001` no lo es por su precisión, no por su magnitud. Los números con exponente se normalizan exactamente. La capacidad del campo SQL no es una regla para decidir rechazo. No se asume moneda, nombres ni fotos de catálogo.

## Contratos de salida

Evento aprobado observado en la prueba web de extremo a extremo previamente realizada:

```json
{
  "evento": "PagoAprobado",
  "pedidoId": 2006100401,
  "clienteId": 99001,
  "pagoId": 10,
  "total": 125.5,
  "estado": "APROBADO",
  "fecha": "2026-10-05T03:56:24Z"
}
```

Ejemplo del formato rechazado para laboratorio, no presentado como registro insertado durante esta preparación:

```json
{
  "evento": "PagoRechazado",
  "pedidoId": 2011,
  "clienteId": 35,
  "pagoId": 11,
  "total": 95000,
  "estado": "RECHAZADO",
  "fecha": "2026-10-05T03:45:00Z",
  "motivo": "Rechazo de prueba configurado"
}
```

pagoId y fecha proceden de la fila persistida; los números del ejemplo no se cargan en SQL. El motivo aparece únicamente en PagoRechazado. total sigue siendo número JSON y fecha ISO 8601 UTC. `message_id` AMQP es estable, `pagos:<pagoId>`. Se conservan los contratos existentes; no se añadieron campos.

## Integración con otros grupos

La integración prevista debe acordarse y probarse con cada equipo:

- **Pedidos:** publicar el evento de entrada en el exchange topic compartido usando la routing key de entrada y el JSON acordado. No proporcionar acceso directo a su base.
- **Facturación:** vincular su cola a pago.aprobado y consumir PagoAprobado. No generar factura ante PagoRechazado.
- **Notificaciones:** vincular su propia cola a pago.aprobado y pago.rechazado para notificar ambos resultados.
- **Reportes:** vincular otra cola a ambas claves para registrar estadísticas de resultados.

Cada microservicio consumidor debe declarar su propia cola duradera y bindings antes de emitir pedidos. No compartir una misma cola entre Facturación, Notificaciones y Reportes: compartirla reparte mensajes entre ellos; colas diferentes reciben copias. El exchange por sí solo no conserva mensajes para colas creadas posteriormente. Cada consumidor debe deduplicar por pagoId o message_id.

## Integración global

Antes de ejecutar los nueve servicios, acordar host del broker compartido, puerto AMQP, usuario, contraseña, vhost, exchange, tipo topic compatible con Pagos, routing keys, nombres de eventos, formato JSON y permisos de cada cuenta. Todos deben apuntar al mismo broker y vhost acordados; localhost en máquinas distintas representa servidores distintos.

Ajustar `.env` sin cambiar el procesador. Los contratos y nombres actuales son la base de discusión, no una garantía de acuerdo global. Una cola demo o una prueba con dos colas locales no demuestra integración con aplicaciones reales de otros equipos.

## Prueba web

`.env.example` incluye WEB_TEST_ENABLED=1, lista de rechazo vacía y motivo estándar. La herramienta aparece como sección colapsable Prueba local de integración en Pago. Solicita pedidoId, clienteId, total y un producto de prueba identificado por productoId, cantidad y precio. No contiene selector manual de resultado.

```text
Web → RabbitMQ → Consumer real → MySQL → RabbitMQ
```

La web valida el formulario y su token de sesión, publica el evento con Broker y redirige a la consulta del pedido. No llama directamente a Processor ni inserta en MySQL. Requiere un consumidor activo y crea pagos reales de laboratorio; usar IDs nuevos y no borrar filas para repetir.

La consulta automática tiene hasta 20 intentos, intervalo de tres segundos y timeout de cinco segundos por solicitud. Se detiene al recibir estado final, al agotar intentos o si la pestaña queda oculta; se puede consultar de nuevo. Sin fila muestra espera, no rechazo ni importe inventado.

Con Pedidos integrado, establecer WEB_TEST_ENABLED=0: oculta la herramienta y rechaza publicaciones web de prueba, conservando la consulta y el historial. El valor por defecto del código, si no se configura la variable, es 0; la plantilla proporcionada habilita explícitamente el laboratorio.

## Simulación de rechazos

Normalmente `PAYMENT_REJECT_ORDER_IDS=` significa que todo pago válido se aprueba, independientemente del importe. Para laboratorio:

```ini
PAYMENT_REJECT_ORDER_IDS=2011
PAYMENT_REJECTION_REASON=Rechazo de prueba configurado
```

Solo el pedido 2011 se rechaza; otros IDs se aprueban. Se admiten varios IDs separados por comas, espacios alrededor y duplicados; los IDs deben ser enteros positivos sin ceros iniciales hasta 2147483647. Una lista o un motivo inválido es un error de configuración, sin PagoRechazado. Elegir un ID nuevo y reiniciar consume para aplicar cambios. Una fila ya procesada conserva su resultado original incluso si cambia la lista.

MySQL caído, RabbitMQ caído, JSON inválido e infraestructura o errores internos **no se convierten en PagoRechazado**. Las variables antiguas PAYMENT_MODE y PAYMENT_LIMIT se retiraron. En un sistema financiero real el resultado procedería de una pasarela; esa integración no está implementada ni forma parte de este laboratorio.

## Fiabilidad y recuperación

pedido_id tiene restricción UNIQUE. El registro conserva una sola fila ante duplicados idénticos, sin cambiar estado ni fecha; si cliente o total difieren, descarta el conflicto conservando el original. Un duplicado ya publicado no emite normalmente otro resultado.

RabbitMQ utiliza ACK/NACK manuales, colas y exchange duraderos, mensajes persistentes y publisher confirms con mandatory. Si Pagos está apagado, una entrada publicada a la cola previamente declarada puede esperar; al volver, el consumidor la procesa. Una publicación sin destinos se detecta aunque exista un confirm del broker.

Tras registrar, se bloquea la fila con FOR UPDATE, publica el resultado y marca evento_publicado=1 después de confirmación sin devolución. Esa marca significa confirmación de RabbitMQ, **no** que Facturación, Notificaciones o Reportes hayan consumido el evento; mandatory tampoco garantiza que cada una de sus colas exista.

Un error aislado de salida conserva la publicación pendiente y permite ACK de la entrada ya guardada. La recuperación al arranque y cada RECOVERY_INTERVAL segundos recorre lotes de RECOVERY_BATCH filas, avanzando por ID incluso si una falla; vuelve al inicio al llegar al final. `recover` manual procesa solo un lote. Los fallos sistémicos salen con código 1 y permiten reentrega de entradas sin ACK; los mensajes inválidos se descartan sin reencolar. No hay DLQ acordada.

SQL y RabbitMQ no comparten transacción: un fallo entre confirmación y commit puede duplicar un resultado. No se garantiza exactamente una vez. Los consumidores de salida deben deduplicar. El esquema no registra intentos ni errores; no se añadió otra tabla. El consumidor necesita reinicio/supervisión tras fallos sistémicos.

En Linux, el administrador puede mantener el proceso existente con systemd, definiendo usuario, carpeta, ExecStart con PHP y consume, Restart=on-failure y RestartSec=5. Configurar acceso a `.env`, reinicio automático y registros operativos en el servidor acordado. No se instaló supervisor ni se desplegó en esta preparación.

## Pruebas realizadas y reproducibles

```sh
composer test
php -d extension=sockets tests/rabbitmq.php
```

Ejecutadas nuevamente el 5 de octubre de 2026:

| Comprobación | Evidencia y alcance |
|---|---|
| Aprobación normal, importe superior a 5.000.000 y máximo decimal | 102 comprobaciones de lógica: decisión aprobada sin umbral monetario, validación, contratos, rechazo configurado por ID y recuperación por callbacks; sin SQL ni AMQP |
| Rechazo de laboratorio reproducible | Simulador probado en memoria con IDs, importes pequeños/grandes, lista vacía, prioridad de entorno y configuración inválida; no confundir con persistencia SQL del nuevo mecanismo |
| Interfaz y protección de publicación | 20 comprobaciones en memoria: estados, cliente, escape HTML, dos vistas, flag web, token y validación antes de publicar |
| Publicaciones PagoAprobado/PagoRechazado | 12 comprobaciones AMQP sobre exchange y colas aislados; ambos eventos confirmados, message_id estable, mandatory y continuidad tras error aislado |
| Consumidor ausente y mensaje almacenado | Suite AMQP publica sin consumidor y verifica persistencia tras reconectar el cliente; no equivale a reiniciar el consumidor completo |
| Duplicados y mensaje inválido | Validación local, transporte duplicado, NACK/reentrega y descarte manual AMQP; el transporte por sí solo no demuestra idempotencia SQL |
| Distribución a varias colas | Dos colas independientes reciben copias idénticas de aprobaciones y rechazos; no se probó una aplicación externa de otro equipo |

Evidencia anterior: la prueba web real del pedido 2006100401 atravesó RabbitMQ, fue registrada por el consumidor como pago 10 y publicó PagoAprobado con marca 1. Se compararon las cinco filas anteriores antes/después y no cambiaron. Se consultaron estados aprobado/rechazado existentes, historial y diseño de escritorio/móvil. No se exportaron ni cargaron esos registros en schema.sql.

No se presentan como comprobados aquí: persistencia SQL de un rechazo configurado nuevo o de un pago grande bajo la regla nueva, reinicio del consumidor completo, concurrencia SQL, caída del broker, ventana confirm/commit y recuperación SQL forzada. La idempotencia se revisó en el código y esquema; sus pruebas completas con duplicados por el consumidor requieren una base de laboratorio acordada. Recuperación por callbacks no demuestra bloqueos y commits reales.

La suite AMQP crea únicamente topología con prefijo aleatorio pagos.test y la limpia al terminar. Las pruebas de esta preparación no insertaron, actualizaron ni borraron pagos reales y no ejecutaron schema.sql.

## Revisión antes de copiar e integración pendiente

Preparación local sin clone, add, commit, push ni acceso al repositorio compartido. Se comprobaron sintaxis de las fuentes PHP, configuración segura de la plantilla, reglas de exclusión, ausencia de temporales y schema con solo DDL.

Composer validate y check-platform-reqs fueron correctos. `composer install --dry-run --no-scripts --no-plugins` confirmó que el lock es instalable en esta plataforma y no requiere cambios; vendor se reconstruye con composer install. Hubo una limitación de red al consultar filtros externos de Packagist, por lo que no se afirma haber probado una descarga completa desde cero ni una auditoría de seguridad actualizada. La instalación y la importación del esquema deben verificarse en la máquina nueva; no se ejecutó DDL sobre la base local.

Antes de integrar: acordar broker/vhost/permisos/topología/JSON, preparar las colas de cada consumidor, elegir IDs nuevos para las pruebas, deshabilitar la herramienta web cuando corresponda y configurar supervisión y acceso HTTP del servidor. No hay despliegue ni publicación del repositorio realizada.