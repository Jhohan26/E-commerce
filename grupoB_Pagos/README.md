# Microservicio Pagos - Grupo B

Microservicio encargado de procesar de forma simulada los pagos del e-commerce distribuido.

Pagos recibe eventos `PedidoCreado` mediante RabbitMQ, valida la información recibida, registra el resultado en su propia base de datos y publica uno de los siguientes eventos:

- `PagoAprobado`
- `PagoRechazado`

El servicio no realiza cobros bancarios reales. Para el laboratorio utiliza un simulador de pasarela que permite reproducir de forma controlada pagos aprobados y rechazados.

Pagos no accede directamente a las bases de datos de los demás microservicios.

---

## Arquitectura actual

La integración utiliza un broker RabbitMQ compartido mediante CloudAMQP.

### Entrada a Pagos

```text
Pedidos
   ↓
PedidoCreado
   ↓
pedidos_exchange
tipo: fanout
   ↓
pagos_pedidos_queue
   ↓
Microservicio Pagos
```

### Salida de Pagos

```text
Microservicio Pagos
        ↓
  pagos_exchange
    tipo: topic
      /       \
     /         \
pago.aprobado  pago.rechazado
     ↓              ↓
PagoAprobado    PagoRechazado
```

Los demás microservicios deben utilizar sus propias colas para consumir estos eventos.

---

# Tecnologías

- PHP 8.2+
- Composer
- MySQL / MariaDB
- RabbitMQ
- CloudAMQP
- php-amqplib
- PDO
- HTML
- CSS
- JavaScript
- Apache/XAMPP para desarrollo local

No requiere Laravel, Node.js ni Docker para ejecutar el microservicio Pagos.

---

# Requisitos

Antes de ejecutar el proyecto se necesita:

- PHP 8.2 o superior
- Composer
- MySQL o MariaDB
- acceso al broker RabbitMQ compartido
- extensión PHP `sockets`
- extensión PHP `openssl`
- extensión PHP `zip` para instalar dependencias con Composer

En XAMPP puede verificarse el archivo utilizado por PHP con:

```powershell
php --ini
```

Para comprobar las extensiones:

```powershell
php -m | Select-String "zip|sockets|openssl"
```

---

# Instalación

## 1. Entrar al proyecto

Si el repositorio se encuentra en:

```text
C:\xampp\htdocs\E-commerce
```

ejecutar:

```powershell
cd C:\xampp\htdocs\E-commerce\grupoB_Pagos
```

---

## 2. Instalar dependencias

```powershell
composer install
```

Composer debe finalizar sin errores y crear:

```text
vendor/
```

El directorio `vendor/` no se versiona en Git.

---

## 3. Crear la base de datos

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

La estructura esperada es:

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

`pedido_id` es único para evitar duplicar un pago correspondiente al mismo pedido.

---

## 4. Crear el archivo de configuración

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

El archivo `.env` contiene configuración local y credenciales, por lo tanto:

```text
NO debe subirse a GitHub.
```

---

# Configuración

Ejemplo de configuración:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=db_pagos
DB_USER=root
DB_PASSWORD=

RABBITMQ_URL=amqps://usuario:clave@host.rmq.cloudamqp.com/vhost

RABBITMQ_EXCHANGE_PEDIDOS=pedidos_exchange
RABBITMQ_EXCHANGE_PAGOS=pagos_exchange

AMQP_QUEUE=pagos_pedidos_queue
AMQP_EVENT_INPUT=PedidoCreado

AMQP_KEY_APPROVED=pago.aprobado
AMQP_KEY_REJECTED=pago.rechazado
AMQP_DEMO_QUEUE=pagos_resultados_demo

AMQP_CONNECT_TIMEOUT=5
AMQP_READ_TIMEOUT=65
AMQP_HEARTBEAT=30
AMQP_CONFIRM_TIMEOUT=5

PAYMENT_REJECT_ORDER_IDS=
PAYMENT_REJECTION_REASON=Transaccion rechazada por la pasarela simulada

RECOVERY_INTERVAL=5
RECOVERY_BATCH=100

