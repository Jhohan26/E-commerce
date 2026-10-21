# Laboratorio de microservicios y orquestación — Grupo J

Revisión y ejecución: 20 de octubre de 2026. Versión 2.0.0.
Alcance del grupo: proteger las APIs administrativas y mantener los eventos.

## Fase 1. Arquitectura y endpoints

Se revisaron API REST, formulario web, rutas de consulta privada, modificación
de lectura, consumo RabbitMQ y persistencia. README y configuraciones.txt
identifican los endpoints públicos/protegidos y sus permisos.

## Fases 2 y 3. Autenticación y autorización

Se separó la identidad de usuarios de las cuentas técnicas de los microservicios.
USER_AUTH_MODE=clientes delega el login a F y valida firma HS256, sub, iat, exp,
iss y rol. Solo administrador accede a las APIs administrativas; cliente y
operador no tienen autorización en J. No se confía en el rol enviado en el cuerpo.
Las sesiones de J tienen vencimiento, inactividad y revocación local.
Los módulos no reciben acceso a la bandeja administrativa.

El emisor real del Grupo F en el ZIP (3) aún no incluye rol ni emisor. Esto
impide dar por terminada la integración central del equipo. J rechaza esos
tokens y conserva un modo local de demostración explícito, sin fallback.
docs/INTEGRACION-CLIENTES.md identifica los campos y la configuración pendientes.
No se modificó código de F ni se copió su clave predeterminada.

## Fase 4. Postman

Colección entregada con los siete casos obligatorios y tres pruebas de login.
Resultado reproducido: 10 solicitudes, 10 comprobaciones, cero fallos.
La API ejecutada es real; para esta prueba se utilizó un emisor F simulado con
clave efímera. La evidencia lo indica expresamente y no prueba la base de usuarios
ni la disponibilidad del worker real de F. El token vencido se firma con exp pasado;
la firma alterada y el rol operador se prueban por separado.

## Fase 5. Docker

Imagen construida: grupo-j-notificaciones:2.0.0. Contenedor sin root,
configuración externa y sin archivos .env reales en la imagen. Compose de
integración inicia saludable y conserva su SQLite original en ./data.
La imagen se carga en el runtime de Minikube; no se necesita un registro remoto
para ese clúster local. No se publicaron credenciales ni bases de datos.

## Fases 6, 7 y 8. Kubernetes

Se creó Minikube, perfil notificaciones-lab, con runtime containerd y namespace
ecommerce. Se aplicaron Deployment, Service, ConfigMap, Secret privado y PVC.
El nodo y el Pod alcanzaron Ready. El contenedor escucha en puerto 3000.
Se verificó DNS y acceso al Service notificaciones desde dentro del clúster.
Se incluyen recursos y límites, probes de arranque/vida/disponibilidad y volumen
persistente. Una réplica y Recreate evitan workers duplicados sobre SQLite.

El despliegue demostrado usa k8s/lab: login local, SMTP desactivado y recursos
RabbitMQ exclusivos de laboratorio. No compite con la cola real del equipo.
El perfil raíz está preparado para autenticación central una vez F complete el
contrato. No se presenta el despliegue de prueba como integración central terminada.

## Fase 9. Comunicación protegida y eventos

40 pruebas locales aprobadas y 4 pruebas RabbitMQ reales aisladas aprobadas.
Se comprobaron persistencia, deduplicación, ACK después de guardar, DLQ,
reconexión, consultas RPC de Clientes con respuestas controladas y JWT técnico
opcional. El consumidor por defecto conserva los eventos existentes sin exigir
a todos los productores un JWT nuevo de J. La protección de API permanece activa.

RabbitMQ usa cuentas técnicas del broker, separadas del JWT del usuario HTTP.
Los permisos por productor/consumidor deben configurarse en el broker del equipo;
las credenciales compartidas no demuestran aislamiento de identidades técnicas.
Las pruebas aisladas no certifican una compra real entre todos los microservicios
ni el envío SMTP actual. Esas pruebas requieren que los otros grupos estén activos.

## Fase 10. Recuperación

scripts/verify-k8s.js publicó un evento en el exchange propio del laboratorio,
confirmó su guardado, comprobó API y Service y eliminó el Pod de prueba.
Kubernetes creó un reemplazo con UID distinto y estado Ready. Se repitieron las
consultas autenticadas y se conservó el mismo id de notificación y la cuenta.
El PVC no se eliminó. Esto demuestra reemplazo de Pod y persistencia comprobada,
no alta disponibilidad ni recuperación de toda operación interrumpida.

## Evidencias y demostración final

docs/evidencias/postman.json contiene códigos y resultados sin tokens.
docs/evidencias/kubernetes.json contiene Pods antes/después y comprobaciones de
Service/API/persistencia sin credenciales. Las herramientas privadas y Secret
reales permanecen en .artifacts y no forman parte de la entrega.

Para exponer la demostración: mostrar recursos Ready, endpoint público, login,
consultas con/sin autorización, recepción de evento y prueba de recuperación.
Importar la colección Postman según postman/README.md. No mostrar archivos privados.

**Pendiente externo para completar la demostración integrada:** F debe emitir
roles y emisor firmados y compartir la configuración de confianza y cuentas de
prueba. Después se activa USER_AUTH_MODE=clientes y se repiten las pruebas con
usuarios reales de F y productores reales del equipo. Sin eso no se afirma que
todo el laboratorio colectivo esté terminado.
