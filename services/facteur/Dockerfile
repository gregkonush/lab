# syntax=docker/dockerfile:1.7-labs

FROM golang:1.24 AS build
WORKDIR /workspace

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
	go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/facteur ./cmd/facteur

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/facteur /usr/local/bin/facteur

ENTRYPOINT ["/usr/local/bin/facteur"]
CMD ["serve"]
