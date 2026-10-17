# Deploying with Docker

Two containers, built from this repo:

| Image | Built from | Runs where | Holds |
|---|---|---|---|
| platform | `server/Dockerfile` | our server | the API, the WebSocket hub, the SQLite database and the built web app |
| labnode | `labnode/Dockerfile` | a college machine next to a lent board, or our server as a simulation node | the agent, the examiner key (sim mode) and the toolchain |

Both images copy `rtl/challenges` in read only; the lab node also takes `rtl/boards`. Rebuild the lab node image when challenges change, or it fails new ones with "this lab node doesn't have the challenge yet".

## The demo: platform and a sim lab node on one machine

```bash
docker compose up -d --build
```

- Open `http://<host>:4000` and pick a person. The seeded people are fictional and sign in without a password, because `compose.yaml` turns demo sign-in on. Set `CCL_DEMO_LOGIN=0` once real accounts use it.
- On its first start the platform seeds the demo data and writes the demo node's token to the `node-token` volume. The lab node reads it from there and pairs as `iiitd-01`. Later starts keep the database.
- `CCL_PORT=4300 docker compose up -d` publishes on another port.

| Task | Command |
|---|---|
| Logs | `docker compose logs -f platform labnode` |
| Node status, enrollments | `docker compose exec platform npm run admin -w server -- list` |
| Fresh demo data | `docker compose stop && docker compose run --rm platform seed && docker compose up -d` |
| Start over completely | `docker compose down -v` (deletes the database and the lab node's examiner key) |

The database lives in the `platform-data` volume and the sim examiner key in `labnode-keys`. Keep `labnode-keys`: a node that comes back with a new key is refused, because the platform pinned the old one. If it's lost, run `admin unpin iiitd-01` to reopen pairing.

## A college lab node

The club registers the board on the Labs page (Lend a board), which shows the node id and a token once. Or the operator issues a token with `admin token <node>`. On the college machine:

```bash
CCL_SERVER=ws://<platform host>:4000/ws/node CCL_NODE=<node id> CCL_NODE_TOKEN=<token> \
  docker compose -f labnode/compose.yaml up -d --build
```

The node connects out, so the college needs no open ports. It has 24 hours from the token's issue to pair its examiner key.

For real hardware (`CCL_MODE=hw`):

1. Pass the ESP32 and the iCEBreaker through to the container (the commented `devices:` lines in `labnode/compose.yaml`) and set `CCL_SERIAL`, e.g. `/dev/ttyACM0`.
2. Print the ESP32's public key and send it to the operator, who enrolls it as silicon. An unenrolled ESP32 is refused.
   ```bash
   docker compose -f labnode/compose.yaml run --rm labnode --info --mode=hw --serial=/dev/ttyACM0 > examiner.pem
   docker compose exec platform npm run admin -w server -- enroll <node> /path/to/examiner.pem   # on the platform
   ```

## Notes

- **Icarus Verilog 12 or newer.** Sim mode simulates the synthesized netlist against yosys's `cells_sim.v`, which Icarus 11 can't parse. The lab node image is Debian trixie, which ships 12. Outside Docker, the agent refuses to start on 11 (Ubuntu 22.04's package).
- **Behind a reverse proxy**, set `CCL_TRUST_PROXY` on the platform (for example `loopback, uniquelocal`). Otherwise every user shares the proxy's address and the sign-in, booking and attempt rate limits.
- **"Verify it yourself" needs HTTPS.** The proof page checks signatures with WebCrypto, which browsers only allow on `https://` or `localhost`. Over plain `http://<lan ip>:4000` everything else works but that button reports it can't run. A Cloudflare tunnel or any TLS proxy in front fixes it.
- **Lab nodes over the internet** should use `wss://` through a TLS proxy, so the node token isn't sent in the clear.
