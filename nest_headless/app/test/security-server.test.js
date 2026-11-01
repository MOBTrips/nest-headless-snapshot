'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function start(t, entrypoint, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nest-security-'));
  const out = path.join(root, 'nest_snapshots'); await fs.mkdir(out);
  await fs.writeFile(path.join(out, 'front_gate.jpg'), Buffer.from('fixture-camera-frame'));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise((resolve) => listener.close(resolve));
  let log = '';
  const child = spawn(process.execPath, [entrypoint], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, HA_CONFIG_DIR: root, PORT: String(port), API_TOKEN: 'fixture-api-secret',
      HA_TOKEN: 'fixture-ha-secret', SUPERVISOR_TOKEN: '', HA_WS_URL: 'ws://127.0.0.1:1/api/websocket',
      ENABLE_VISION: 'false', ENABLE_SPEECH: 'false', WATCHES: '', AUDIO_CAMERAS: '',
      ALLOWED_CAMERAS: '["camera.front_gate"]', ...extra } });
  child.stdout.on('data', (data) => { log += data; }); child.stderr.on('data', (data) => { log += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('server failed to start: ' + log);
    try { if ((await fetch(base + '/health')).ok) return { child, base, port, log: () => log }; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not become healthy: ' + log);
}

for (const entrypoint of ['server.js', '../server.js']) test('real server authorization, camera boundary and recovery: ' + entrypoint, async (t) => {
  const app = await start(t, entrypoint);
  const headers = { Authorization: 'Bearer fixture-api-secret' };
  assert.equal((await fetch(app.base + '/')).status, 401);
  assert.equal((await fetch(app.base + '/', { headers })).status, 200);
  for (const route of ['/latest/front_gate.jpg', '/snapshot/kitchen', '/frame/kitchen', '/archive/kitchen/123.jpg', '/watchstate/kitchen']) {
    assert.equal((await fetch(app.base + route)).status, 401);
  }
  assert.equal((await fetch(app.base + '/latest/front_gate.jpg', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const frame = await fetch(app.base + '/latest/front_gate.jpg', { headers });
  assert.equal(frame.status, 200); assert.equal(await frame.text(), 'fixture-camera-frame');
  for (const route of ['/snapshot/kitchen', '/latest/kitchen.jpg', '/frame/kitchen', '/watchstate/kitchen']) {
    assert.equal((await fetch(app.base + route, { headers })).status, 403);
  }
  // Raw HTTP avoids client URL normalization hiding the original crash trigger.
  for (const target of ['//[/', 'http://[', '/snapshot/%2e%2e', '/snapshot//front_gate']) {
    const response = await new Promise((resolve, reject) => {
      const socket = net.connect(app.port, '127.0.0.1'); let data = '';
      socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('timeout')); });
      socket.on('connect', () => socket.end('GET ' + target + ' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      socket.on('data', (chunk) => { data += chunk; }); socket.on('error', reject); socket.on('end', () => resolve(data));
    });
    assert.match(response, /^HTTP\/1\.1 400/);
    assert.equal((await fetch(app.base + '/health')).status, 200);
  }
  assert(!app.log().includes('fixture-api-secret')); assert(!app.log().includes('fixture-ha-secret'));
  assert(!app.log().includes('chromium pid'), 'denied camera requests must not launch a browser');
});
