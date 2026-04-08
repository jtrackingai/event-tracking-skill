Install this skill family into Codex from the repository root with:

```bash
./setup --install-skills
```

This copy-mode install is also the path that enables installed auto-update checks.

For a development-friendly install that stays pointed at this repository's exported bundles, use:

```bash
./setup --install-skills --mode link
```

Link mode is for local iteration only and does not auto-update from GitHub.

The installer targets `$CODEX_HOME/skills` when `CODEX_HOME` is set, otherwise `~/.codex/skills`.

For the shared install flow, see [`docs/README.install.md`](../docs/README.install.md).
For Codex-specific defaults and troubleshooting, see [`docs/README.codex.md`](../docs/README.codex.md).
