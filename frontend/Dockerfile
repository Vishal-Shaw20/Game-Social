# The build stage runs on the CI runner's own platform ($BUILDPLATFORM),
# not the target's: it only makes static files (dist/), which are the same
# on every platform. Emulating it for linux/arm64 under QEMU crashed Node
# ("qemu: uncaught target signal 4 (Illegal instruction)") and was slow.
# Only the nginx stage below is built for the target platform.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV VITE_API_URL=""
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
