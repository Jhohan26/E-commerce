# Despliegue rapido de toda la plataforma (Docker Desktop + Kubernetes)

El archivo `deploy-all.ps1` de la raiz orquesta los nueve modulos existentes, sin reemplazar sus scripts individuales. Esta pensado para **Windows con PowerShell y Kubernetes habilitado en Docker Desktop**.

## Requisitos

- Docker Desktop iniciado y con el motor de Linux en funcionamiento.
- Kubernetes de Docker Desktop habilitado; debe existir el contexto `docker-desktop`.
- `docker` y `kubectl` disponibles desde PowerShell.
- Los `.env` requeridos por cada modulo, configurados correctamente (no compartir ni subir credenciales al repositorio).
- Recursos suficientes para ejecutar todos los servicios y sus bases de datos. Se conservan los PVC existentes.

Desde PowerShell, abre la carpeta `E-commerce` y ejecuta:

```powershell
# Primer despliegue: construye las 14 imagenes locales que hagan falta y despliega todo.
.\deploy-all.ps1

# Siguientes despliegues: detecta imagenes existentes y NO vuelve a construirlas.
.\deploy-all.ps1

# Solo desplegar: exige que ya existan todas las imagenes seleccionadas.
.\deploy-all.ps1 -SinBuild

# Preparar imagenes sin desplegar Kubernetes.
.\deploy-all.ps1 -Accion Construir

# Si modificaste codigo/Dockerfiles, reconstruye las imagenes para reflejar cambios.
.\deploy-all.ps1 -Reconstruir

# Reconstruir y desplegar unicamente los grupos que modificaste.
.\deploy-all.ps1 -Modulos Clientes,Productos -Reconstruir

# Mostrar recursos de Kubernetes de todos los modulos (sin reconstruir).
.\deploy-all.ps1 -Accion Estado

# Ver el plan sin ejecutar Docker ni kubectl.
.\deploy-all.ps1 -Simular
```

## Detener todos los modulos sin borrar datos

El archivo `stop-all.ps1` escala a **cero replicas** los Deployments y StatefulSets de los nueve modulos. Conserva todos los namespaces, Services, Secrets, ConfigMaps, PVC y las bases de datos persistentes; no ejecuta `kubectl delete`.

```powershell
# Detener toda la plataforma.
.\stop-all.ps1

# Ver lo que se detendria, sin ejecutar cambios.
.\stop-all.ps1 -Simular

# Detener solo algunos modulos.
.\stop-all.ps1 -Modulos Clientes,Productos

# Volver a arrancar los pods sin reconstruir imagenes ni reaplicar los manifiestos.
.\stop-all.ps1 -Accion Iniciar

# Si deseas reaplicar la configuracion y desplegar de nuevo, usa:
.\deploy-all.ps1 -SinBuild
```

El apagado se solicita en orden inverso a las dependencias (primero aplicaciones y consumidores, despues sus bases de datos); `-Accion Iniciar` invierte ese orden y recupera las replicas declaradas en los manifiestos (2 para `clientes/web` y `productos/backend`, 1 para los demas). Kubernetes puede tardar en terminar o iniciar los Pods. No se escalan a cero otros recursos que compartan un namespace: el script enumera los nombres concretos de este proyecto.

Si PowerShell no permite ejecutar archivos `.ps1`, puedes ejecutar el script desde una terminal con:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy-all.ps1
```

## Que cambia respecto al despliegue anterior

1. Revisa con `docker image inspect` si existe cada imagen local (no inicia contenedores ni descarga nada).
2. Construye **solo las imagenes que falten**, o todas las seleccionadas si se indica `-Reconstruir`. Docker conserva su cache por capas para acelerar reconstrucciones.
3. Una vez preparadas todas las imagenes, llama los `deploy.ps1` originales pasando `-SinBuild` para evitar compilaciones repetidas.
4. Los manifiestos de las aplicaciones ya incluyen `imagePullPolicy: IfNotPresent`: Kubernetes reutiliza la imagen que tenga el nodo si esta disponible.
5. Los scripts de Clientes y Productos ahora reinician sus Deployments tras aplicar los manifiestos; asi cargan el contenido actualizado de una etiqueta local reutilizada.

**Importante:** reutilizar una imagen existente no detecta si cambiaste el codigo fuente. Despues de modificar un modulo, ejecuta `-Reconstruir -Modulos Nombre` (o cambia la etiqueta y actualiza el manifiesto). De lo contrario, el contenedor seguira ejecutando el codigo de la imagen anterior.

## Modulos y orden

| Orden | Modulo | Imagen(es) de la aplicacion o BD personalizada |
| --- | --- | --- |
| 1 | Clientes | `clientes-app:1.0` |
| 2 | Productos | `gg-backend:1.0`, `gg-frontend:1.0`, `gg-worker:1.0` |
| 3 | Inventario | `inventario-app:1.0`, `inventario-mysql:1.0` |
| 4 | Notificaciones | `grupo-j-notificaciones:2.0.0` |
| 5 | Pedidos | `pedidos:lab-jwt-v1` |
| 6 | Pagos | `pagos:cluster-v1`, `pagos-mysql:1.0` |
| 7 | Facturacion | `facturacion-app:1.0`, `facturacion-mysql:1.0` |
| 8 | Carrito | `carrito-grupod:1.0.0` |
| 9 | Reportes | `reportes:cluster-v1` |

Las imagenes oficiales `mysql:8.0` y `mysql:8.4` se obtienen normalmente del registro al arrancar por primera vez; no se reconstruyen en este proyecto.

## Alcance y limites

- El script **no borra namespaces, PVC ni bases de datos**. Los scripts originales aplican manifiestos, actualizan Secrets y esperan los `rollout` correspondientes. Estos tiempos de arranque siguen siendo necesarios.
- `-Accion Estado` solo consulta; `-Accion Construir` solo modifica el almacen local de imagenes Docker.
- La optimizacion usa las imagenes del **mismo motor Docker Desktop** donde corre Kubernetes. En clústeres remotos o multinodo, configura un registro de imagenes (por ejemplo GHCR o Docker Hub), publica imagenes versionadas, actualiza los `image:` de Kubernetes y gestiona las credenciales de descarga. No basta con construirlas en tu equipo.
- Si quieres un arranque sin desplegar otra vez, comprueba primero que los Deployments ya esten en marcha usando `-Accion Estado`; Kubernetes mantiene servicios existentes aunque cierres PowerShell.
- Si falta un `.env`, una dependencia externa (por ejemplo RabbitMQ) o recursos del clúster, el despliegue se detendra con el error del script del modulo correspondiente. El orquestador no instala ni modifica esas dependencias.

## Despliegues individuales

Siguen disponibles, por ejemplo:

```powershell
cd .\grupoF_Clientes
.\k8s\deploy.ps1 -SinBuild

cd ..\grupoC_Reportes
.\k8s\deploy.ps1 -Accion Instalar -SinBuild
```

Los demas modulos ya tenian `-SinBuild`. Para ejecutar todos, usa siempre el script de la raiz.
