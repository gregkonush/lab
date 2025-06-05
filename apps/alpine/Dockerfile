FROM node:lts-alpine

LABEL maintainer="Greg Konush <gregkonush@gmail.com>"

ENV BUILDER_VERSION=0.0.1

ENV PNPM_HOME="/home/node/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Set labels used in OpenShift to describe the builder image
LABEL io.k8s.description="Node.js LTS with pnpm S2I Builder" \
      io.k8s.display-name="Node.js LTS + pnpm" \
      io.openshift.expose-services="3000:http" \
      io.openshift.s2i.scripts-url="image:///usr/libexec/s2i" \
      io.openshift.tags="builder,nodejs,pnpm,lts"

RUN mkdir -p $PNPM_HOME && \
    corepack enable pnpm && \
    pnpm install -g tsx

# TODO (optional): Copy the builder files into /opt/app-root
# COPY ./<builder_folder>/ /opt/app-root/

# TODO: Copy the S2I scripts to /usr/libexec/s2i, since openshift/base-centos7 image
# sets io.openshift.s2i.scripts-url label that way, or update that label
COPY ./s2i/bin/ /usr/libexec/s2i

# TODO: Drop the root user and make the content of /opt/app-root owned by user 1001
# RUN chown -R 1001:1001 /opt/app-root

# This default user is created in the openshift/base-centos7 image
# USER 1001

# Set the default port for applications built using this image
EXPOSE 3000

# TODO: Set the default CMD for the image
# CMD ["/usr/libexec/s2i/usage"]
