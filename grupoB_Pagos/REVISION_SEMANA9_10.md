# Revisión de Pagos frente al taller de semanas 9 y 10

Fecha local de revisión: 21 de octubre de 2026.

El servicio tiene implementada la base de seguridad y despliegue del taller, pero todavía no se puede afirmar que cumple toda la demostración obligatoria. Esta revisión compara el documento suministrado con el código y distingue las pruebas aisladas de las pruebas de integración pendientes.

## Error de nombres en la web

El JavaScript cancelaba `client.php` a los 4 segundos. Ese endpoint necesita conectar con RabbitMQ, autenticar la cuenta de servicio y consultar Clientes; si recibe 401 puede repetir login y consulta. El límite del navegador no cubría ese recorrido. Los registros del Pod muestran consultas de nombres con respuesta HTTP 200 posteriores a su hora de solicitud, coherentes con peticiones que terminan después de que el navegador abandona la espera.

Además, `client.php` conservaba el bloqueo de la sesión PHP durante el RPC, retrasando otras solicitudes del mismo usuario. La actualización de pendientes esperaba los nombres dentro del mismo bloque que tenía un temporizador de 7 segundos: un nombre lento podía impedir las siguientes actualizaciones.

Correcciones locales:

- `public/client.php` libera la sesión después de validar autenticación y permisos, antes del RPC.
- `public/pending.php` libera la sesión después de autenticar.
- `public/demo.js` concede hasta 60 segundos al nombre y actualiza los nombres independientemente del listado.
- `tests/demo.cjs` simula una respuesta pendiente, verifica que el listado se actualiza otra vez, agrupa solicitudes del mismo pedido y comprueba que el nombre recibido se muestra.

La corrección está en los archivos locales. El Pod existente usa una imagen ya construida y no recibe estos cambios automáticamente. Falta reconstruir y actualizar la imagen web para verificar el resultado en la página real. Reiniciar el Pod sin reconstruir la imagen no incorpora los cambios. El reemplazo de la web termina sus sesiones locales y puede interrumpir un port-forward dirigido al Pod.

## Cumplimiento por fase

| Fase | Evidencia y estado |
| --- | --- |
| 1. Arquitectura y endpoints | Implementado: README identifica rutas públicas y protegidas; código separa HTTP, persistencia y RabbitMQ. Advertencia: el README todavía describe procesamiento automático, pero `Processor` registra PENDIENTE y espera la decisión del operador. |
| 2. Autenticación | Integración implementada: `auth-session.php` utiliza `ClientRpc::login` para delegar credenciales al servicio responsable; Pagos no debe crear su propia fuente de usuarios. Pendiente demostrar login real correcto, contraseña incorrecta y usuario inexistente con Clientes. Los tests de JWT no sustituyen esas pruebas. |
| 3. Protección de APIs | Implementado: firma HS256, expiración obligatoria, identidad, rol y respuestas 401/403. Operador y administrador permitidos; cliente bloqueado. Falta acordar y configurar el emisor: `JWT_ISSUER` vacío omite su validación. Los nombres de claims deben coincidir con Clientes. |
| 4. Postman | Falta una colección exportable en el repositorio con público, sin token, token válido, alterado, vencido, rol incorrecto y rol permitido. Hay pruebas PHP automatizadas equivalentes para parte de estos casos. |
| 5. Docker | Dockerfile presente: PHP/Apache, dependencias, configuración externa, DocumentRoot público y exclusión de secretos mediante lista permitida de archivos. La revisión no reconstruyó la imagen. Los tags de web y consumidor difieren; documentar o unificar una versión probada. |
| 6. Clúster | Verificado en lectura: namespace ecommerce accesible, web y consumidor en Running y Ready, Service pagos-web presente. No se verificó el origen del clúster ni sus recursos totales. |
| 7. Manifiestos | Deployment web, Deployment consumidor, Service, ConfigMap y ejemplo de Secret presentes. La web también exige `pagos-clientes-secret`, pero no hay plantilla ni instrucciones para crearlo; el ejemplo existente incluye esas credenciales dentro de `pagos-secret`. Un entorno nuevo requiere resolver esa discrepancia. El namespace se crea mediante el comando del README. |
| 8. Despliegue | Los dos Pods estaban 1/1 y el Service existe; los registros web muestran tráfico real en el puerto HTTP y probes exitosas. Falta verificar la corrección de nombres en una imagen nueva y dejar evidencia reproducible del acceso por Service. |
| 9. Integración protegida | Implementación conserva RabbitMQ separado del JWT HTTP. No se publicaron decisiones ni eventos en el broker compartido durante esta revisión. Pendiente evidencia actual del flujo completo con Clientes, Pedidos y consumidores de resultados. El README reconoce Facturación y Notificaciones pendientes. |
| 10. Recuperación | Deployment y probes configurados. No se eliminó ningún Pod durante la revisión. El consumidor mostraba 20 reinicios acumulados; eso requiere revisar la causa y no demuestra por sí solo recuperación correcta de operaciones. Falta documentar eliminación controlada de un Pod propio, reemplazo Ready y consulta posterior. |

