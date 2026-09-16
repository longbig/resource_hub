FROM golang:1.24.9-alpine AS builder
WORKDIR /src
COPY vendor/pansou/go.mod vendor/pansou/go.sum ./
RUN go mod download
COPY vendor/pansou/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /pansou .
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -D pansou
COPY --from=builder /pansou /usr/local/bin/pansou
COPY vendor/pansou/LICENSE /usr/share/licenses/pansou/LICENSE
USER pansou
EXPOSE 8888
ENTRYPOINT ["/usr/local/bin/pansou"]
