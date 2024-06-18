FROM node:20

COPY . /starter
COPY package.json /starter/package.json
COPY .env.example /starter/.env.example

WORKDIR /starter

RUN npm install 

CMD ["npm","start"]

EXPOSE 3000