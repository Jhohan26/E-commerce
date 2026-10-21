# Carrito de compras (Grupo D) · FastAPI + RabbitMQ

Guía rápida para **ejecutar** el carrito (local, Docker, Kubernetes), **probar su seguridad** y **enlazarlo con los demás grupos**.
Comandos para Windows (PowerShell o CMD) dentro de la carpeta `grupoD_Carro`.

| Forma de ejecutarlo | Dirección |
| --- | --- |
| Local con Python | http://localhost:8000 |
| Docker | http://localhost:8000 |
| Kubernetes (con `port-forward`) | http://localhost:8080 |
| Documentación interactiva de la API | `/docs` en cualquiera de las anteriores |

---

## 1. Configuración (`.env`)

```
copy .env.example .env
```
Edita `.env` y completa:

| Variable | Qué poner |
| --- | --- |
| `CLOUDAMQP_URL` | URL del broker. **Debe ser la misma instancia que usan los demás grupos.** |
| `PRODUCTOS_USUARIO` / `PRODUCTOS_PASSWORD` | Usuario de servicio del carrito ante `productos.login` (JWT de Productos, vía `cliente_rpc.py`). |
| `API_USUARIO` / `API_PASSWORD` | Usuario de servicio del carrito ante `auth.login` (lo crea el Grupo F). |
| `JWT_SECRET` | Clave compartida con la que el Grupo F firma los JWT. |
| `PEDIDOS_USAR_JWT` | `true` envía el JWT de servicio a Pedidos. `false` es un interruptor de emergencia. |
| `SIMULAR_CLIENTES` | `true` simula solo el cliente 25; el resto se consulta al worker real. |

> El `.env` debe guardarse con saltos de línea **LF** (en VS Code: esquina inferior derecha, `CRLF` → `LF`). Con CRLF, Docker y Kubernetes dejan un `\r` al final de cada valor.
> No subas el `.env` al repositorio ni lo compartas.

---

## 2. Ejecución local (Python)

```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```
Abre http://localhost:8000, escribe el id de un cliente y compra.
Comprobación: http://localhost:8000/health debe responder `{"status":"ok"}`.

---

## 3. Docker

Requiere **Docker Desktop abierto** (indicador *Engine running*). Detén `uvicorn` antes, porque usan el mismo puerto.

```
docker build -t carrito-grupod:1.0.0 .
docker run -d --name carrito -p 8000:8000 --env-file .env carrito-grupod:1.0.0
docker ps
curl http://localhost:8000/health
docker logs carrito
```
Esperado: el contenedor en `Up ... (healthy)` y `/health` respondiendo.

Comprobar que no hay secretos dentro de la imagen (no debe aparecer `.env`):
```
docker run --rm carrito-grupod:1.0.0 ls -a /app
```

Alternativa con Docker Compose:
```
docker compose up --build
docker compose down
```

Detener y borrar el contenedor:
```
docker rm -f carrito
```

---

## 4. Kubernetes

### 4.1 Clúster

**Docker Desktop** (*Settings → Kubernetes → Enable Kubernetes*, tipo **Kubeadm**):
```
kubectl config use-context docker-desktop
kubectl cluster-info
kubectl get nodes
```

**Minikube** (alternativa):
```
minikube start
kubectl cluster-info
kubectl get nodes
minikube image load carrito-grupod:1.0.0
```
Con Docker Desktop no hace falta cargar la imagen: ya la ve.

### 4.2 Namespace y Secret

```
kubectl apply -f k8s/namespace.yaml
kubectl create secret generic carrito-secret -n ecommerce --from-literal=CLOUDAMQP_URL="amqps://..." --from-literal=API_USUARIO="modulo_carro" --from-literal=API_PASSWORD="..." --from-literal=PRODUCTOS_USUARIO="productos" --from-literal=PRODUCTOS_PASSWORD="..." --from-literal=JWT_SECRET="..."
kubectl get secret -n ecommerce
```
(El Secret se crea por comando a propósito: así ningún archivo del repositorio contiene credenciales.)

### 4.3 Despliegue

```
kubectl apply -f k8s/
kubectl get deployments,pods,services -n ecommerce
kubectl get pods -n ecommerce -w
```
Esperado: Deployment `1/1`, Pod `Running 1/1` y Service `carrito`. Sal del `-w` con Ctrl + C.

Si el Pod no arranca:
```
kubectl describe pod NOMBRE_POD -n ecommerce
kubectl logs NOMBRE_POD -n ecommerce
```

### 4.4 Acceder desde tu máquina

