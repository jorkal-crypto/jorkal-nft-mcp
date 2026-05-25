FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY index.mjs .
EXPOSE 3001
ENV PORT=3001
ENV API_BASE=https://vercel-deploy-alpha-puce.vercel.app
CMD ["node", "index.mjs"]
