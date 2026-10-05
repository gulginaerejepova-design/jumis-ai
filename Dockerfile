# Jumıs AI — no npm install needed (zero dependencies)
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=3000
RUN mkdir -p /app/data
# Mount a persistent volume at /app/data so the database and uploads survive redeploys
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
