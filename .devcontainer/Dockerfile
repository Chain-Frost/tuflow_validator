FROM mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye

RUN apt-get update \
    && apt-get install -y --no-install-recommends libnspr4 libnss3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
