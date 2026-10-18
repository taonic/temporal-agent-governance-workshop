# The learner sandbox: everything the workshop needs that's slow to install, baked in once.
# Built by course/snapshot/build.mjs from a staged context (this file, plus the workshop
# files listed in course/runner/repo-files.mjs under workshop/). The runner uploads the
# current workshop files again when it creates a sandbox, so only dependency changes
# (pyproject.toml, uv.lock, setup_dogwood.sh, this file) need a new snapshot.

# --- Dogwood: the CLI and the verifier, built by the workshop's own pre-work script --------
# (dogwood-cli 1.1.0 needs a newer Rust than the 1.92 the verifier asks for.)
FROM rust:1.99-bookworm AS dogwood
WORKDIR /build
COPY workshop/scripts/setup_dogwood.sh scripts/setup_dogwood.sh
RUN bash scripts/setup_dogwood.sh && strip .dogwood/bin/*

# --- The sandbox -----------------------------------------------------------------------
FROM python:3.13-slim-bookworm

ARG TEMPORAL_CLI_VERSION=1.8.3
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash-completion ca-certificates curl git jq less nano procps vim-tiny \
 && rm -rf /var/lib/apt/lists/* \
 && arch=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/") \
 && curl -fsSL "https://temporal.download/cli/archive/v${TEMPORAL_CLI_VERSION}?platform=linux&arch=${arch}" -o /tmp/t.tgz \
 && tar -xzf /tmp/t.tgz -C /usr/local/bin temporal \
 && rm /tmp/t.tgz \
 && pip install --no-cache-dir uv==0.13.0

# The editor's language server (hover, go to definition, completion), in its own venv so the
# workshop's `uv sync` never touches it; lsp_bridge.py serves it over a WebSocket.
RUN uv venv -q /opt/lsp \
 && uv pip install -q --no-cache --python /opt/lsp/bin/python jedi-language-server==0.47.0 websockets==17.2
COPY lsp_bridge.py /opt/lsp/lsp_bridge.py

# The pytest checks start their own Temporal (WorkflowEnvironment.start_local), which
# downloads a dev server into the temp dir on first use. Keep that dir in the image.
ENV TMPDIR=/var/cache/workshop-tmp \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    TERM=xterm-256color

WORKDIR /workshop
COPY workshop/ /workshop/
COPY --from=dogwood /build/.dogwood/bin/ /workshop/.dogwood/bin/
RUN mkdir -p "$TMPDIR" \
 && uv sync --frozen \
 && uv run python -c "exec('import asyncio\nfrom temporalio.testing import WorkflowEnvironment as W\nasync def m():\n    e = await W.start_local()\n    await e.shutdown()\nasyncio.run(m())')"
RUN chmod -R a+rwX /workshop "$TMPDIR" \
 && printf '%s\n' \
      'cd /workshop' \
      'export PS1="\[\e[38;5;141m\]workshop\[\e[0m\]:\w\$ "' \
      '[ -f /etc/bash_completion ] && . /etc/bash_completion' \
    >> /etc/bash.bashrc

ENTRYPOINT ["sleep", "infinity"]
