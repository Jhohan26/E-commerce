# Acuerdo de integración pendiente con Grupo F
El worker.py de E-commerce-main (3).zip firma HS256 con sub, iat, exp y responde
por auth.login. No incluye rol, emisor ni audiencia. El login web de main.py usa
formulario y sesión; no es un endpoint JWT HTTP documentado.

Notificaciones no puede demostrar autorización administrativa con ese token.
No se deduce el rol del nombre de usuario ni se acepta un rol en el cuerpo.
No se copian usuarios ni claves predeterminadas de otro repositorio.

## Contrato que debe confirmar el responsable de autenticación
- Fuente de usuarios con roles cliente, operador y administrador.
- RPC auth.login: {usuario,password} -> {status,data:{token,expira_en_segundos}}.
- Claims firmados: sub, iat, exp, iss y role o rol.
- Emisor exacto y clave HS256 de verificación comunicados en privado.
- Audiencia si se decide utilizarla y cuentas de prueba con diferentes roles.
- jti aleatorio recomendado para diferenciar sesiones, incluso en el mismo segundo.

Estos son los campos compatibles preparados por J, no una afirmación de que F
ya los implementó. Si se acuerda un contrato distinto se ajusta el verificador.
No se acepta un algoritmo elegido libremente desde el token.

Después del acuerdo: USER_AUTH_MODE=clientes, CLIENTES_JWT_SECRET,
CLIENTES_JWT_ISSUER y, si corresponde, CLIENTES_JWT_AUDIENCE en entorno/Secret.

## Mensaje para coordinar
> Notificaciones ya valida JWT externos y solo permite el rol administrador en
> sus APIs administrativas. En el ZIP (3), auth.login aún emite JWT sin rol ni
> emisor. Necesitamos los claims role (o rol), iss, sub, iat y exp, la confirmación
> del contrato y la configuración de verificación por canal privado. También
> cuentas de administrador y operador para la prueba integrada. RabbitMQ sigue
> usando sus credenciales técnicas independientes de la autenticación HTTP.
