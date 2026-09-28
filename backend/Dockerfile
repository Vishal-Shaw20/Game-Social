# Dependencies install on the CI runner's own platform ($BUILDPLATFORM)
# rather than under QEMU emulation for linux/arm64, where Node can crash
# ("Illegal instruction"). That's only safe because every production
# dependency is plain JavaScript (no native addons, nothing per-platform);
# if one ever needs compiling, install it in the final stage instead.
FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
