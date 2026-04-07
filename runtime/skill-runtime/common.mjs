import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 1000;

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) {
    return null;
  }

  return match.slice(1).map(part => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  if (!leftParts || !rightParts) {
    return left.localeCompare(right);
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

function getCodexHome() {
  if (process.env.CODEX_HOME?.trim()) {
    return path.resolve(process.env.CODEX_HOME);
  }

  return path.join(os.homedir(), '.codex');
}

function getBundleDir(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), '..', '..');
}

function getRuntimePaths(bundleDir) {
  return {
    bundleDir,
    skillFile: path.join(bundleDir, 'SKILL.md'),
    bundleMetadataFile: path.join(bundleDir, 'bundle.json'),
    installMetadataFile: path.join(bundleDir, '.event-tracking-install.json'),
    updateStateFile: path.join(bundleDir, '.event-tracking-update-state.json'),
  };
}

function loadInstallContext(metaUrl) {
  const bundleDir = getBundleDir(metaUrl);
  const paths = getRuntimePaths(bundleDir);
  const bundleMetadata = readJsonIfExists(paths.bundleMetadataFile);
  const installMetadata = readJsonIfExists(paths.installMetadataFile);

  if (!bundleMetadata) {
    throw new Error(`Missing bundle metadata: ${paths.bundleMetadataFile}`);
  }

  return {
    bundleDir,
    paths,
    bundleMetadata,
    installMetadata,
  };
}

function resolveUpdateSource(bundleMetadata, installMetadata) {
  const source = {
    provider: 'github-tarball',
    versionUrl: process.env.EVENT_TRACKING_UPDATE_VERSION_URL
      || installMetadata?.updateSource?.versionUrl
      || bundleMetadata.updateSource?.versionUrl
      || 'https://raw.githubusercontent.com/jtrackingai/event-tracking-skill/main/VERSION',
    tarballUrl: process.env.EVENT_TRACKING_UPDATE_TARBALL_URL
      || installMetadata?.updateSource?.tarballUrl
      || bundleMetadata.updateSource?.tarballUrl
      || 'https://codeload.github.com/jtrackingai/event-tracking-skill/tar.gz/refs/heads/main',
  };

  return source;
}

function shouldUseCache(state, installedVersion, force, ttlMs) {
  if (force || !state || state.installedVersion !== installedVersion) {
    return false;
  }

  if (typeof state.checkedAt !== 'string') {
    return false;
  }

  const checkedAt = Date.parse(state.checkedAt);
  if (Number.isNaN(checkedAt)) {
    return false;
  }

  return (Date.now() - checkedAt) < ttlMs;
}

function requestUrl(url, timeoutMs, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects while fetching ${url}`));
  }

  const parsed = new URL(url);
  if (parsed.protocol === 'file:') {
    return Promise.resolve(fs.readFileSync(parsed, 'utf8'));
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.reject(new Error(`Unsupported URL protocol: ${parsed.protocol}`));
  }

  const client = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(parsed, res => {
      const statusCode = res.statusCode ?? 0;
      const location = res.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        res.resume();
        resolve(requestUrl(new URL(location, parsed).toString(), timeoutMs, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${statusCode} while fetching ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out after ${timeoutMs}ms while fetching ${url}`)));
    req.on('error', reject);
  });
}

function downloadFile(url, outputFile, timeoutMs, redirectCount = 0) {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') {
    ensureDir(path.dirname(outputFile));
    fs.copyFileSync(parsed, outputFile);
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  if (redirectCount > 5) {
    throw new Error(`Too many redirects while downloading ${url}`);
  }

  const client = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.get(parsed, res => {
      const statusCode = res.statusCode ?? 0;
      const location = res.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        res.resume();
        resolve(downloadFile(new URL(location, parsed).toString(), outputFile, timeoutMs, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${statusCode} while downloading ${url}`));
        return;
      }

      ensureDir(path.dirname(outputFile));
      const file = fs.createWriteStream(outputFile);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
      file.on('error', error => reject(error));
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out after ${timeoutMs}ms while downloading ${url}`)));
    req.on('error', reject);
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? 'pipe',
    env: options.env ?? process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      stdout ? `stdout: ${stdout}` : '',
      stderr ? `stderr: ${stderr}` : '',
    ].filter(Boolean).join('\n'));
  }

  return result;
}

async function checkForUpdates(metaUrl, options = {}) {
  const context = loadInstallContext(metaUrl);
  const installedVersion = context.installMetadata?.installedVersion || context.bundleMetadata.familyVersion;
  const ttlMs = Number.parseInt(
    options.ttlMs
      ?? process.env.EVENT_TRACKING_UPDATE_CACHE_TTL_MS
      ?? `${DEFAULT_CACHE_TTL_MS}`,
    10,
  );
  const effectiveTtlMs = Number.isFinite(ttlMs) ? ttlMs : DEFAULT_CACHE_TTL_MS;
  const force = !!options.force;
  const autoUpdateEnabled = !!context.installMetadata?.autoUpdateEnabled;
  const source = resolveUpdateSource(context.bundleMetadata, context.installMetadata);
  const previousState = readJsonIfExists(context.paths.updateStateFile);

  if (!autoUpdateEnabled) {
    return {
      status: 'disabled',
      autoUpdateEnabled,
      bundleName: context.bundleMetadata.name,
      installedVersion,
      checkedAt: new Date().toISOString(),
      reason: context.installMetadata
        ? `Auto-update is disabled for install mode "${context.installMetadata.installMode}".`
        : 'Auto-update metadata is missing for this installed bundle.',
      updateCommand: null,
    };
  }

  if (shouldUseCache(previousState, installedVersion, force, effectiveTtlMs)) {
    return previousState;
  }

  try {
    const latestVersion = (await requestUrl(source.versionUrl, DEFAULT_TIMEOUT_MS)).trim();
    const checkedAt = new Date().toISOString();
    const updateAvailable = compareVersions(installedVersion, latestVersion) < 0;
    const result = {
      status: updateAvailable ? 'update_available' : 'up_to_date',
      autoUpdateEnabled,
      bundleName: context.bundleMetadata.name,
      installedVersion,
      latestVersion,
      checkedAt,
      selectedBundles: context.installMetadata?.selectedBundles || [context.bundleMetadata.name],
      updateCommand: `node ${JSON.stringify(path.join(context.bundleDir, 'runtime', 'skill-runtime', 'self-update.mjs'))} --apply`,
      targetDir: context.installMetadata?.targetDir || path.dirname(context.bundleDir),
      updateSource: source,
    };
    writeJson(context.paths.updateStateFile, result);
    return result;
  } catch (error) {
    const result = {
      status: 'error',
      autoUpdateEnabled,
      bundleName: context.bundleMetadata.name,
      installedVersion,
      checkedAt: new Date().toISOString(),
      reason: (error instanceof Error ? error.message : String(error)),
      updateCommand: null,
      updateSource: source,
    };
    writeJson(context.paths.updateStateFile, result);
    return result;
  }
}

export {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_TIMEOUT_MS,
  compareVersions,
  downloadFile,
  ensureDir,
  getBundleDir,
  getCodexHome,
  getRuntimePaths,
  loadInstallContext,
  readJsonIfExists,
  requestUrl,
  resolveUpdateSource,
  runCommand,
  shouldUseCache,
  writeJson,
  checkForUpdates,
};
