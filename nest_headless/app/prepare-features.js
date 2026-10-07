'use strict';

// Optional dependencies live outside the image, in the add-on's persistent data.
// Never download them until requested. Failed installs cannot replace a complete
// pack, and cannot prevent the capture-only server from starting.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const PACKS = ['vision', 'speech'];

function pruneOrt(root, platform = process.platform, arch = process.arch) {
  const bin = path.join(root, 'node_modules/onnxruntime-node/bin/napi-v6');
  if (!fs.existsSync(bin)) return;
  for (const name of fs.readdirSync(bin)) {
    if (name !== platform) fs.rmSync(path.join(bin, name), { recursive: true, force: true });
  }
  for (const name of fs.readdirSync(path.join(bin, platform))) {
    if (name !== arch) fs.rmSync(path.join(bin, platform, name), { recursive: true, force: true });
  }
}

function prepare({ root, enabled, manifests = path.join(__dirname, 'features'), run = spawnSync, log = console.log }) {
  const state = {};
  for (const name of PACKS) {
    const target = path.join(root, name);
    const staging = path.join(root, name + '.installing');
    const cache = path.join(root, name + '.cache');
    state[name] = { requested: !!enabled[name], ready: false };
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(cache, { recursive: true, force: true });
      if (!enabled[name]) {
        fs.rmSync(target, { recursive: true, force: true });
        continue;
      }
      const source = path.join(manifests, name);
      const manifest = fs.readFileSync(path.join(source, 'package.json'));
      const lock = fs.readFileSync(path.join(source, 'package-lock.json'));
      const fingerprint = crypto.createHash('sha256').update(manifest).update(lock)
        .update(`${process.platform}/${process.arch}/${process.versions.modules}/cpu-only-v1`).digest('hex');
      const validate = (dir) => {
        const dependencies = Object.keys(JSON.parse(manifest).dependencies);
        const code = dependencies.map((dep) => `require(${JSON.stringify(path.join(dir, 'node_modules', dep))})`).join(';');
        const result = run(process.execPath, ['-e', code], { timeout: 30000, stdio: 'pipe' });
        return result.status === 0;
      };
      const marker = path.join(target, '.ready');
      if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === fingerprint && validate(target)) {
        state[name].ready = true;
        log(`[nest_headless] ${name} dependencies ready (cached, no download)`);
        continue;
      }
      log(`[nest_headless] Installing optional ${name} dependencies; first start needs internet and free disk space`);
      fs.mkdirSync(staging, { recursive: true });
      fs.writeFileSync(path.join(staging, 'package.json'), manifest);
      fs.writeFileSync(path.join(staging, 'package-lock.json'), lock);
      const result = run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--cache', cache], {
        cwd: staging, stdio: 'inherit', timeout: 10 * 60 * 1000,
        env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip', npm_config_fetch_retries: '1' },
      });
      if (result.status !== 0) throw new Error(`npm installation failed${result.error ? ': ' + result.error.message : ''}`);
      pruneOrt(staging);
      if (!validate(staging)) throw new Error('native dependency load check failed');
      fs.writeFileSync(path.join(staging, '.ready'), fingerprint);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
      state[name].ready = true;
      log(`[nest_headless] ${name} dependencies installed`);
    } catch (error) {
      state[name].error = error.message;
      log(`[nest_headless] ${name} unavailable: ${error.message}; capture remains available. Restart to retry.`);
    } finally {
      for (const dir of [staging, cache]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { log(`[nest_headless] Could not clean ${dir}: ${error.message}`); }
      }
    }
  }
  return state;
}

if (require.main === module) {
  const root = process.env.FEATURE_DATA_DIR || '/data/nest-features';
  const state = prepare({ root, enabled: {
    vision: process.env.ENABLE_VISION === 'true', speech: process.env.ENABLE_SPEECH === 'true',
  } });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'status.json'), JSON.stringify(state));
}
module.exports = { prepare, pruneOrt };
