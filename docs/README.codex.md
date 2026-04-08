# Codex Install Guide

Use this guide when you want Codex-specific defaults, paths, and troubleshooting for the exported skill family.

The generic installer flow now lives in [README.install.md](README.install.md). This guide only covers the Codex-specific layer on top of that shared install path.

## Fast Path

From the repository root:

```bash
./setup --install-skills
```

That installs dependencies, builds the CLI, runs the basic environment checks, exports the skill bundles, and copies them into the default skills directory.

Default target resolution:

- `$CODEX_HOME/skills` when `CODEX_HOME` is set
- otherwise `~/.codex/skills`

## Copy vs Link Mode

Copy mode is the default:

```bash
npm run install:skills
```

Use this when you want a self-contained installed copy that does not depend on the repo after installation.

Copy-mode installs are the recommended auto-update path. The installed skill bundle can check the GitHub `VERSION` file during use and reinstall the same selected bundle set when a newer version is available.

Portable Codex installs such as `npx skills add ...` on the root skill can also self-check for updates. After the first successful self-update, that portable install is rewritten into the normal copy-mode layout.

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
npm run install:skills -- --target-dir /tmp/codex-skills
```

Install only selected skills:

```bash
npm run install:skills -- --skill event-tracking-skill --skill tracking-schema
```

Run the full setup and install linked bundles:

```bash
./setup --install-skills --mode link
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

## Verify Discovery

Check that the installed directory contains the expected skill folders, for example:

- `event-tracking-skill`
- `tracking-discover`
- `tracking-group`
- `tracking-live-gtm`
- `tracking-schema`
- `tracking-sync`
- `tracking-verify`
- `tracking-shopify`

You can also inspect the generated install plan without changing anything:

```bash
npm run install:skills -- --dry-run
```

## Troubleshooting

- In Codex environments, run Playwright-backed commands such as `./event-tracking analyze ...` and `./event-tracking preview ...` outside the sandbox from the start. Do not burn a first sandbox attempt before rerunning outside it.
- Treat `./event-tracking sync ...` the same way when OAuth may need a local callback on `127.0.0.1`.
- Link-mode installs do not auto-update.
- Older installer-managed copies need one reinstall before they gain the installed auto-update bootstrap.
- Portable root-skill installs can self-check for updates, but direct phase-skill copies that omit `runtime/skill-runtime/` cannot.
- If the skills are missing, run `npm run export:skills` and then reinstall.
- If Codex does not pick up newly installed skills immediately, restart the Codex session after installation.
- If linked installs appear stale, confirm that `dist/skill-bundles/` was regenerated after the last skill-text change.
- If installation fails because `dist/skill-bundles/manifest.json` is missing, run `npm run export:skills` first.
