# Pruebas de seguridad de Pagos

Importa `Pagos-seguridad.postman_collection.json` en Postman. La colección incluye los siete casos mínimos de la fase 4 y una comprobación adicional de administrador. Todas las consultas son GET y no modifican pagos.

Configura `base_url` con la dirección de Pagos; por defecto usa `http://localhost:8086`. Configura los tokens como variables privadas de tu entorno de Postman, sin incluirlos en una exportación compartida:

- `token_operador`: JWT válido con rol operador.
- `token_administrador`: JWT válido con rol administrador.
- `token_cliente`: JWT válido con rol cliente, que Pagos debe rechazar con 403.
- `token_vencido`: JWT correctamente firmado cuya fecha `exp` ya pasó. Cambiar manualmente `exp` sin volver a firmarlo solo prueba alteración, no expiración.

La prueba de alteración modifica automáticamente la firma de `token_operador`. Las cookies se desactivan por petición para que un inicio de sesión previo no haga pasar la prueba sin token. Cada solicitud comprueba el estado HTTP esperado y que la respuesta sea JSON. Ejecuta la colección y conserva los resultados para la demostración. No se ha ejecutado Postman durante esta actualización.

Resultados esperados: público 200; protegido sin token 401; token válido 200; token alterado 401; token vencido 401; cliente 403; operador 200; administrador 200. Se usa `pending.php` como endpoint protegido porque forma parte de la imagen desplegada; `secure-test.php` se excluye de Docker.

## Emisor JWT pendiente de integración

Pagos ya compara el claim `iss` cuando `JWT_ISSUER` tiene un valor. Actualmente ese valor está vacío, por lo que no comprueba el emisor.

En la comprobación real del login RPC de Clientes, el contenido del token recibido tenía únicamente `sub`, `iat` y `exp`: no incluía `iss` ni un rol de usuario. Esto se observó decodificando el contenido para diagnóstico; ese token no pasó la validación de Pagos y no se aceptó como autenticación.

El equipo responsable de autenticación debe confirmar si ese login RPC entrega un token de servicio o el token destinado al usuario de la plataforma. Para los usuarios de Pagos, el contrato debe incluir un emisor estable acordado, identidad, rol y expiración, además de una firma verificable con la clave acordada. El emisor debe incluir `iss` al firmar y Pagos debe configurar exactamente el mismo valor en `JWT_ISSUER`. No inventar un valor solo en Pagos: los tokens existentes que no tengan ese emisor quedarían rechazados.

Antes de activar la comprobación en el clúster, validar con un token emitido realmente por autenticación que firma, algoritmo, nombres de claims y rol coinciden. Después actualizar el ConfigMap y reemplazar el Pod web para que lea el nuevo valor. No hace falta reconstruir la imagen por un cambio exclusivo de variables de entorno.
