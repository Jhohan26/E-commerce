# Kubernetes local

El docente permite Minikube o Kubernetes de Docker Desktop; no se requiere cloud.
Mantener un namespace ecommerce compartido para la integración del equipo.
Los manifiestos raíz de k8s no contienen secretos y usan modo central clientes.
La carpeta k8s/lab define una demostración independiente y aislada.

## Recursos y decisiones

Deployment: una réplica, estrategia Recreate; SQLite y el worker SMTP requieren
un único escritor/procesador. No aumentar réplicas sin adaptar persistencia y outbox.
PVC 1Gi: datos de SQLite y sesiones sobreviven al reemplazo de un Pod.
Service ClusterIP: nombre estable notificaciones.ecommerce.svc.cluster.local:3000.
ConfigMap: parámetros no sensibles. Secret: URLs/contraseñas/claves privadas.
Secret no es cifrado por usar base64; no publicarlo y restringir RBAC del clúster.
El contenedor no ejecuta como root, no monta credenciales Kubernetes y limita recursos.
Liveness/startup consultan /health/live; readiness /health/ready. Un broker caído
quita readiness sin provocar reinicios por liveness innecesarios.

## Preparar el clúster y la imagen

```powershell
minikube start --driver=docker --cpus=2 --memory=3072
kubectl cluster-info
kubectl get nodes
docker build -t grupo-j-notificaciones:2.0.0 .
minikube image load grupo-j-notificaciones:2.0.0
node scripts/check-manifests.js
kubectl apply -f k8s/00-namespace.yaml
```

Usar kubectl compatible con la versión del servidor; minikube kubectl -- permite
descargar el cliente correspondiente. Si se usa Docker Desktop Kubernetes, la
imagen local debe estar disponible para su runtime; si no, cargarla o publicarla
en un registro accesible y cambiar image en el Deployment. No se requiere publicar
la imagen en un registro remoto cuando se carga directamente en Minikube.

## Despliegue integrado con Clientes

Configurar en privado RABBITMQ_URL, JWT_SECRET, CLIENTES_JWT_SECRET y
CLIENTES_JWT_ISSUER según el acuerdo real con F. No usar valores ficticios.
La plantilla está en k8s/templates/secret.example.yaml, fuera del apply raíz.

```powershell
node --env-file=.env.integracion scripts/prepare-k8s-secret.js
kubectl apply -f .artifacts/k8s/notificaciones-secret.json
kubectl apply -f k8s/
kubectl -n ecommerce rollout status deployment/notificaciones --timeout=180s
kubectl -n ecommerce get deployments,pods,services,pvc
kubectl -n ecommerce port-forward service/notificaciones 3020:3000
```

El login central no puede completarse con el JWT del ZIP (3), que carece de rol
y emisor. Primero resolver docs/INTEGRACION-CLIENTES.md. No inventar una clave de F.
Si falla un Pod: kubectl -n ecommerce describe pod NOMBRE y kubectl -n ecommerce
logs NOMBRE. No imprimir Secret, variables completas ni tokens en las evidencias.

## Demostración aislada mientras F completa su contrato

Utilizar un perfil/clúster de prueba, no el Deployment integrado de todo el equipo.
El perfil utiliza un exchange y una cola propios; EMAIL_ENABLED=false y login local.
No consume la cola real ni dispara pagos/pedidos en otros grupos.

```powershell
node --env-file=.env.integracion scripts/prepare-k8s-secret.js --local-lab
kubectl apply -f .artifacts/k8s/notificaciones-secret.json
kubectl apply -f k8s/10-configmap.yaml
kubectl apply -f k8s/lab/configmap.yaml
kubectl apply -f k8s/20-storage.yaml
kubectl apply -f k8s/30-deployment.yaml
kubectl apply -f k8s/40-service.yaml
kubectl -n ecommerce rollout status deployment/notificaciones --timeout=180s
node --env-file=.env.integracion scripts/verify-k8s.js NOMBRE_CONTEXTO_LAB
```

La aplicación debe usar la imagen 2.0.0 ya cargada. verify-k8s verifica que sea el
perfil aislado, publica un evento propio, comprueba Service/API y datos, elimina
solo el Pod de laboratorio, espera un UID nuevo y comprueba la notificación y la
cuenta tras recuperarse. Conserva .artifacts/evidencias/kubernetes.json sin secretos.
No borrar Deployment ni PVC: perderíamos la condición que demuestra la recuperación.
Si se vuelve a aplicar k8s/ completo, se restablece la configuración central;
volver a aplicar el perfil de laboratorio antes de usarlo como demostración.

En este equipo, si se utiliza la instalación contenida en el proyecto:

```powershell
$env:MINIKUBE_HOME = Join-Path (Get-Location) '.artifacts/minikube'
$env:KUBECONFIG = Join-Path (Get-Location) '.artifacts/kubeconfig'
.artifacts/tools/minikube.exe -p notificaciones-lab status
```

La configuración del clúster queda en .artifacts; no se publica. El puerto 3010
del Compose existente y el 3020 del port-forward son entornos diferentes.
Los volúmenes y datos no se trasladan automáticamente entre Compose y Kubernetes.

## Referencias oficiales

- [Minikube con Docker](https://minikube.sigs.k8s.io/docs/drivers/docker/).
- [Probes de Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).
- [Configuración de Pods](https://kubernetes.io/docs/tasks/configure-pod-container/).
