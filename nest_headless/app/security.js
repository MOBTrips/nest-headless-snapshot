'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function canonicalCamera(name) {
  if (typeof name !== 'string' || !/^(?:camera\.)?[a-z0-9_]+$/.test(name)) {
    throw httpError(400, 'invalid camera entity');
  }
  return name.startsWith('camera.') ? name : 'camera.' + name;
}

function createCameraPolicy(json) {
  let names;
  try { names = JSON.parse(json); } catch { throw new Error('ALLOWED_CAMERAS must be a JSON array'); }
  if (!Array.isArray(names)) throw new Error('ALLOWED_CAMERAS must be a JSON array');
  const allowed = new Set(names.map(canonicalCamera));
  return (name) => {
    const entity = canonicalCamera(name);
    if (!allowed.has(entity)) throw httpError(403, 'camera not allowed');
    return entity;
  };
}

function isLoopback(req) {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
}

function authorizeRequest(req, apiToken) {
  // Only origin-form targets with literal, unambiguous path components.
  const target = req.url;
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || /[\\\s\x00-\x1f\x7f]/.test(target)) {
    throw httpError(400, 'invalid request target');
  }
  let url;
  try { url = new URL(target, 'http://localhost'); } catch { throw httpError(400, 'invalid request target'); }
  const rawPath = target.split('?')[0];
  if (rawPath.includes('%') || rawPath.includes('//') || rawPath.split('/').some((p) => p === '.' || p === '..')) {
    throw httpError(400, 'invalid request path');
  }
  const loopback = isLoopback(req);
  if (url.pathname === '/health' && req.method === 'GET') return { url, loopback };
  if (url.pathname === '/blank' || url.pathname === '/admin/handover') {
    if (!loopback) throw httpError(403, 'loopback only');
    return { url, loopback };
  }
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from('Bearer ' + apiToken);
  if (!apiToken || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw httpError(401, 'authentication required');
  }
  return { url, loopback };
}

function requestHandler(handler) {
  return (req, res) => {
    Promise.resolve().then(() => handler(req, res)).catch((error) => {
      if (res.headersSent) { res.destroy(); return; }
      const status = [400, 401, 403, 404, 405].includes(error.statusCode) ? error.statusCode : 500;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, reason: status === 500 ? 'request failed' : error.message }));
    });
  };
}

function eventRequest(wsUrl, type, token) {
  const url = new URL(wsUrl);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid HA websocket URL');
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = (url.hostname === 'supervisor' ? '/core/api/events/' : '/api/events/') + encodeURIComponent(type);
  url.search = ''; url.hash = '';
  return { transport: url.protocol === 'https:' ? https : http, url,
    options: { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } } };
}

function redactConfig(cfg) {
  return { ...cfg, haToken: cfg.haToken ? '<set>' : '', apiToken: cfg.apiToken ? '<set>' : '' };
}

module.exports = { canonicalCamera, createCameraPolicy, authorizeRequest, requestHandler, eventRequest, redactConfig };