WEB_TEST_ENABLED=1
```

La URL real proporcionada para CloudAMQP se coloca únicamente en el `.env` local:

```env
RABBITMQ_URL=amqps://usuario:contraseña@servidor/vhost
```

La URL contiene credenciales y nunca debe colocarse en:

- GitHub
- README
- `.env.example`
- código fuente

---

# RabbitMQ

## Broker compartido

La conexión se realiza utilizando:

```env
RABBITMQ_URL=
```

Esto permite utilizar tanto:

```text
amqp://
```

como:

```text
amqps://
```

CloudAMQP utiliza normalmente AMQPS/TLS.

---

## Exchange de Pedidos

Pagos consume desde:

```text
pedidos_exchange
```

Tipo:

```text
fanout
```

Cola propia de Pagos:

```text
pagos_pedidos_queue
```

Al utilizar `fanout`, Pedidos publica una sola vez y RabbitMQ entrega una copia a cada cola enlazada.

Ejemplo:

```text
                 pedidos_exchange
                       │
       ┌───────────────┼───────────────┐
       ↓               ↓               ↓
    Pagos          Inventario       Reportes
```

Cada microservicio debe tener su propia cola.

---

## Exchange de Pagos

Pagos publica sus resultados en:

```text
pagos_exchange
```

Tipo:

```text
topic
```

Routing keys:

```text
pago.aprobado
pago.rechazado
```

Esto permite que los consumidores decidan cuáles resultados quieren recibir.

Ejemplo:

```text
                    pagos_exchange
                         │
             ┌───────────┴───────────┐
             ↓                       ↓
       pago.aprobado           pago.rechazado
             ↓                       ↓
      PagoAprobado             PagoRechazado
```

---

# Preparar la topología

Antes de iniciar el consumidor:

```powershell
php bin\console.php setup --demo-results
```

Si la conexión al broker y la configuración son correctas debe aparecer:

```text
Topologia duradera preparada.
```

Este comando prepara:

```text
pedidos_exchange
pagos_exchange
pagos_pedidos_queue
pagos_resultados_demo
```

La cola `pagos_resultados_demo` se utiliza únicamente para observar los resultados durante pruebas.

---

# Verificar la base de datos

Ejecutar:

```powershell
php bin\console.php check-db
```

Debe aparecer:

```text
Conexion y nombres de columnas correctos.
```

También se comprueba que la tabla utilice:

```text
InnoDB
```

---

# Ejecutar el consumidor

```powershell
php bin\console.php consume
```

Si todo está correcto:

```text
Consumidor activo. Ctrl+C para detener.
```

Mientras esta terminal permanezca abierta, Pagos estará esperando eventos `PedidoCreado`.

---

# Observar eventos publicados

Para desarrollo y pruebas puede abrirse otra terminal:

```powershell
php bin\console.php observe
```

Debe aparecer:

```text
Observando cola demo. Ctrl+C para detener.
```

Aquí pueden visualizarse los eventos:

```text
PagoAprobado
PagoRechazado
```

publicados por Pagos.

---

# Flujo normal

El funcionamiento normal es completamente automático.

```text
PedidoCreado
     ↓
RabbitMQ
     ↓
pagos_pedidos_queue
     ↓
Consumer PHP
     ↓
Validación
     ↓
Simulación de pasarela
     ↓
Registro MySQL
     ↓
PagoAprobado / PagoRechazado
     ↓
pagos_exchange
```

No es necesario ejecutar manualmente otro comando después de recibir `PedidoCreado`.

---

# Contrato de entrada

Pagos consume:

```text
PedidoCreado
```

Ejemplo:

```json
{
  "evento": "PedidoCreado",
  "pedidoId": 1001,
  "clienteId": 25,
  "fecha": "2026-10-07T10:30:00",
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

Para procesar el pago se utilizan principalmente:

```text
evento
pedidoId
clienteId
total
```

`pedidoId` y `clienteId` deben llegar como enteros JSON.

Correcto:

```json
{
  "pedidoId": 1001,
  "clienteId": 25
}
```

Incorrecto:

```json
{
  "pedidoId": "1001",
  "clienteId": "25"
}
```

Un mensaje inválido se descarta y no se convierte en `PagoRechazado`.

---

# Pago aprobado

Todo pedido válido se aprueba por defecto si no está configurado para rechazo.

Evento:

```text
PagoAprobado
```

Exchange:

```text
pagos_exchange
```

Routing key:

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
  "fecha": "2026-10-07T10:31:00Z"
}
```

---

# Pago rechazado

Evento:

```text
PagoRechazado
```

Exchange:

```text
pagos_exchange
```

Routing key:

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
  "fecha": "2026-10-07T10:32:00Z",
  "motivo": "Transaccion rechazada por la pasarela simulada"
}
```

