FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/mcp-server ./apps/mcp-server
RUN pnpm install --frozen-lockfile
ENV HOST=0.0.0.0 PORT=3001 AGENTS_DIRECTORY=/data/agents
USER node
EXPOSE 3001
CMD ["pnpm", "mcp"]
