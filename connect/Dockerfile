# Read-only Trader-DNA connect service. Runs the TS directly via tsx (same pattern as the engine).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
ENV PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "src/main.ts"]
