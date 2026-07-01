# authzscan

**Autonomous IDOR/BOLA review for Next.js App Router repos, driven by Claude agents.**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx authzscan scan ./my-next-app
```

Finds authenticated users reaching *other people's* data (OWASP A01 broken access
control) — the class pattern-matching SAST misses. Emits Markdown / SARIF / JSON plus a
CI exit code (`0` clean · `1` findings · `2` error).

Full docs, the four-phase pipeline, and the benchmark eval:
https://github.com/davidldv/authzscan
