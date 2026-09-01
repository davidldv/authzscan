#!/usr/bin/env python3
"""Record a real authzscan run and render it as a terminal GIF for the README.

Two steps, so a scan that costs real money is never re-run just to retouch the
image. `record` captures (elapsed, line) pairs to JSONL; `render` turns that
log into a GIF. On Windows the usual asciinema/agg path needs a pty and a Rust
binary, so this does the same job with PIL and no new dependencies.

  python scripts/record-demo.py record docs/demo.jsonl -- npx authzscan scan ./benchmark
  python scripts/record-demo.py render docs/demo.jsonl docs/demo.gif
"""
import json, subprocess, sys, time, textwrap
from pathlib import Path

# ponytail: fixed 96x28 terminal. Wide enough for the report table, small enough
# that GitHub renders the GIF at full size without scaling it down.
COLS, ROWS, FONT_SIZE = 96, 28, 15
BG, FG, DIM, ACCENT = (13, 17, 23), (201, 209, 217), (110, 118, 129), (126, 231, 135)
MAX_HOLD_MS, MIN_HOLD_MS, TAIL_MS = 1400, 90, 2500


def record(log_path, argv):
    Path(log_path).parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    rows = [{"t": 0.0, "line": "$ " + " ".join(argv)}]
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            bufsize=1, text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        line = line.rstrip("\n")
        rows.append({"t": round(time.time() - t0, 2), "line": line})
        print(line, flush=True)
    code = proc.wait()
    rows.append({"t": round(time.time() - t0, 2), "line": "$ echo $?  # %d" % code})
    with open(log_path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print("\nrecorded %d lines -> %s (exit %d)" % (len(rows), log_path, code), file=sys.stderr)
    return code


def render(log_path, gif_path):
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", FONT_SIZE)
    cw = int(font.getlength("M"))
    lh = FONT_SIZE + 5
    pad = 14
    W, H = cw * COLS + pad * 2, lh * ROWS + pad * 2

    rows = [json.loads(l) for l in open(log_path, encoding="utf-8") if l.strip()]
    # Wrap first, so the visible buffer matches what a real terminal would show.
    wrapped = []
    for r in rows:
        for chunk in (textwrap.wrap(r["line"], COLS) or [""]):
            wrapped.append((r["t"], chunk))

    frames, delays, buf = [], [], []
    for i, (t, text) in enumerate(wrapped):
        buf = (buf + [text])[-ROWS:]
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        for j, ln in enumerate(buf):
            color = ACCENT if ln.startswith("$") else DIM if ln.startswith("[authzscan]") else FG
            d.text((pad, pad + j * lh), ln, font=font, fill=color)
        # Real elapsed time between lines, clamped so a 19-minute scan still
        # plays in under a minute and a burst of output stays readable.
        nxt = wrapped[i + 1][0] if i + 1 < len(wrapped) else t
        delays.append(max(MIN_HOLD_MS, min(MAX_HOLD_MS, int((nxt - t) * 1000) or MIN_HOLD_MS)))
        frames.append(img.convert("P", palette=Image.ADAPTIVE, colors=32))
    delays[-1] = TAIL_MS

    Path(gif_path).parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(gif_path, save_all=True, append_images=frames[1:],
                   duration=delays, loop=0, optimize=True)
    print("%s: %d frames, %.1fs, %.0f KB" %
          (gif_path, len(frames), sum(delays) / 1000, Path(gif_path).stat().st_size / 1024))


if __name__ == "__main__":
    if sys.argv[1] == "record":
        sys.exit(record(sys.argv[2], sys.argv[sys.argv.index("--") + 1:]))
    elif sys.argv[1] == "render":
        render(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
