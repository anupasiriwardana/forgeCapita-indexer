FROM node:22-alpine

WORKDIR /app

# Copy dependency definitions and install
COPY package*.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose Ponder's default GraphQL API port
EXPOSE 42069

# Run in development mode to enable instant hot-reloading
CMD ["npm", "run", "dev"]