'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { createCameraPolicy, authorizeRequest, requestHandler, eventRequest, redactConfig } = require('../security');

const req = (url, token, ip = '192.0.2.10', method = 'GET') => ({ url, method,
  headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-forwarded-for': '127.0.0.1' },
  socket: { remoteAddress: ip } });

test('every data route requires bearer authentication, including socket loopback', () => {
  const routes = ['/', '/snapshot/front_gate', '/latest/front_gate.jpg', '/frame/front_gate',
    '/archive/front_gate/123.jpg', '/look/zones/front_gate/path/123.jpg', '/watchstate/front_gate',
    '/detect/front_gate', '/zones', '/identity', '/listen/front_gate', '/utterance/123', '/audiodebug/front_gate.wav', '/training', '/speech/clip'];
  for (const route of routes) for (const ip of ['192.0.2.10', '127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.throws(() => authorizeRequest(req(route, null, ip), 'secret'), { statusCode: 401 });
    assert.throws(() => authorizeRequest(req(route, 'wrong', ip), 'secret'), { statusCode: 401 });
    assert.equal(authorizeRequest(req(route, 'secret', ip), 'secret').url.pathname, route);
  }
  assert.throws(() => authorizeRequest(req('/snapshot/front_gate', null), ''), { statusCode: 401 });
});

test('health remains public, browser blank and handover remain socket-loopback only', () => {
  assert.equal(authorizeRequest(req('/health'), 'secret').url.pathname, '/health');
  for (const route of ['/blank', '/admin/handover']) {
    assert.throws(() => authorizeRequest(req(route, 'secret'), 'secret'), { statusCode: 403 });
    assert.equal(authorizeRequest(req(route, null, '127.0.0.1'), 'secret').loopback, true);
  }
});

test('reject ambiguous and malformed request targets before dispatch', () => {
  for (const target of ['//[/', 'http://[', 'http://localhost/health', '//localhost/health',
    '/a/../health', '/%68ealth', '/snapshot/%2e%2e', '/snapshot/a%2fb', '/snapshot//front_gate', '/snapshot/\\front_gate', '/health\n']) {
    assert.throws(() => authorizeRequest(req(target, 'secret'), 'secret'), { statusCode: 400 });
  }
  assert.equal(authorizeRequest(req('/snapshot/front_gate?fresh=1&format=json', 'secret'), 'secret').url.searchParams.get('fresh'), '1');
});

test('explicit camera allowlist rejects names before a caller can reach capture or storage', () => {
  const camera = createCameraPolicy('["camera.front_gate","front_yard_camera"]');
  assert.equal(camera('front_gate'), 'camera.front_gate');
  assert.equal(camera('camera.front_gate'), 'camera.front_gate');
  assert.equal(camera('front_yard_camera'), 'camera.front_yard_camera');
  assert.throws(() => camera('kitchen'), { statusCode: 403 });
  assert.throws(() => createCameraPolicy('[]')('front_gate'), { statusCode: 403 });
  for (const value of [null, {}, [], '', '../front_gate', 'camera..', '__proto__/x', 'light.front_gate',
    ' front_gate', 'front_gate ', 'front%5fgate', 'camera.front_gate/other', 'camera.front_gate.jpg']) {
    assert.throws(() => camera(value), { statusCode: 400 });
  }
  assert.throws(() => createCameraPolicy('{}'));
  assert.throws(() => createCameraPolicy('["../x"]'));
});

test('event delivery preserves TLS, ports, supervisor prefix and bearer', () => {
  for (const [input, transport, protocol, port, path] of [
    ['ws://supervisor/core/websocket', http, 'http:', '', '/core/api/events/test'],
    ['wss://ha.example/api/websocket', https, 'https:', '', '/api/events/test'],
    ['wss://ha.example:8443/api/websocket', https, 'https:', '8443', '/api/events/test'],
    ['ws://ha.example:8123/api/websocket', http, 'http:', '8123', '/api/events/test'],
  ]) {
    const result = eventRequest(input, 'test', 'ha-secret');
    assert.equal(result.transport, transport); assert.equal(result.url.protocol, protocol);
    assert.equal(result.url.port, port); assert.equal(result.url.pathname, path);
    assert.equal(result.options.headers.Authorization, 'Bearer ha-secret');
    assert(!result.url.href.includes('ha-secret'));
  }
  assert.throws(() => eventRequest('https://ha.example', 'test', 'secret'));
  assert.throws(() => eventRequest('wss://user:password@ha.example', 'test', 'secret'));
});

test('configuration logging redacts both secrets without changing runtime credentials', () => {
  const cfg = { apiToken: 'api-secret', haToken: 'ha-secret', port: 8098 };
  const log = JSON.stringify(redactConfig(cfg));
  assert(!log.includes('api-secret')); assert(!log.includes('ha-secret'));
  assert.equal(cfg.apiToken, 'api-secret'); assert.equal(redactConfig(cfg).port, 8098);
});

test('wrapper contains synchronous and asynchronous errors and keeps serving', async () => {
  const server = http.createServer(requestHandler(async (request, response) => {
    if (request.url === '/throw') throw new Error('secret internal detail');
    response.end('ok');
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const bad = await fetch(base + '/throw');
    assert.equal(bad.status, 500); assert(!(await bad.text()).includes('secret internal detail'));
    assert.equal(await (await fetch(base + '/health')).text(), 'ok');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