En otra terminal, déjala abierta:
```
kubectl port-forward svc/carrito 8080:8000 -n ecommerce
```
Abre http://localhost:8080 y prueba http://localhost:8080/health.

### 4.5 Recuperación ante fallos

```
kubectl get pods -n ecommerce
kubectl delete pod NOMBRE_POD -n ecommerce
kubectl get pods -n ecommerce -w
```
Kubernetes crea un Pod nuevo que queda `Running 1/1` en segundos. Reinicia el `port-forward` (se corta al borrar el Pod) y repite `/health`.
Los carritos en curso se pierden porque viven en memoria; un pedido ya enviado a Pedidos no se pierde.

### 4.6 Si cambias el Secret o la imagen

```
kubectl delete secret carrito-secret -n ecommerce
kubectl create secret generic carrito-secret -n ecommerce --from-literal=CLOUDAMQP_URL="..." --from-literal=API_USUARIO="..." --from-literal=API_PASSWORD="..." --from-literal=PRODUCTOS_USUARIO="productos" --from-literal=PRODUCTOS_PASSWORD="..." --from-literal=JWT_SECRET="..."
kubectl rollout restart deployment/carrito -n ecommerce
```

### 4.7 Limpieza

```
kubectl delete -f k8s/
kubectl delete secret carrito-secret -n ecommerce
```

---

## 5. Pruebas

### Automáticas (no necesitan RabbitMQ)
```
pip install -r requirements-dev.txt
python -m pytest -q
```
Esperado: `36 passed`.

### Postman (seguridad)
```
python scripts/generar_tokens.py --postman
```
1. Importa `postman/Carrito_Seguridad.postman_collection.json` y `postman/Carrito_local.postman_environment.json`.
2. Selecciona el environment **Carrito - local** (arriba a la derecha).
3. Ajusta `base_url`: `http://localhost:8000` (local o Docker) o `http://localhost:8080` (Kubernetes).
4. Ejecuta la colección con **Runner**. Las carpetas 1 a 7 no necesitan RabbitMQ; la 8 (pedido real) sí.

Códigos esperados: público `200` · sin token `401` · token válido `200` · token alterado `401` · token vencido `401` · rol no autorizado `403` · rol autorizado `200/201`.
Los tokens de prueba duran 1 hora; si todo da 401, vuelve a ejecutar `generar_tokens.py --postman` y reimporta el environment.

---

## 6. Integración con los demás grupos

### 6.1 Cómo se conecta el carrito con la plataforma

El carrito **no usa HTTP** para hablar con otros microservicios: todo va por **RabbitMQ (CloudAMQP)**. Por eso, para enlazarse solo se necesita
que todos usen **la misma instancia de CloudAMQP** y respeten las colas y formatos de abajo.

```
                    ┌──────────── CloudAMQP (misma instancia para todos) ────────────┐
 Usuario ──HTTP──►  │                                                                 │
   Carrito ──RPC──► auth.login           (Grupo F: autenticación)                      │
   Carrito ──RPC──► cliente.consultar    (Grupo de Clientes)     + JWT de servicio     │
   Carrito ──RPC──► productos.listar     (Grupo G: Productos)                          │
   Carrito ──RPC──► pedidos.desde_carro  (Grupo E: Pedidos)      + JWT de servicio     │
   Pedidos ──evento► pedidos_exchange / pedido.creado ──► Notificaciones, Facturación… │
                    └─────────────────────────────────────────────────────────────────┘
```
El carrito **no publica** el evento `PedidoCreado`: lo publica Pedidos después de guardar el pedido.

### 6.2 Convención RPC que usa el carrito

Para cada llamada el carrito:
- publica en la cola indicada (exchange por defecto, `routing_key` = nombre de la cola);
- envía `reply_to` (cola de respuesta temporal) y `correlation_id`;
- pone el JWT en **las cabeceras del mensaje** (`headers["Authorization"] = "Bearer <token>"`), **nunca en el cuerpo**;
- espera una respuesta JSON publicada en `reply_to` con el mismo `correlation_id`.

Forma de la respuesta que el carrito entiende:
```json
{ "status": 200, "data": { ... }, "error": "texto opcional si status no es 2xx" }
```

### 6.3 Contratos por servicio

