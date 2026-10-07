'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepare, pruneOrt } = require('../prepare-features');

function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-features-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'data');
  const manifests = path.join(tmp, 'manifests');
  for (const name of ['vision', 'speech']) {
    fs.mkdirSync(path.join(manifests, name), { recursive: true });
    fs.writeFileSync(path.join(manifests, name, 'package.json'), JSON.stringify({ dependencies: { 'fake-native': '1.0.0' } }));
    fs.writeFileSync(path.join(manifests, name, 'package-lock.json'), '{}');
  }
  let installs = 0;
  const run = (command, args, options) => {
    if (command !== 'npm') return spawnSync(command, args, options);
    installs++;
    assert.equal(options.env.ONNXRUNTIME_NODE_INSTALL, 'skip');
    const dep = path.join(options.cwd, 'node_modules/fake-native');
    fs.mkdirSync(dep, { recursive: true });
    fs.writeFileSync(path.join(dep, 'index.js'), 'module.exports = {};');
    return { status: 0 };
  };
  return { root, manifests, run, log: () => {}, installs: () => installs };
}

test('capture-only never installs; each feature installs independently and is reused offline', (t) => {
  const f = fixture(t);
  assert.deepEqual(prepare({ ...f, enabled: {} }), {
    vision: { requested: false, ready: false }, speech: { requested: false, ready: false },
  });
  assert.equal(f.installs(), 0);
  for (const enabled of [{ vision: true }, { speech: true }, { vision: true, speech: true }]) {
    const result = prepare({ ...f, enabled });
    for (const name of ['vision', 'speech']) assert.equal(result[name].ready, !!enabled[name]);
    const count = f.installs();
    prepare({ ...f, enabled });
    assert.equal(f.installs(), count, 'cached restart must not contact npm');
  }
});

test('disable removes packages, failed upgrade preserves completed pack and cleans partial data', (t) => {
  const f = fixture(t);
  prepare({ ...f, enabled: { vision: true } });
  const lock = path.join(f.manifests, 'vision/package-lock.json');
  fs.writeFileSync(lock, '{"changed":true}');
  const result = prepare({ ...f, enabled: { vision: true }, run: () => ({ status: 1 }) });
  assert.equal(result.vision.ready, false);
  assert.match(result.vision.error, /installation failed/);
  assert(fs.existsSync(path.join(f.root, 'vision/.ready')));
  assert(!fs.existsSync(path.join(f.root, 'vision.installing')));
  assert(!fs.existsSync(path.join(f.root, 'vision.cache')));
  prepare({ ...f, enabled: {} });
  assert(!fs.existsSync(path.join(f.root, 'vision')));
});

test('broken cached native modules are repaired, never reported ready without validation', (t) => {
  const f = fixture(t);
  prepare({ ...f, enabled: { speech: true } });
  fs.writeFileSync(path.join(f.root, 'speech/node_modules/fake-native/index.js'), 'throw Error("wrong architecture");');
  const result = prepare({ ...f, enabled: { speech: true } });
  assert.equal(f.installs(), 2);
  assert.equal(result.speech.ready, true);
});

test('ONNX pruning preserves only target platform and architecture', (t) => {
  const f = fixture(t);
  const bin = path.join(f.root, 'node_modules/onnxruntime-node/bin/napi-v6');
  for (const sub of ['win32/x64', 'darwin/arm64', 'linux/x64', 'linux/arm64']) fs.mkdirSync(path.join(bin, sub), { recursive: true });
  pruneOrt(f.root, 'linux', 'arm64');
  assert.deepEqual(fs.readdirSync(bin), ['linux']);
  assert.deepEqual(fs.readdirSync(path.join(bin, 'linux')), ['arm64']);
});
