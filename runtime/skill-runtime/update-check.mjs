#!/usr/bin/env node

import { checkForUpdates } from './common.mjs';

function printHelp() {
  console.log(`Usage: node update-check.mjs [options]

Check whether a newer event-tracking skill family version is available.

Options:
  --json        Print machine-readable JSON
  --force       Bypass the local update-check cache
  -h, --help    Show this help message
`);
}

async function main() {
  const args = process.argv.slice(2);
  let asJson = false;
  let force = false;

  for (const arg of args) {
    if (arg === '--json') {
      asJson = true;
      continue;
    }

    if (arg === '--force') {
      force = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      return;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const result = await checkForUpdates(import.meta.url, { force });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.status === 'update_available') {
    console.log(`Update available: ${result.installedVersion} -> ${result.latestVersion}`);
    console.log(`Run: ${result.updateCommand}`);
    return;
  }

  if (result.status === 'up_to_date') {
    console.log(`Up to date: ${result.installedVersion}`);
    return;
  }

  if (result.status === 'disabled') {
    console.log(result.reason);
    return;
  }

  console.log(`Update check failed: ${result.reason}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
