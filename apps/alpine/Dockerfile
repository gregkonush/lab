FROM node:lts-alpine

LABEL maintainer="Greg Konush <greg.konush@gmail.com>"

ENV BUILDER_VERSION=0.0.1

ENV PNPM_HOME="/opt/app-root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Set labels used in OpenShift to describe the builder image
LABEL io.k8s.description="Node.js LTS with pnpm S2I Builder" \
      io.k8s.display-name="Node.js LTS + pnpm" \
      io.openshift.expose-services="8080:http" \
      io.openshift.s2i.scripts-url="image:///usr/libexec/s2i" \
      io.openshift.tags="builder,nodejs,pnpm,lts"

RUN addgroup -S -g 1001 app && \
    adduser -S -u 1001 -G app -h /opt/app-root -s /bin/false app && \
    mkdir -p /opt/app-root/src /opt/app-root/.local/share/pnpm && \
    chown -R app:app /opt/app-root && \
    corepack enable pnpm

# TODO (optional): Copy the builder files into /opt/app-root
# COPY ./<builder_folder>/ /opt/app-root/

# TODO: Copy the S2I scripts to /usr/libexec/s2i, since openshift/base-centos7 image
# sets io.openshift.s2i.scripts-url label that way, or update that label
COPY --chown=app:app ./s2i/bin/ /usr/libexec/s2i

WORKDIR /opt/app-root
USER 1001

RUN pnpm install -g tsx

# Set the default port for applications built using this image
EXPOSE 8080

# Set the default CMD for the image
CMD ["/usr/libexec/s2i/run"]
