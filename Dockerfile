# Dockerfile

FROM node:20

# Establece el directorio de trabajo
WORKDIR /app

# Copia package.json y package-lock.json (si existe)
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto de los archivos
COPY . .

# Expone el puerto en el que se ejecuta la app
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["npm", "start"]
