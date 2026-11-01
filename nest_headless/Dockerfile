FROM node:22.23.4-bookworm-slim

ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL io.hass.version="${BUILD_VERSION}" io.hass.arch="${BUILD_ARCH}" io.hass.type="app"

# Debian base (swapped from Alpine 2026-08-30): glibc lets native
# onnxruntime-node load, so the local vision models (cat detector + door
# classifier) run in-process, multithreaded, instead of WASM in the page.
# Chromium from Debian repos includes H.264 decode.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium jq fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY app/package.json app/package-lock.json /app/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY app/ /app/
COPY run.sh /
RUN chmod +x /run.sh

ENV CHROMIUM_PATH=/usr/bin/chromium
CMD ["/run.sh"]