---

# Simulación de la pasarela de pagos

El proyecto no está conectado a Stripe, Wompi, PayU, Mercado Pago, un banco ni otra pasarela financiera real.

Para poder demostrar ambos posibles resultados se utiliza un simulador controlado.

Por defecto:

```env
PAYMENT_REJECT_ORDER_IDS=
```

Todo pago válido será aprobado.

Para simular que una pasarela financiera rechazó un pedido específico:

```env
PAYMENT_REJECT_ORDER_IDS=1020
```

También pueden indicarse varios:

```env
PAYMENT_REJECT_ORDER_IDS=1020,1021,1022
```

Motivo:

```env
PAYMENT_REJECTION_REASON=Transaccion rechazada por la pasarela simulada
```

Si llega:

```text
pedidoId = 1020
```

el flujo será:

```text
PedidoCreado
     ↓
Pagos
     ↓
Simulator
     ↓
pedidoId configurado para rechazo
     ↓
RECHAZADO
     ↓
MySQL
     ↓
PagoRechazado
     ↓
pagos_exchange
```

El valor monetario del pedido no determina el resultado.

Un pago de valor alto puede ser aprobado y uno de valor bajo puede ser rechazado si así se configura durante la prueba.

---

# Diferencia entre rechazo y mensaje inválido

No deben confundirse.

## Pago rechazado

El pedido cumple el contrato y el simulador representa una respuesta negativa de la pasarela:

```text
Pedido válido
     ↓
procesamiento
     ↓
PagoRechazado
```

## Mensaje inválido

Ejemplos:

```text
pedidoId inválido
clienteId inválido
total inválido
JSON roto
evento incorrecto
```

Resultado:

```text
mensaje descartado
```

No genera:

```text
PagoRechazado
```

Los errores técnicos tampoco deben convertirse en pagos rechazados.

---

# Persistencia

Los pagos se almacenan en:

```text
db_pagos.pagos
```

Campos:

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

`pedido_id` tiene restricción `UNIQUE`.

Esto permite evitar crear múltiples registros cuando RabbitMQ vuelve a entregar el mismo pedido.

---

# Idempotencia

RabbitMQ trabaja con un modelo de entrega que puede producir reentregas.

Por esto Pagos evita duplicar registros utilizando:

```text
pedido_id UNIQUE
```

Si llega nuevamente el mismo pedido con los mismos datos, no se crea otra fila.

Si llega el mismo `pedidoId` con otro cliente o total, se considera un conflicto y se conserva el registro original.

---

# Confirmación de publicación

Después de procesar un pago, Pagos publica el resultado utilizando confirmaciones del broker.

La columna:

```text
evento_publicado
```

indica:

```text
0 = resultado todavía pendiente de confirmación
1 = RabbitMQ confirmó la publicación
```

`evento_publicado = 1` no significa que Reportes, Facturación o Notificaciones ya hayan procesado el evento.

Significa únicamente que RabbitMQ confirmó su publicación.

---

# Recuperación

Pagos puede recuperar resultados que quedaron almacenados pero no pudieron publicarse.

Comando:

```powershell
php bin\console.php recover
```

El consumidor también ejecuta recuperación periódica según:

```env
RECOVERY_INTERVAL=5
RECOVERY_BATCH=100
```

Esto ayuda a evitar perder resultados ante caídas temporales de RabbitMQ.

---

# Comandos disponibles

```text
check-db
setup
publish
consume
recover
observe
```

Ejemplos:

```powershell
php bin\console.php check-db
```

```powershell
php bin\console.php setup --demo-results
```

```powershell
php bin\console.php consume
```

```powershell
php bin\console.php observe
```

```powershell
php bin\console.php recover
```

Para publicar manualmente un `PedidoCreado` durante pruebas:

```powershell
php bin\console.php publish examples\pedido-aprobado.json
```

Esta herramienta sirve para pruebas y diagnóstico. En integración normal el evento debe provenir del microservicio de Pedidos.

