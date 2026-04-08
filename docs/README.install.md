# Agent Install Guide

Use this guide when you want to install the exported skill family into a local agent skills directory.

This is the shared installation path across agent runtimes. Platform-specific notes such as Codex defaults should live in thin supplement pages on top of this guide.

## Recommended Path

From the repository root:

```bash
./setup --install-skills
```

That installs dependencies, builds the CLI, runs the basic environment checks, exports the skill bundles, and copies them into the default install target.

Direct installer path:

```bash
npm run install:skills
```

Use this when you already have the repo checked out and only want to refresh the installed skill bundles.

## Default Install Target

Today the installer resolves the default target like this:

- `$CODEX_HOME/skills` when `CODEX_HOME` is set
- otherwise `~/.codex/skills`

If your agent runtime uses a different skills directory, install directly into it:

```bash
npm run install:skills -- --target-dir /path/to/agent/skills
```

## Copy vs Link Mode

Copy mode is the default:

```bash
npm run install:skills
```

Use this for normal users.

Copy-mode installs are the recommended auto-update path. The installed skill bundle can check the GitHub `VERSION` file during use and reinstall the same selected bundle set when a newer version is available.

Portable installs such as `npx skills add ...` on the root skill or manual copies of exported bundles can also self-check for updates as long as the installed directory includes `runtime/skill-runtime/`. On the first successful self-update, the updater rewrites that portable install into the repo's normal copy-mode layout.

Link mode keeps the installed skills pointed at `dist/skill-bundles/` inside this repository:

```bash
npm run install:skills -- --mode link
```

Use this during local iteration only. After changing skill text or metadata, rerun:

```bash
npm run export:skills
```

The linked install keeps the same target path, so exported bundle refreshes show up without another copy step.

Link mode intentionally does not auto-update from GitHub and is not the recommended end-user install path.

## Common Variants

Install into a custom skills directory:

```bash
npm run install:skills -- --target-dir /tmp/agent-skills
```

Install only selected skills:

```bash
npm run install:skills -- --skill event-tracking-skill --skill tracking-schema
```

Run the full setup and install linked bundles:

```bash
./setup --install-skills --mode link
```

Inspect the generated install plan without changing anything:

```bash
npm run install:skills -- --dry-run
```

## Updating

If this repo is already cloned locally:

```bash
git pull
npm run export:skills
```

If your installer-managed copy predates the installed auto-update bootstrap, reinstall once first:

```bash
npm run install:skills
```

If you use copy mode, rerun the installer after exporting:

```bash
npm run install:skills
```

If you use link mode, exporting is usually enough because the installed skills already point at `dist/skill-bundles/`.

After that one-time reinstall, normal copy-mode usage can self-check for updates during skill invocation.

## Verification

Check that the installed directory contains the expected skill folders, for example:

- `event-tracking-skill`
- `tracking-discover`
- `tracking-group`
- `tracking-live-gtm`
- `tracking-schema`
- `tracking-sync`
- `tracking-verify`
- `tracking-shopify`

## Platform Notes

- [README.codex.md](README.codex.md) for Codex-specific defaults, paths, and troubleshooting