| Cola | Quién la atiende | El carrito envía | El carrito espera | Auth | Espera máx. |
| --- | --- | --- | --- | --- | --- |
| `auth.login` | Grupo F | `{"usuario","password"}` | `status 200` y `data: {"token", "expira_en_segundos"}` | – | 10 s |
| `cliente.consultar` | Clientes | `{"id": 3}` | `200` con `data: {id, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, correo, estado}` · `404` si no existe · `401` si el token no sirve | Bearer | 10 s |
| `productos.login` | Productos | `{usuario, password}` | `200` con `data.token` (JWT) | — | 4 s |
| `productos.listar` | Productos | cuerpo vacío | `200` con `data: [{id, nombre, precio, imagen_url, descripcion, categoria_id, categoria}]` | **Sí** (`Authorization: Bearer`, vía `cliente_rpc.py`) | 4 s |
| `pedidos.desde_carro` | Pedidos | ver abajo | `200/201` con `data: {pedidoId, clienteId, fecha, total}` | Bearer | 15 s |

Cuerpo que recibe Pedidos en `pedidos.desde_carro`:
```json
{
  "clienteId": 3,
  "clienteNombre": "Ana Pérez",
  "productos": [ { "productoId": 1, "cantidad": 2, "precio": 2500000 } ]
}
```
`clienteNombre` es informativo (Pedidos puede ignorarlo). Si Pedidos responde `401/403`, el carrito muestra un error claro y conserva el carrito del usuario.
Si responde otro estado de error, el carrito muestra el texto de `error`.

Evento que debe publicar **Pedidos** al crear el pedido (el carrito no lo emite):
- exchange `pedidos_exchange`, routing key `pedido.creado`
- `{"evento":"PedidoCreado","pedidoId":…,"clienteId":…,"fecha":…,"total":…,"productos":[…]}`

### 6.4 Autenticación: qué necesita cada grupo

Hay **dos tokens distintos**; no se mezclan ni se reenvían:

| Token | Lo usa | Para qué |
| --- | --- | --- |
| **JWT de servicio** del carrito (usuario `API_USUARIO`) | El carrito → Clientes y Pedidos | Que esos servicios sepan que quien llama es el módulo Carrito. Va en la cabecera del mensaje RPC. |
| **JWT de usuario final** (cliente, operador, administrador) | Un usuario o servicio → API HTTP del carrito | Para usar `/api/carrito/...`. Va en `Authorization: Bearer <JWT>`. |

Las credenciales de RabbitMQ (`CLOUDAMQP_URL`) son un tercer control, independiente de los JWT. El token de un cliente **nunca** se envía como credencial de RabbitMQ.

### 6.5 Checklist por grupo

**Grupo F (autenticación)**
- [ ] Crear en su fuente de usuarios el usuario de servicio del carrito (`API_USUARIO` / `API_PASSWORD`) y compartirlo con el Grupo D por un canal privado.
- [ ] Compartir con todos los grupos la **clave de firma** (`JWT_SECRET`) por un canal privado, nunca en el repositorio.
- [ ] Confirmar el algoritmo (el carrito asume **HS256**) y los nombres de los claims.
- [ ] Informar si el token trae emisor (`iss`) para configurar `JWT_ISSUER`.

El JWT de usuario final que el carrito acepta debe llevar:

| Claim | Obligatorio | Detalle |
| --- | --- | --- |
| `sub` | Sí | Identificador del usuario. |
| `exp` | Sí | Vencimiento (epoch). Sin `exp` el token se rechaza. |
| `rol` (o `role`) | Sí | `cliente`, `operador` o `administrador`. |
| `cliente_id` | Para clientes | Id del cliente dueño del carrito. Si falta, se usa `sub` cuando es numérico. |
| `iss` | Opcional | Se valida solo si el carrito define `JWT_ISSUER`. |

Si usan otros nombres, se cambian con variables de entorno sin tocar código: `JWT_CLAIM_ROL`, `JWT_CLAIM_CLIENTE_ID`, `JWT_ISSUER`, `JWT_ALGORITHM`.

**Grupo de Pedidos**
- [ ] Escuchar la cola `pedidos.desde_carro` en la **misma** instancia de CloudAMQP (en su consola debe verse `[Consumidor Carro] Escuchando...`).
- [ ] Leer el token en la **cabecera** `Authorization` del mensaje y validarlo (firma, `exp`) con la misma clave compartida.
- [ ] Autorizar al usuario de servicio del carrito para crear pedidos. Si no lo permite, responder `{"status": 403, "error": "..."}`; si el token no sirve, `{"status": 401}`.
- [ ] Responder `status 201` con `data: {pedidoId, clienteId, fecha, total}`.
- [ ] Publicar el evento `PedidoCreado` en `pedidos_exchange` con routing key `pedido.creado`.