## Otros hallazgos

- La web usa sesiones PHP locales; escalarla sin almacenamiento compartido puede producir autenticación intermitente. El manifiesto actual limita la web a una réplica.
- Las probes del consumidor comprueban su proceso, no el avance real ni la salud de RabbitMQ. La readiness web comprueba MySQL y no garantiza que Clientes responda.
- La cuenta de servicio `CLIENT_AUTH_USER`/`CLIENT_AUTH_PASSWORD` usada para consultar nombres es distinta del usuario que inicia sesión. Un login web correcto no garantiza que las credenciales RPC de consulta sean válidas.
- El historial muestra solo el identificador del cliente; no solicita nombres. La corrección se aplica al resultado de pago y al panel de pendientes, donde ya se intentaban cargar.
- La simulación automática de `Simulator.php` está probada de forma aislada, pero no está conectada al flujo actual del consumidor. La autorización de pago actual es manual mediante Pagar/Rechazar. Documentar este comportamiento para la demostración.
- PHP local avisa que `openssl` se carga dos veces. Conviene quitar la entrada duplicada en su configuración; no se modificó la instalación de XAMPP.

## Verificaciones ejecutadas

- `composer test`: aprobado con permisos para abrir el servidor HTTP temporal. Usa claves efímeras y no accede al MySQL ni RabbitMQ compartidos.
- `node tests/demo.cjs`: aprobado, incluyendo nombres lentos y listado independiente.
- Validación sintáctica de los dos endpoints PHP modificados: aprobada.
- Consulta de estado Kubernetes y lectura de registros web: realizadas.
- Sin modificación de pagos, publicación de eventos ni lectura de valores de Secrets.

Una comprobación HTTP adicional que generaba un JWT de operador dentro del contenedor fue rechazada por la revisión automática de permisos. No se ejecutó ni se sustituyó por otro mecanismo para eludir el bloqueo. Por ello, el nombre real en la web sigue pendiente de validación mediante una sesión autorizada normal.

## Actualización posterior autorizada

El usuario autorizó reconstruir y actualizar la web y comprobar consultas mediante un token temporal de operador. Se construyó `pagos:lab-jwt-clientes-v9`, se actualizó únicamente el Deployment web y se confirmó el nuevo Pod Running y 1/1 Ready, sin reinicios. El manifiesto local conserva la nueva versión. El consumidor mantuvo su despliegue existente.

La comprobación HTTP autorizada devolvió 200 para health, pendientes y nombre del pedido 1028. El nombre recibido fue Jhohan Reyes. Antes de actualizar, la consulta tardó 4,77 segundos; en la nueva imagen tardó 4,66 segundos. Ambas superan el límite anterior de 4 segundos. Se confirmó que el JavaScript instalado contiene el nuevo límite de 60 segundos. Estas verificaciones comprobaron HTTP y el contenido instalado, no la representación visual de una sesión de navegador. No se modificaron pagos ni se publicaron decisiones. Se restableció el acceso local mediante Service en el puerto 8086.

Se añadió `postman/Pagos-seguridad.postman_collection.json` con ocho consultas GET: los siete casos mínimos del taller y administrador. No contiene tokens reales y desactiva cookies para evitar que una sesión previa oculte resultados 401. La colección está preparada; falta ejecutarla en Postman y conservar evidencia.

`JWT_ISSUER` sigue vacío. Un login normal de la cuenta de servicio de Clientes devolvió un token que no pasa la validación de Pagos. Su contenido inspeccionado, sin tratarlo como identidad válida, solo contiene sub, iat y exp; no contiene iss ni rol. Debe confirmarse con el equipo de autenticación cuál es el token de usuario acordado, su clave de verificación y sus claims. No se cambió el emisor por un valor inventado ni se redujo la validación para aceptar ese token. Ver `postman/README.md` para los pasos pendientes.
