FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

CMD ["pnpm", "run", "serve"]
