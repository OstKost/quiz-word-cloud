FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node worker ./worker
COPY --chown=node:node public ./public
COPY --chown=node:node drizzle ./drizzle
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/quiz.sqlite
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "scripts/dev.mjs"]