---

# Atajo PowerShell

En Windows también puede utilizarse:

```powershell
.\pagos.ps1 consume
```

`pagos.ps1` localiza PHP y ejecuta:

```text
bin/console.php
```

Su uso es opcional.

---

# Interfaz web

Si el repositorio está ubicado en:

```text
C:\xampp\htdocs\E-commerce
```

puede abrirse:

```text
http://localhost/E-commerce/grupoB_Pagos/
```

Si el proyecto está directamente en:

```text
C:\xampp\htdocs\pagos
```

puede utilizarse:

```text
http://localhost/pagos/
```

Las vistas principales son:

- Pago
- Historial

---

# Modo de prueba web

Para desarrollo:

```env
WEB_TEST_ENABLED=1
```

permite utilizar funciones de prueba desde la interfaz.

Cuando el microservicio se encuentre integrado completamente con Pedidos puede utilizarse:

```env
WEB_TEST_ENABLED=0
```

La interfaz de prueba no sustituye el flujo real de RabbitMQ.

---

# Integración con Pedidos

Actualmente fue validada la comunicación:

```text
Pedidos
   ↓
pedidos_exchange
   ↓
pagos_pedidos_queue
   ↓
Pagos
```

El evento utilizado es:

```text
PedidoCreado
```

Pagos no consulta directamente la base de datos de Pedidos.

---

# Integración con Reportes

La integración con Grupo C fue probada utilizando el broker RabbitMQ compartido.

Reportes utiliza una cola propia:

```text
reportes_pagos_queue
```

y consume desde:

```text
pagos_exchange
```

con:

```text
pago.aprobado
pago.rechazado
```

Se verificó recepción de:

```text
PagoAprobado
PagoRechazado
```

Por lo tanto:

```text
Pagos
   ↓
pagos_exchange
   ├── pago.aprobado
   │        ↓
   │     Reportes
   │
   └── pago.rechazado
            ↓
         Reportes
```

Los pagos rechazados no se eliminan.

Reportes puede utilizarlos para estadísticas como:

```text
pagos aprobados
pagos rechazados
pagos pendientes
```

---

# Integración con Facturación

Facturación debe consumir únicamente:

```text
PagoAprobado
```

mediante:

```text
pagos_exchange
routing key: pago.aprobado
```

Un:

```text
PagoRechazado
```

no debe generar factura.

La integración completa con Facturación permanece pendiente de validación.

---

# Integración con Notificaciones

Notificaciones debería poder informar al usuario sobre:

```text
PagoAprobado
PagoRechazado
```

La integración completa con Notificaciones permanece pendiente de validación y ajuste de su topología RabbitMQ.

---

# Integración con otros consumidores

Cada microservicio debe utilizar su propia cola.

Ejemplo:

```text
                  pagos_exchange
                        │
           ┌────────────┼────────────┐
           ↓            ↓            ↓
     Facturación    Reportes   Notificaciones
       cola A        cola B        cola C
```

Nunca se debe utilizar una misma cola para varios microservicios que necesiten recibir todos los eventos, porque los consumidores competirían por los mensajes.

---

# Pruebas realizadas

Durante el desarrollo local se verificó:

- conexión a MySQL / MariaDB;
- validación del esquema;
- recepción de `PedidoCreado`;
- persistencia de pagos;
- `PagoAprobado`;
- `PagoRechazado`;
- rechazo configurable mediante `pedidoId`;
- aprobación independiente del valor monetario;
- descarte de mensajes inválidos;
- idempotencia por `pedido_id`;
- recuperación después de detener el consumidor;
- mensajes persistentes;
- ACK/NACK manual;
- publisher confirms;
- distribución a varias colas;
- interfaz de Pago;
- historial de pagos.

---

# Pruebas de integración compartida realizadas

Se verificó utilizando CloudAMQP compartido:

```text
Pedidos → Pagos
```

Resultado:

```text
PedidoCreado recibido y procesado correctamente.
```

También se verificó:

```text
Pagos → Reportes
```

para:

```text
PagoAprobado
```

y:

```text
PagoRechazado
```

Los dos eventos fueron recibidos correctamente por el microservicio de Reportes mediante RabbitMQ.

Estado actual:

