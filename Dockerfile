FROM node:20
WORKDIR /app
COPY package*.json ./
ENV INSTANCE_CONNECTION_NAME='******'
ENV DB_NAME='cs493-as03-test'
ENV DB_USER='cs493-as03-dbs-user'
ENV DB_PASS='******'
ENV GOOGLE_APPLICATION_CREDENTIALS='./key.json'
RUN npm i
COPY . ./
EXPOSE 8080
CMD [ "node", "main.js" ]