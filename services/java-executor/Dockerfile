FROM amazoncorretto:23-alpine

WORKDIR /app

RUN mkdir -p src/ai/proompteng

COPY src/ai/proompteng/JShellServer.java src/ai/proompteng/JShellServer.java

EXPOSE 9090

CMD ["sh", "-c", "java -version && echo 'Starting JShellServer...' && java src/ai/proompteng/JShellServer.java"]
