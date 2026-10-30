FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go index.html ./
RUN CGO_ENABLED=0 go build -trimpath -o /file-share .

FROM scratch
COPY --from=build /file-share /file-share
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/doc/file-share/
COPY licenses/ /usr/share/doc/file-share/licenses/
USER 999:993
ENTRYPOINT ["/file-share"]