```text
Pedidos → Pagos                     VALIDADO
Pagos → Reportes / aprobado         VALIDADO
Pagos → Reportes / rechazado        VALIDADO
Pagos → Facturación                 PENDIENTE
Pagos → Notificaciones              PENDIENTE
```

---

# Pruebas automáticas

Ejecutar:

```powershell
composer test
```

Las pruebas AMQP pueden ejecutarse mediante:

```powershell
php -d extension=sockets tests\rabbitmq.php
```

---

# Seguridad

Nunca versionar:

```text
.env
vendor/
credenciales de CloudAMQP
contraseñas de base de datos
certificados
archivos temporales
dumps de base de datos
```

El repositorio incluye:

```text
.env.example
```

únicamente como plantilla.

---

# Estado del proyecto

El microservicio Pagos tiene implementada y probada su lógica principal:

```text
PedidoCreado
     ↓
validación
     ↓
procesamiento de pago
     ↓
MySQL
     ↓
PagoAprobado / PagoRechazado
     ↓
RabbitMQ
```

Actualmente se encuentra integrado y validado con:

```text
Pedidos
Reportes
```

Queda pendiente completar las pruebas de integración con:

```text
Facturación
Notificaciones
```

y posteriormente validar el flujo completo de los microservicios del e-commerce.
## Seguridad web local y preparación del taller

El acceso operativo permite exclusivamente operador y administrador. El rol cliente recibe 403. La identidad y el rol proceden del JWT firmado; los formularios no los eligen. La configuración de HS256 y los nombres de claims son provisionales hasta acordar el contrato con Grupo F. Actualmente el validador admite HS256; otro algoritmo o claves públicas requerirán adaptar la validación, además de configurar sus claves.

Rutas públicas: GET login.php, GET health.php y GET ready.php. POST auth-session.php valida el Bearer, el rol y el CSRF de login antes de crear la sesión. index.php, history.php, pending.php, client.php, decide.php y secure-test.php requieren operador o administrador. result.php conserva su redirección al panel protegido. POST logout.php requiere CSRF y destruye sesión y cookie. Los helpers cuyo nombre comienza por _ no son endpoints y Apache impide su acceso directo.

La sesión conserva el JWT en el servidor y lo revalida en cada petición. La cookie es HttpOnly, SameSite Strict y Secure bajo HTTPS. El login regenera el identificador y el CSRF. Los fetch usan same-origin. No se guardan tokens en localStorage ni en URLs. La autenticación HTTP no cambia las credenciales ni los contratos de RabbitMQ.

### Prueba local desde PowerShell

Con Apache y MySQL de XAMPP activos:

```powershell
Set-Location C:\xampp\htdocs\E-commerce\grupoB_Pagos
$php = 'C:\xampp\php\php.exe'
& $php 'C:\ProgramData\ComposerSetup\bin\composer.phar' test
$tokens = & $php tests/generate_tokens.php
($tokens | Where-Object { $_ -like 'OPERADOR=*' }) -replace '^OPERADOR=', '' | Set-Clipboard
Start-Process 'http://localhost/E-commerce/grupoB_Pagos/public/login.php'
```

Pegar el token e ingresar. Abrir pendientes, seleccionar un pedido y consultar el cliente y el historial. Pagar o Rechazar modifica el pago seleccionado y publica el resultado real: hacerlo únicamente con un pedido de laboratorio acordado. Cerrar sesión mediante el botón y comprobar que una ruta protegida vuelve a responder 401. Repetir con ADMINISTRADOR y comprobar que CLIENTE recibe 403. El generador es exclusivamente CLI de desarrollo, usa la configuración local y emite tokens de una hora; no es un servicio de login del Grupo F. No compartir ni versionar su salida.

Para mantener el consumidor real, ejecutar en otra terminal únicamente cuando se quiera participar en la integración:

```powershell
Set-Location C:\xampp\htdocs\E-commerce\grupoB_Pagos
& 'C:\xampp\php\php.exe' bin/console.php consume
```

Los tests auth.php y auth-web.php usan claves efímeras. auth-web.php inicia un servidor temporal de PHP y bloquea MySQL y RabbitMQ mediante configuración exclusiva del proceso. composer test solo comprueba el aislamiento RabbitMQ; no ejecuta publicaciones contra el broker de los grupos. tests/manual.php es opt-in mediante PAGOS_TEST_DSN, PAGOS_TEST_USER y PAGOS_TEST_PASSWORD: crea únicamente una tabla temporal en su conexión. Las comprobaciones de Clientes de la suite no invocan RPC real.