**Grupo de Clientes**
- [ ] Mantener la cola `cliente.consultar` y exigir el Bearer en la cabecera (el carrito renueva el token y reintenta una vez si recibe `401`).
- [ ] Devolver `404` para clientes inexistentes y el campo `estado` (el carrito no deja comprar si `estado == 0`).

**Grupo de Productos**
- [ ] Mantener `productos.login` y la cola `productos.listar` (ahora con JWT; el carrito se autentica con `PRODUCTOS_USUARIO`/`PRODUCTOS_PASSWORD` usando `cliente_rpc.py`). El carrito refresca el catálogo cada 5 s y, si Productos está apagado, usa el último catálogo conocido.

**Notificaciones, Facturación, Inventario, Pagos, Reportes**
- [ ] Consumir `PedidoCreado` desde `pedidos_exchange` / `pedido.creado`. **No dependen del carrito**: no hay que llamarlo.

### 6.6 Si otro servicio quiere llamar a la API HTTP del carrito

Dentro del clúster (namespace compartido `ecommerce`):
```
http://carrito.ecommerce.svc.cluster.local:8000        (desde otro namespace)
http://carrito:8000                                    (desde el mismo namespace)
```

| Endpoint | Acceso |
| --- | --- |
| `GET /health`, `GET /ready` | Público |
| `GET /api/productos` | Público |
| `GET /api/carrito/{cliente_id}` | cliente (solo el suyo) · administrador |
| `POST /api/carrito/{cliente_id}/items` | cliente (solo el suyo) |
| `DELETE /api/carrito/{cliente_id}/items/{producto_id}` | cliente (solo el suyo) |
| `DELETE /api/carrito/{cliente_id}` | cliente (solo el suyo) |
| `POST /api/carrito/{cliente_id}/pedido` | cliente (solo el suyo) |

Ejemplo (el cuerpo para agregar un producto es `{"producto_id": 1, "cantidad": 2}`):
```
curl -H "Authorization: Bearer <JWT>" http://localhost:8000/api/carrito/3
curl -X POST -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" -d "{\"producto_id\":1,\"cantidad\":2}" http://localhost:8000/api/carrito/3/items
curl -X POST -H "Authorization: Bearer <JWT>" http://localhost:8000/api/carrito/3/pedido
```
Códigos: `401` sin token, inválido o vencido · `403` rol no permitido o carrito de otro cliente · `404` no existe · `409` carrito vacío · `502` Pedidos o Clientes no responden (el carrito se conserva) · `503` falta `JWT_SECRET`.

### 6.7 Prueba de integración de extremo a extremo

Con la plataforma completa encendida (Clientes, Productos, Pedidos, auth) y todos en la misma instancia de CloudAMQP:

1. Obtén un token de cliente con el módulo de autenticación del Grupo F.
2. Agrega un producto: `POST /api/carrito/{id}/items` → `201`.
3. Crea el pedido: `POST /api/carrito/{id}/pedido` → `201` con `pedidoId`.
4. Confirma en los logs de Pedidos que recibió la solicitud con el token y que publicó `PedidoCreado`.
5. Confirma en los logs de Notificaciones o Facturación que consumieron el evento.
6. Repite sin token → `401`, y con un token de operador → `403`.

---

## 7. Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `"docker" no se reconoce` | Docker Desktop no instalado o no abierto | Instálalo/ábrelo y usa una terminal nueva. |
| Todo da `401` en Postman | `JWT_SECRET` distinto entre servidor y tokens, o tokens de más de 1 h | Reinicia el servidor, regenera los tokens y reimporta el environment. |
| Todo da `503` | `JWT_SECRET` vacío | Complétalo en `.env` (o en el Secret) y reinicia. |
| Pod en `ImagePullBackOff` / `ErrImagePull` | Kubernetes no ve la imagen | Con Docker Desktop usa clúster **Kubeadm**; con Minikube ejecuta `minikube image load carrito-grupod:1.0.0`. |
| Pod en `CreateContainerConfigError` | Falta el Secret | Ejecuta el paso 4.2. |
| "Pedidos rechazó la autenticación del carrito" | Pedidos no acepta el usuario de servicio | Revisa `API_USUARIO`/`API_PASSWORD` y su permiso; para aislar el problema prueba `PEDIDOS_USAR_JWT=false`. |
| "No se pudo enviar el pedido … no respondió a tiempo" | Pedidos apagado o en otra instancia de CloudAMQP | Verifica que escuche en `pedidos.desde_carro` y que use tu mismo `CLOUDAMQP_URL`. |
| El `port-forward` se cortó | Se borró o reinició el Pod | Vuelve a ejecutarlo. |
