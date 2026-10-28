# Grupo C: Reportes en el computador compartido

## Objetivo y alcance

Ejecutar todos los grupos en un clúster Kubernetes local en una misma PC.
Cada grupo conserva sus servicios y datos; Kubernetes administra los contenedores,
la red interna, los reinicios y los volúmenes. Grupo C aporta aquí su despliegue
y el diagnóstico de integración. Todos los archivos de esta entrega están dentro
de `grupoC_Reportes`. No se cambiaron archivos de otros grupos ni el `.env`.

Un clúster puede contener varios namespaces. No es necesario cambiar todos los
grupos al mismo namespace para que se comuniquen. En el navegador se utiliza
localhost con un puerto publicado; entre Pods se utiliza el DNS del Service.

## Diagnóstico del repositorio (27 de octubre de 2026)

| Grupo | Preparación encontrada | Acceso interno observado / pendiente |
| --- | --- | --- |
| B Pagos | `k8s/comun`, MySQL, web y consumidor | `pagos-web.ecommerce.svc.cluster.local:80` |
| C Reportes | Este paquete, Dockerfile existente | `reportes.reportes.svc.cluster.local:8001` |
| D Carrito | Manifiestos en `k8s` | `carrito.carrito.svc.cluster.local:8000` |
| E Pedidos | `k8s/deploy.ps1`, MySQL y aplicación | `pedidos-web.pedidos.svc.cluster.local:3001` |
| F Clientes | `k8s/deploy.ps1`, MySQL, web y worker | `web.clientes.svc.cluster.local:8081`; RPC por broker |
| G Productos | `k8s/deploy.ps1`, MySQL, backend, frontend y worker | `backend.productos.svc.cluster.local:3000`; RPC por broker |
| H Inventario | Dockerfile y Compose con MySQL, API y worker; sin manifiestos Kubernetes encontrados | Falta preparar Service, API, worker, Secret y volumen para su base |
| J Notificaciones | Manifiestos, configuración y almacenamiento en `k8s` | `notificaciones.ecommerce.svc.cluster.local:3000` |
| K Facturación | Compose levanta RabbitMQ y MySQL; no la aplicación | Falta empaquetar aplicación/consumidor y preparar su despliegue |

Esta tabla describe archivos revisados, no servicios comprobados en ejecución.
No ejecutar `kubectl apply` sobre todo el repositorio: hay plantillas de secretos,
opciones antiguas y configuraciones alternativas que no deben mezclarse.

## Preparar la PC

1. Instalar Docker Desktop con contenedores Linux y habilitar Kubernetes.
2. Verificar el contexto destino con `kubectl config get-contexts`. Este paquete
   usa explícitamente `docker-desktop` y no cambia el contexto global.
3. Comprobar que hay una StorageClass predeterminada: `kubectl --context docker-desktop get storageclass`.
4. Instalar los servicios de cada grupo siguiendo sus instrucciones propias.
   Clientes y Productos necesitan sus workers, no basta con abrir su web.
5. Acordar una misma URL **y vhost** RabbitMQ para todos. No arrancar un broker
   aislado para cada grupo esperando que sus eventos lleguen a los demás.

No se fija un mínimo de RAM como garantía: hay varias bases MySQL y workers;
medir consumo real con Docker Desktop y ajustar recursos antes de la demostración.
Docker Desktop permite un clúster local; otras opciones requieren cargar las
imágenes en el runtime del clúster (por ejemplo `kind load docker-image`).
El instalador de este paquete está pensado para Docker Desktop con imágenes
locales disponibles; otros provisionadores pueden necesitar un registro o carga adicional.

Referencia: [Kubernetes en Docker Desktop](https://docs.docker.com/desktop/use-desktop/kubernetes/).

## Configuración privada de Reportes

Conservar el `.env` existente. Completar `AMQP_URL` y las cuentas RPC que entregan
Clientes, Productos e Inventario. No copiar claves privadas desde otros grupos.
`kubectl --from-env-file` requiere líneas `CLAVE=valor`: usar valores sin comillas,
sin `export` ni comentarios al final del valor. No publicar ni imprimir el Secret.

El ConfigMap prevalece sobre el `.env` para las URLs internas, los modos RPC y
el refresco. Así no se usan accidentalmente los localhost de desarrollo.
`PEDIDOS_TOKEN`, si existe en `.env`, sigue prevaleciendo en la lógica de la API;
dejarlo vacío para solicitar el token automáticamente con rol operador.
Inventario puede consultarse por RPC; su respaldo HTTP queda sin URL hasta que
exista un endpoint accesible. Para cambios de topología editar `reportes.yaml`.

## Instalar únicamente Grupo C

Desde `grupoC_Reportes`, en PowerShell:

```powershell
.\k8s\deploy.ps1 -Accion Validar
.\k8s\deploy.ps1 -Accion Instalar
.\k8s\deploy.ps1 -Accion Estado
.\k8s\deploy.ps1 -Accion Abrir
```

Abrir **http://127.0.0.1:8001**. `Abrir` mantiene un port-forward en esa terminal.
`Validar` revisa herramientas, configuración y acceso al clúster; no prueba cuentas
RPC ni garantiza espacio disponible. `Instalar` construye `reportes:cluster-v1`,
crea/actualiza el Secret desde `.env` y aplica solo recursos del namespace
`reportes`. Necesita descargar la imagen base y dependencias al construir.

Antes de instalar, detener cualquier otra instancia de Reportes que consuma
las mismas colas: si hay dos, RabbitMQ reparte los eventos y cada copia puede
quedar incompleta. No ejecutar simultáneamente Reportes en Python o Compose.

El PVC conserva `/app/datos` al reemplazar el Pod. No importa automáticamente
`datos/respaldo.json` de Windows: si se necesita ese histórico, respaldarlo y
coordinar su copia antes de empezar a consumir eventos. No borrar el PVC ni
el namespace para reiniciar la aplicación. El despliegue usa una réplica y
estrategia Recreate porque el estado está en memoria y en un JSON local.

## Comprobar integración

```powershell
kubectl --context docker-desktop -n reportes logs deployment/reportes --tail=100
kubectl --context docker-desktop -n reportes get pods,pvc
```

Con el port-forward activo, revisar `/api/estado` y el dashboard: comprobar
Clientes, Productos, Pedidos, Inventario y RabbitMQ. Un Pod Ready indica que
la API responde; no demuestra que los servicios externos estén conectados.
Coordinar un pedido de laboratorio, su pago y su factura; verificar los cambios
en Reportes y que reiniciar el Pod conserve el respaldo. No publicar eventos de
prueba en colas compartidas sin coordinar los datos del ensayo.

## Trabajo pendiente para ejecutar absolutamente todos los grupos

- Preparar desde Grupo C, o solicitar a sus responsables, los paquetes Kubernetes
  de H y K usando sus imágenes, esquema y configuración actuales como referencia.
- Confirmar el contrato de pagos: Reportes contempla `ecommerce.eventos` y
  `pagos_exchange`, pero cada consumidor debe estar enlazado al exchange real.
- Resolver las firmas, roles y cuentas JWT que cada integración requiera;
  compartir una PC no convierte los tokens de un grupo en válidos para otro.
- Verificar la carga de esquemas/datos y la disponibilidad de imágenes en la PC.
- Ejecutar allí una prueba completa de compra con todos los consumidores activos.

Esta entrega deja preparado Grupo C. No es todavía un instalador de todos los
grupos. En el entorno de preparación no se encontraron `docker` ni `kubectl` en
PATH, por lo que no se construyó la imagen ni se desplegó el clúster.
