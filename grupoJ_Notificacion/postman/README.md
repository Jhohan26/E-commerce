# Pruebas de seguridad

Importar Notificaciones-Seguridad.postman_collection.json y
Local.postman_environment.json en Postman. Seleccionar el entorno local y
Desktop Agent para acceder al localhost de este computador.

Definir los valores privados del entorno sin publicarlos:

- base_url: http://localhost:3010 en Compose; http://localhost:3020 por port-forward.
- admin_username/admin_password: cuenta de administrador de F en modo central;
  administrador local solo si USER_AUTH_MODE=local.
- operator_token: JWT firmado de operador de F. En demo local se puede utilizar
  el JWT de una cuenta técnica sin permiso de administración.
- expired_token: JWT realmente vencido del mismo emisor, no un texto arbitrario.

En modo central, el login de la colección pasa por J a F. También se puede usar
directamente un JWT obtenido en F como Bearer en las consultas protegidas.
La colección guarda admin_token temporalmente y altera su firma para el caso
negativo. No contiene claves de firma ni genera tokens válidos en el cliente.
Ejecutar las solicitudes en orden con Collection Runner y sin cookies anteriores.
El caso sin token ocurre antes del login; un Bearer explícito prevalece sobre cookie.

Casos: endpoint público (200), privado sin token (401), login correcto (200),
privado con token válido (200), token alterado (401), token vencido (401),
rol no autorizado (403), rol administrador (200), contraseña incorrecta (401),
usuario inexistente (401). Cada solicitud tiene una comprobación automática.
No modifica notificaciones ni envía correos.

Para obtener un token vencido, conservar uno y esperar su exp. Para acelerar la
demostración, usar un entorno de prueba aislado con expiración corta acordada con
el emisor. No reducir la expiración del entorno compartido ni compartir su clave.

## Ejecución controlada reproducible

La prueba automática utiliza una API real de J y un emisor F simulado, con claves
efímeras y SQLite en memoria. No prueba el worker real de F ni su base de usuarios.

```powershell
npm install --prefix .artifacts/postman-tools newman@6.2.3
node scripts/verify-postman-lab.js
```

Newman se instala como herramienta aislada en .artifacts y no forma parte de las
dependencias de producción o del ZIP. El formato entregado es Collection v2.1.
La evidencia .artifacts/evidencias/postman.json conserva códigos y resultados,
sin contraseñas ni tokens. No exportar un entorno Postman que contenga secretos.
