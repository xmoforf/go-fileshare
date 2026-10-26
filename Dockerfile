# Research: https://man7.org/linux/man-pages/man2/openat2.2.html — Linux no-symlink confinement.
FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go index.html ./
RUN CGO_ENABLED=0 go build -trimpath -o /file-share .

FROM scratch
COPY --from=build /file-share /file-share
USER 999:993
ENTRYPOINT ["/file-share"]
