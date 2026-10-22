# Resultados de seguridad de Pagos

Las ocho comprobaciones HTTP contra Apache en el Pod web desplegado en Kubernetes pasaron. Se usaron tokens temporales creados dentro del contenedor, sin exportar tokens ni claves. No se enviaron cookies ni se modificaron pagos.

| Caso | Esperado | Recibido | Resultado |
| --- | --- | --- | --- |
| Público sin token | 200 | 200 | Aprobado |
| Protegido sin token | 401 | 401 | Aprobado |
| Token válido de operador | 200 | 200 | Aprobado |
| Firma del token alterada | 401 | 401 | Aprobado |
| Token firmado y vencido | 401 | 401 | Aprobado |
| Rol cliente no autorizado | 403 | 403 | Aprobado |
| Rol operador autorizado | 200 | 200 | Aprobado |
| Rol administrador autorizado | 200 | 200 | Aprobado |

El endpoint público fue `health.php`; el protegido fue `pending.php`. Todas las respuestas fueron JSON válido. Los tiempos, mensajes y fecha UTC de ejecución están en `resultados-seguridad.json`.

Estas pruebas ejecutan los casos HTTP equivalentes a la colección preparada. No se ejecutó la aplicación Postman ni su Collection Runner. Si el profesor exige evidencia dentro de Postman, todavía debe importarse y ejecutarse allí la colección para obtener esas capturas.

Los tokens de prueba están firmados con la configuración actual de Pagos. Esto comprueba su validación y permisos, pero no demuestra que el login de Clientes emita tokens compatibles. El acuerdo del emisor, roles y firma con autenticación continúa pendiente.
