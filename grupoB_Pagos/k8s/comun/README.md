# Instalar Pagos en el computador comun de Clientes

Esta es la instalacion recomendada para el unico computador que ejecutara todos los microservicios. Incluye MySQL propio dentro del cluster, esquema inicial, almacenamiento persistente, web y consumidor de Pagos. No depende de XAMPP ni accede a tablas de Clientes. No ejecuta scripts de otros grupos.

La configuracion antigua de `k8s/pagos.yaml` se conserva para la instalacion local anterior. Para el computador comun usar solamente el script de esta carpeta. No ejecutar `kubectl apply -f k8s/` ni mezclar ambas opciones.

## Preparacion en el computador de Clientes

Requisitos: Docker Desktop encendido, Kubernetes habilitado en el contexto `docker-desktop`, kubectl, PowerShell, acceso a Internet y una StorageClass predeterminada para el volumen de MySQL. Clientes, Pedidos y el resto de consumidores necesarios deben estar activos durante las pruebas de integracion.

Actualizar el repositorio compartido sin sobrescribir trabajo local pendiente y entrar a `grupoB_Pagos`. No es necesario instalar PHP ni Composer en Windows: se incluyen en la imagen.

```powershell
Set-Location RUTA\E-commerce\grupoB_Pagos
Copy-Item .env.k8s.example .env.k8s
notepad .env.k8s
```

Completar estos valores en privado, sin subir el archivo a GitHub:

| Variable | Que colocar |
| --- | --- |
| DB_USER | `pagos`, cuenta exclusiva de esta base. |
| DB_PASSWORD | Una contrasena nueva para MySQL de Pagos. |
| MYSQL_ROOT_PASSWORD | Otra contrasena nueva para administrar este MySQL. |
| RABBITMQ_URL | URL del broker y vhost compartidos acordados con Pedidos y Clientes. |
| JWT_SECRET | Clave de verificacion acordada para el JWT de usuario. Minimo 32 caracteres. Mientras se use acceso manual de laboratorio, utilizar una clave privada de Pagos configurada aqui. |
| CLIENT_AUTH_USER | La cuenta de servicio entregada por Clientes, por ejemplo `modulo_pagos`. |
| CLIENT_AUTH_PASSWORD | Su contrasena, entregada por canal privado. |
| JWT_ISSUER | Vacio mientras autenticacion no emita `iss`; despues, el valor exacto acordado. |

Estas claves y contrasenas son distintas: la clave JWT no es la contrasena de la cuenta de servicio ni la contrasena del broker. No copiar credenciales publicadas en archivos de otros grupos como supuesto acuerdo de autenticacion.

El namespace es `ecommerce`; puede convivir con `clientes`, `productos` y `carrito` en el mismo cluster. Todos los recursos de este paquete usan nombres propios de Pagos. El script crea `pagos-secret`; ya no necesita el Secret adicional `pagos-clientes-secret` de la instalacion anterior.

## Instalacion y comprobacion

Antes de iniciar el nuevo consumidor, detener cualquier consumidor de Pagos en otros equipos que use `pagos_pedidos_queue`. Si hay dos conectados a la misma cola, se repartiran los pedidos y sus bases locales quedaran incompletas.

```powershell
.\k8s\comun\deploy.ps1 -Accion Validar
.\k8s\comun\deploy.ps1
.\k8s\comun\deploy.ps1 -Accion Estado
```

El script valida las variables sin mostrarlas, construye `pagos:cluster-v1`, prepara el esquema, inicia MySQL, espera su disponibilidad e instala la web y el consumidor con la misma imagen. Actualiza exclusivamente los recursos propios de Pagos. Al final comprueba esquema, salud y disponibilidad HTTP. El consumidor puede crear la topologia de Pagos y procesar pedidos reales del broker al arrancar.

Abrir `http://localhost:8086/login.php` en ese computador. El Service interno es `http://pagos-web.ecommerce.svc.cluster.local`. Los otros equipos no acceden al `localhost` de Clientes; para navegadores remotos se necesita una exposicion de red acordada. Dentro del cluster se utiliza el nombre DNS interno.

