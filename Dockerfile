# Multi-stage Dockerfile for INTERLOCK Controller
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

ENV DATABASE_URL="file:./dev.db"

# Generate PKI certs, Prisma client, and SQLite schema
RUN node scripts/generate-pki.mjs
RUN npx prisma generate
RUN npx prisma db push --skip-generate --accept-data-loss
RUN npm run build

# Runner stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL="file:./dev.db"

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dev.db ./dev.db
COPY --from=builder /app/pki ./pki
COPY --from=builder /app/mini-services ./mini-services
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000 3033

CMD ["npm", "start"]
