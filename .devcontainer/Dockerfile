FROM mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libasound2 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libice6 \
        libpangocairo-1.0-0 \
        libpango-1.0-0 \
        libcups2 \
        libglib2.0-0 \
        libnspr4 \
        libnss3 \
        libsm6 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libxrender1 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
        libxi6 \
        libxcb1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @devcontainers/cli