Si el puerto 8086 ya tiene otro proceso o un port-forward anterior, detener ese acceso anterior antes de instalar. El paquete lo publica mediante un Service LoadBalancer de Docker Desktop, sin mantener una terminal de port-forward abierta.

## Acceso manual de laboratorio

El despliegue no cambia la validacion de JWT ni asigna un rol automaticamente a tokens sin rol. El login de servicio de Clientes revisado emite un JWT sin `role` ni `iss`, y su firma no coincidia con Pagos. Que ambos servicios esten en el mismo cluster no resuelve ese contrato. La consulta de nombres usa el token de servicio de Clientes directamente y no requiere que sea un JWT de usuario aceptado por Pagos.

Hasta acordar la firma y los claims del token de usuario, generar un token manual en el computador del cluster:

```powershell
kubectl --context docker-desktop -n ecommerce exec deployment/pagos-web -- php bin/lab-token.php operador
```

Copiar solamente el JWT y pegarlo en Acceso temporal de desarrollo. Dura una hora. Es una herramienta CLI de laboratorio, no un endpoint publico ni una demostracion de login centralizado. Para Postman tambien permite los roles `administrador` y `cliente`; agregar `--expired` permite comprobar expiracion. No guardar los tokens en GitHub.

La coleccion y la guia de seguridad estan en `postman/`. Cambiar su `base_url` si se accede por otra direccion. Probar 200 para salud, 401 sin token, 401 con firma alterada o expiracion, 403 con cliente y 200 con operador o administrador. Pagar y Rechazar si modifican pedidos y publican eventos: usar solamente pedidos de laboratorio coordinados.

## Datos y mantenimiento

MySQL usa un volumen persistente de 2 GiB: `datos-pagos-mysql-0`. Su esquema se inicializa al crear un volumen vacio. Este paquete no incluye datos de clientes ni historicos locales; no migra los pagos ya registrados en tu XAMPP. Para conservar esos historicos se necesita un respaldo y una migracion coordinada. El script rechaza sustituir silenciosamente una instalacion de Pagos que usa otra base.

Cambiar contrasenas en `.env.k8s` despues de inicializar el volumen no cambia los usuarios de MySQL. El script detecta esa diferencia y se detiene. No eliminar el volumen para resolverlo; coordinar la rotacion en MySQL.

```powershell
.\k8s\comun\deploy.ps1 -Accion Logs
.\k8s\comun\deploy.ps1 -Accion Detener
.\k8s\comun\deploy.ps1 -Accion Iniciar
```

Detener pausa web y consumidor, conservando MySQL y sus datos. No borrar el namespace `ecommerce`: podria contener servicios de otros grupos. La web usa una sola replica porque sus sesiones PHP son locales; reemplazar su Pod requiere volver a iniciar sesion. El consumidor termina ante fallos fatales y Kubernetes reinicia su contenedor; el estado Running por si solo no prueba conectividad con RabbitMQ. Revisar sus registros y coordinar un PedidoCreado para probar el flujo completo.

La verificacion final de integracion debe realizarse en el computador de Clientes. Este paquete preparado en otro equipo no demuestra que ya este instalado alli.

## Verificacion del paquete

Se comprobaron el parseo de los ocho recursos Kubernetes, la sintaxis PowerShell, la suite PHP existente, la carga de nombres y los nuevos tests aislados. Los tests del instalador simulan Docker, Kubernetes y HTTP; no despliegan recursos ni publican mensajes. Los tests de tokens usan claves efimeras.

```powershell
.\tests\deploy-common.ps1
php tests/lab-token.php
```

La construccion de la nueva imagen y las pruebas de integracion quedan pendientes en el equipo destino: Docker Desktop no estaba disponible en el equipo donde se preparo este paquete. El script espera a MySQL y verifica el esquema y HTTP al ejecutarse en el computador comun.
