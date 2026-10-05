# Jumıs AI — no npm install needed (zero dependencies)
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=3000
RUN mkdir -p /app/data
# Store /app/data on a persistent volume (Railway: add a Volume mounted at /app/data)
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
