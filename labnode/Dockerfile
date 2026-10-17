# Lab node agent: runs at a college next to a lent board (hw), or as a simulation node (sim).
# Build from the repo root:  docker build -f labnode/Dockerfile .
#
# Debian trixie because sim mode needs Icarus Verilog 12 or newer (bookworm and Ubuntu 22.04 ship 11).
# yosys comes from npm as WebAssembly. nextpnr-ice40 and icestorm are only used in hw mode.

FROM node:24-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends iverilog nextpnr-ice40 fpga-icestorm \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY labnode/package.json labnode/
# tsx runs the TypeScript sources directly, so dev dependencies stay in
RUN npm ci -w labnode --include=dev --no-audit --no-fund && npm cache clean --force
COPY labnode labnode
# The testbenches the simulation examiner runs and the board's pin map; read only, never modified here
COPY rtl/challenges rtl/challenges
COPY rtl/boards rtl/boards
# The examiner key and its counter live in /keys; keep it on a volume or the platform refuses
# the node after a restart (the pinned key would no longer match)
RUN mkdir -p /keys && chown node:node /keys && usermod -aG dialout,plugdev node

ENV NODE_ENV=production CCL_KEYS_DIR=/keys CCL_WORK_DIR=/tmp/ccl-work
USER node
VOLUME ["/keys"]
# The node's dashboard, when CCL_DASHBOARD_PORT=4100
EXPOSE 4100
WORKDIR /app/labnode
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "--import", "tsx", "src/agent.ts"]
