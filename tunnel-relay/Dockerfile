FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY src ./src
USER node
ENV RELAY_BIND=0.0.0.0 PORT=4321
EXPOSE 4321
CMD ["node", "src/main.mjs"]
