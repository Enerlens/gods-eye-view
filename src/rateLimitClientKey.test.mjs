// The per-IP throttles key on `clientKeyFor`. Behind a tunnel the socket peer
// is the proxy, so without a trusted header every visitor shares one bucket —
// measured on staging 2026-09-09. These pin the opt-in and its refusal to
// trust anything by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientKeyFor } from '../vite.config.js';

const request = (headers = {}, remoteAddress = '172.22.0.1') => ({ headers, socket: { remoteAddress } });

test('by default the socket peer is the key and no header is believed', () => {
  const req = request({ 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(clientKeyFor(req, undefined), '172.22.0.1');
  assert.equal(clientKeyFor(req, ''), '172.22.0.1', 'an empty setting is the default, not a wildcard');
  assert.equal(clientKeyFor({ headers: {}, socket: {} }, undefined), 'local');
});

test('a named trusted header replaces the socket peer, case-insensitively and first-value-only', () => {
  const req = request({ 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(clientKeyFor(req, 'CF-Connecting-IP'), '203.0.113.9');
  assert.equal(clientKeyFor(request({ 'x-real-ip': ' 198.51.100.4 , 10.0.0.1' }), 'x-real-ip'), '198.51.100.4', 'a proxy chain lists the client first');
  assert.equal(clientKeyFor(request({ 'x-real-ip': ['198.51.100.4', '10.0.0.1'] }), 'x-real-ip'), '198.51.100.4');
});

test('a trusted header that is absent falls back to the socket — a direct caller is not keyless', () => {
  assert.equal(clientKeyFor(request({}), 'cf-connecting-ip'), '172.22.0.1');
  assert.equal(clientKeyFor(request({ 'cf-connecting-ip': '   ' }), 'cf-connecting-ip'), '172.22.0.1', 'blank is absent');
});
