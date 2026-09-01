# God's Eye View — hosted image.
#
# The app is not a static bundle: vite.config.js carries ~35 middleware
# proxies that broker keys, cache upstream responses on disk and hold the AIS
# websocket. So the runtime is `vite preview` (built bundle + those proxies),
# not a file server — which is why the dev dependencies stay in the image.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

WORKDIR /app

# Deps first: this layer only rebuilds when the lockfile moves.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

# GOOGLE_MAPS_API_KEY and CESIUM_ION_TOKEN are inlined into the browser bundle
# at build time (see the `define` block in vite.config.js), so they have to be
# present here, not only at runtime.
ARG GOOGLE_MAPS_API_KEY=""
ARG CESIUM_ION_TOKEN=""
RUN GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY" CESIUM_ION_TOKEN="$CESIUM_ION_TOKEN" npm run build

EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
