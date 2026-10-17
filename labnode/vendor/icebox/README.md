# icebox (vendored)

`icebox_vlog.py`, `icebox.py` and `iceboxdb.py` from [Project IceStorm](https://github.com/YosysHQ/icestorm), commit `b77a2d5b84d88cdab96b218c21330bd609af4546`, unmodified. ISC license, see `COPYING`.

`labnode/src/bitstream-readback.mjs` runs `icebox_vlog` to turn an iCE40 bitstream back into Verilog, so a lab node without a board can simulate exactly what a board would be flashed with. Needs Python 3.
