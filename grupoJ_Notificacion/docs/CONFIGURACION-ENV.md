# Configuracion de entorno de Notificaciones

Los archivos de entorno pertenecen exclusivamente al microservicio del Grupo J.
`.env` se carga con `npm start`; `.env.integracion` se selecciona expresamente con
`node --env-file=.env.integracion src/index.js`. Ambos archivos reales son privados.
Las plantillas `.env.example` y `.env.integracion.example` explican cada variable
sin incluir las credenciales del responsable. Conservar los valores existentes.

En la instalacion actual, ambos entornos privados utilizan el broker compartido,
correo habilitado e identidad local. Las variables de firma de Clientes permanecen
opcionales mientras USER_AUTH_MODE=local; no se inventan emisores ni claves externas.
El correo requiere SMTP y credenciales RPC de Clientes. SMTP_FROM vacio usa SMTP_USER;
CLIENTES_RABBITMQ_URL vacio reutiliza RABBITMQ_URL.

`PORT=3010` evita el conflicto con Bunker Gym al ejecutar Node. Los dos Compose
fijan `PORT=3000` dentro del contenedor; HOST_PORT define el puerto publicado.
Ambos transmiten las variables de correo y fuentes RabbitMQ; el perfil de
integracion exige AMQPS. DATABASE_PATH de Docker utiliza su almacenamiento persistente.
KUBECTL_BINARY solo afecta al script de verificacion Kubernetes.

Ejecutar `npm run check:env` o `npm run check:env -- .env.integracion` para validar
configuracion sin mostrar secretos. Esta validacion no certifica conexiones externas
ni entrega de correo. No se necesita configurar MySQL, Next.js, Wompi ni OAuth de Bunker.
