# Multi-stage Dockerfile for INTERLOCK Controller
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

# Generate PKI certs and Prisma client
RUN node scripts/generate-pki.mjs
RUN npx prisma generate
RUN npm run build

# Runner stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/pki ./pki
COPY --from=builder /app/mini-services ./mini-services
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000 3033

CMD ["npm", "run", "dev"]
