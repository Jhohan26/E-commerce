# Imagen base ligera y oficial de Node.js LTS
FROM node:20-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar manifiestos de dependencias primero para aprovechar la caché de capas de Docker
COPY package*.json ./

# Instalar únicamente dependencias de producción
RUN npm ci --omit=dev

# Copiar el código fuente y archivos estáticos del microservicio de Pedidos
COPY src/ ./src/
COPY public/ ./public/
COPY database/ ./database/

# Variables de entorno por defecto (no sensibles); los secretos se inyectan en ejecución / Kubernetes
ENV NODE_ENV=production \
    PORT=3000

# Exponer el puerto HTTP del microservicio
EXPOSE 3000

# Comando de arranque del servicio
CMD ["node", "src/server.js"]
