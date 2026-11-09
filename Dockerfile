FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "src/http.ts"]
