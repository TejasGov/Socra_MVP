FROM node:22-alpine
COPY bootstrap.js harness.js /opt/socra/
ENTRYPOINT ["node", "/opt/socra/bootstrap.js"]
