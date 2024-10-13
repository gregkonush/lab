# Build stage
FROM gradle:8.10.2-jdk21 AS build

WORKDIR /home/gradle/src

# Copy the gradle configuration files
COPY build.gradle.kts ./

# Copy the source code
COPY src ./src

# Build the application
RUN gradle build --no-daemon

# Runtime stage
FROM amazoncorretto:21

WORKDIR /app

# Copy the built artifact from the build stage
COPY --from=build /home/gradle/src/build/libs/juge.jar ./

# Expose the port the app runs on
EXPOSE 8080

# Run the jar file
CMD ["java", "-jar", "juge.jar"]