secure-test.php permite demostrar JWT durante el taller. No publica secretos. Se excluye de la imagen Docker y debe excluirse también de un despliegue final fuera de Docker.

### Imagen de laboratorio

Se eligió PHP 8.2 con Apache de la imagen oficial por su proximidad al entorno XAMPP. DocumentRoot es public; Apache reenvía Authorization y bloquea helpers. La imagen instala dependencias desde composer.lock y no incorpora .env, tests, secretos ni archivos del repositorio Git. Web y consumer reutilizan la misma imagen, con procesos separados.

```powershell
docker build -t pagos:lab-jwt-v1 .
docker run --rm --name pagos-web-lab -p 8080:80 --env-file .env pagos:lab-jwt-v1
```

Abrir http://localhost:8080/login.php. Dentro de un contenedor, DB_HOST=127.0.0.1 apunta al propio contenedor: ajustar la configuración del laboratorio, por ejemplo host.docker.internal para MySQL de Docker Desktop, sin modificar las credenciales del broker compartido. No ejecutar un segundo consumidor contra el broker compartido sin coordinarlo.

### Kubernetes de laboratorio

Los manifiestos son una preparación: requieren Docker, kubectl, un clúster local y acceso de los Pods a MySQL y RabbitMQ. No se han construido imágenes ni desplegado recursos automáticamente.

```powershell
kubectl create namespace ecommerce --dry-run=client -o yaml | kubectl apply -f -
Copy-Item k8s/secret.example.yaml k8s/secret.local.yaml
notepad k8s/secret.local.yaml
notepad k8s/pagos.yaml
docker build -t pagos:lab-jwt-v1 .
```

Completar secret.local.yaml localmente con DB_USER, DB_PASSWORD, RABBITMQ_URL y JWT_SECRET. Este archivo está ignorado. Completar DB_HOST y JWT_ISSUER según el entorno acordado en el ConfigMap. El template de Secret contiene valores vacíos y no debe aplicarse como configuración funcional. No usar kubectl apply -f k8s/ porque incluiría el template vacío.

Docker Desktop Kubernetes puede utilizar la imagen local. Si se usa Minikube, cargarla antes:

```powershell
minikube image load pagos:lab-jwt-v1
kubectl apply -f k8s/secret.local.yaml
kubectl apply -f k8s/pagos.yaml
kubectl rollout status deployment/pagos-web -n ecommerce
kubectl rollout status deployment/pagos-consumer -n ecommerce
kubectl get pods,services -n ecommerce
kubectl port-forward service/pagos-web 8080:80 -n ecommerce
```

Abrir http://localhost:8080/login.php. El consumer ejecuta php bin/console.php consume y no recibe JWT_SECRET. El Deployment web mantiene una sola réplica y estrategia Recreate porque las sesiones PHP son locales: reiniciar el Pod cierra las sesiones; escalar web requiere primero almacenamiento compartido de sesiones. Los Secrets no cifran por sí solos toda la configuración del clúster: restringir su acceso y nunca versionar valores reales.

health.php comprueba PHP/HTTP sin conexiones externas y se usa para liveness. ready.php verifica MySQL con SELECT 1, devuelve 503 sin detalles ante fallo y se utiliza para readiness web. No garantiza disponibilidad del RPC de Clientes o RabbitMQ. Las probes del consumer solo comprueban la presencia de su proceso; no certifican la conexión al broker ni detectan todos los bloqueos del bucle. Sus errores fatales hacen terminar el proceso y Kubernetes lo reinicia.

Tras desplegar y coordinar la prueba, eliminar únicamente un Pod propio y observar su reemplazo:

```powershell
$pod = kubectl get pod -n ecommerce -l app=pagos-web -o jsonpath='{.items[0].metadata.name}'
kubectl delete pod $pod -n ecommerce
kubectl get pods -n ecommerce -w
```

Volver a iniciar sesión después del reemplazo y repetir una consulta. La prueba integrada de decisiones y recuperación con RabbitMQ queda para el entorno coordinado; no se ejecuta en composer test.
