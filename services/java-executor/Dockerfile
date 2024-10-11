FROM amazoncorretto:23-alpine

WORKDIR /app

COPY src/JShellServer.java .

EXPOSE 9090

CMD ["sh", "-c", "java -version && echo 'Starting JShellServer...' && java JShellServer.java"]
