FROM gradle:8.10.2-jdk21 AS build

WORKDIR /home/gradle/src

COPY build.gradle.kts ./

COPY src ./src

RUN gradle build --no-daemon

FROM amazoncorretto:21

WORKDIR /app

COPY --from=build /home/gradle/src/build/libs/juge.jar ./

EXPOSE 9090

CMD ["java", "-jar", "juge.jar"]
