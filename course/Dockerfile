# syntax=docker/dockerfile:1.7
# The course site and its runner, in one Node process. Build it from the repo root: the
# runner uploads the workshop's own files into each learner's sandbox, so they ship in the
# image too (course/.dockerignore keeps the rest out).
#
#   npm run deploy        (in course/; see course/DEPLOY.md)

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY course/package.json course/package-lock.json course/
RUN cd course && npm ci
COPY . .
RUN cd course && npm run build && npm test && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    COURSE_DIST_DIR=/repo/course/web/dist
COPY --from=build /repo /repo
USER node
EXPOSE 8080 8081
CMD ["node", "course/runner/server.mjs"]
