FROM amazoncorretto:23-alpine

WORKDIR /app

COPY src/ai/proompteng/JShellServer.java .

EXPOSE 9090

CMD ["sh", "-c", "java -version && echo 'Starting JShellServer...' && java JShellServer.java"]
