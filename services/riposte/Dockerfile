FROM node:lts AS runtime
WORKDIR /app

COPY . .

RUN npm install -g pnpm
RUN pnpm install
RUN ASTRO_DATABASE_FILE=/app/content.db pnpm run build
RUN cp .astro/content.db /app/content.db

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD node ./dist/server/entry.mjs
