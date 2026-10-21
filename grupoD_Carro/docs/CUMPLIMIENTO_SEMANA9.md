# Cumplimiento del laboratorio Semana 9 (Carrito, Grupo D)

Leyenda: **Listo** = implementado y verificado en el entorno de desarrollo · **Ejecutar** = entregado, pero solo se puede
demostrar en tu máquina (necesita Docker, clúster o los demás servicios) · **Otro grupo** = responsabilidad de otro equipo.

| Fase | Requisito del documento | Estado | Evidencia / cómo demostrarlo |
| --- | --- | --- | --- |
| 1 | Revisar arquitectura, listar endpoints públicos y protegidos, identificar operaciones RabbitMQ | Listo | Tabla en `README.md` (sección 1). RabbitMQ: RPC `cliente.consultar`, `productos.listar`, `auth.login`, `pedidos.desde_carro`. |
| 2 | Login y emisión de JWT | Otro grupo (Grupo F) | El carrito consume `auth.login` (ya funcionaba) y **no** emite tokens, por diseño del documento. Pruebas de login/contraseña/usuario inexistente corresponden a Grupo F. |
| 2 | "Probar que el token tenga fecha de expiración" | Listo (lado carrito) | `exp` es obligatorio: un token sin `exp` se rechaza (`test_token_sin_exp_401`) y uno vencido da 401. |
| 3 | Definir endpoints públicos | Listo | `/health`, `/ready`, `/api/productos` y la interfaz web. |
| 3 | Validar firma, expiración y claims; obtener identidad y rol; comprobar permisos; HTTP apropiado | Listo | `auth.py`; 401/403/503. 36 pruebas en `tests/`. |
| 3 | No aceptar `user_id` o rol enviados libremente | Listo | La identidad sale solo del JWT firmado (`test_identidad_sale_del_token_no_del_cuerpo`). |
| 3 | Carrito: "validar el token antes de acceder o modificar el carrito del usuario" | Listo (API) | `/api/carrito/...`; un cliente solo accede al suyo. **Ver nota 1.** |
| 3 | Pedidos: proteger la creación | Listo | `POST /api/carrito/{id}/pedido` exige rol cliente y propiedad; la llamada del carrito a Pedidos va con JWT de servicio. |
| 4 | Colección Postman con las 7 solicitudes pedidas | Listo | `postman/Carrito_Seguridad.postman_collection.json` (+ carpeta de integración). Las 15 solicitudes de las carpetas 1–7 se ejecutaron contra un servidor real y dieron el código esperado. |
| 4 | Demostrar que no basta con un texto en Authorization | Listo | Solicitud "texto cualquiera" → 401 y tests de firma/payload/`alg=none`. |
| 5 | Dockerfile, variables de entorno, sin secretos en código, imagen versionada | Listo (ejecutar el build) | `Dockerfile` (hadolint sin hallazgos), `.dockerignore`, `docker-compose.yml`, tag `1.0.0`. **Ver nota 2.** |
| 5 | Publicar en registro si es remoto | Ejecutar (opcional) | Comandos en `README.md` sección 3. Con Minikube local no hace falta. |
| 6 | Clúster local, namespace, config | Ejecutar | Comandos en `README.md` sección 4; `k8s/namespace.yaml`. |
| 7 | Deployment, Service, Secret, ConfigMap y decisiones documentadas | Listo | `k8s/` (los 5 manifiestos validados con kubeconform). Decisiones en el README. |
| 8 | Desplegar, Pod Running/Ready, Service, puerto, prueba desde un cliente | Ejecutar | Comandos y verificación en `README.md`. |
| 9 | Integración: token → API protegida; sin token rechazado; rol incorrecto denegado; comunicación entre servicios; consumidores RabbitMQ | Ejecutar (parte local lista) | Los rechazos 401/403 están probados. El flujo con Pedidos/Clientes reales requiere la plataforma completa. RabbitMQ y JWT se mantienen separados (ver README). |
| 10 | Eliminar el Pod y observar recuperación | Ejecutar | Procedimiento y resultado esperado en `README.md`. |
| Final | Demostración | Ejecutar | Guion: Postman (carpetas 1–7) → `docker compose up` → `kubectl apply` → borrar Pod. |

## Notas importantes

1. **La interfaz web (`/cliente/...`) sigue sin login**, tal como estaba, para no romper el flujo actual (escribir un id y
   comprar). La protección con JWT está en la API `/api/...`. Si el equipo quiere que la interfaz exija inicio de sesión, es un
   cambio de producto (pantalla de login que use `auth.login` y cookie de sesión) que conviene acordar con el Grupo F, porque
   depende de qué claims emite (¿`cliente_id` o solo `sub`?).
2. **No se pudo construir la imagen ni desplegar en un clúster en el entorno donde se preparó** (sin Docker/kubectl). Se verificó:
   lint del Dockerfile, validación de esquemas de los manifiestos, y arranque de la app con solo los archivos del `COPY` en un
   entorno limpio. El `docker build` real y los pasos de las fases 6, 8 y 10 deben ejecutarse en tu equipo.
3. Se asumió HS256 con clave compartida y los claims `sub`, `exp`, `rol` y `cliente_id`. Si el Grupo F emite otros nombres o
   un emisor (`iss`), se configura con `JWT_CLAIM_ROL`, `JWT_CLAIM_CLIENTE_ID`, `JWT_ISSUER` sin tocar el código.
4. No se pudo comprobar contra el worker real de Pedidos si ya exige el JWT; el carrito lo envía siempre. Si Pedidos no valida
   tokens, el header es inofensivo; si los valida, ahora el pedido va autenticado.
5. `.env` contiene credenciales reales de CloudAMQP y del usuario de servicio. No lo compartas ni lo subas al repositorio
   (ya está en `.gitignore` y `.dockerignore`); considera rotar esas credenciales si este `.zip` circuló.
