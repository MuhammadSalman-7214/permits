# Use Node 20 official image (latest stable Node 20 version)
FROM node:20

# Install dependencies needed by Puppeteer to run Chrome
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies first (leverages Docker cache)
COPY package*.json ./
RUN npm install

# Copy all other source files
COPY . .

# Default command
CMD ["npm", "start"]
