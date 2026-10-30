import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, availableResetCredits, inject, openUsagePage } from './index.js';
function harness({ guard = () => undefined, collision = false } = {}) {
  const routes = new Map(), cleanup = [];
  const services = { webServer: { register(r) { if (collision && r.path.endsWith('/summary')) throw Error('duplicate'); routes.set(r.path,r); return () => routes.delete(r.path); } }, credentials: { async readRecord() { return undefined; } }, connection: { requestRejection: guard }, deepseekAccount: {} };
  const ctx = { get(k) { assert.ok(inject.includes(k), `missing inject: ${k}`); return services[k]; }, effect(fn) { cleanup.push(fn()); } };
  return { ctx, routes, cleanup };
}
function response() { return { status: 0, body: '', writeHead(n) { this.status=n; }, end(b) { this.body=b?.toString() || ''; } }; }
test('all used services declared and all routes dispose on unload', () => { const x=harness(); apply(x.ctx); assert.equal(x.routes.size,4); x.cleanup.forEach(f=>f()); assert.equal(x.routes.size,0); });
test('partial registration rolls back', () => { const x=harness({collision:true}); assert.throws(()=>apply(x.ctx), /duplicate/); assert.equal(x.routes.size,0); });
test('authentication exceptions fail closed', async () => { const x=harness({guard:()=>{throw Error('test');}}); apply(x.ctx); const r=response(); await x.routes.get('/openai-quota/summary').handler({method:'GET'},r); assert.equal(r.status,403); });
test('unauthenticated request rejected', async () => { const x=harness({guard:()=>401}); apply(x.ctx); const r=response(); await x.routes.get('/openai-quota/summary').handler({method:'GET'},r); assert.equal(r.status,401); });
test('missing OpenAI credentials do not break summary', async () => { const x=harness(); apply(x.ctx); const r=response(); await x.routes.get('/openai-quota/summary').handler({method:'GET'},r); assert.equal(r.status,200); assert.equal(JSON.parse(r.body).usageError,'not-configured'); });
test('reset card picks nearest valid expiry', () => {
  const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const cards = [
    { status: 'available', is_supported_by_plan: true, reset_type: 'codex_rate_limits', expires_at: future(5) },
    { status: 'available', is_supported_by_plan: true, reset_type: 'codex_rate_limits', expires_at: future(2) },
    { status: 'redeemed', is_supported_by_plan: true, reset_type: 'codex_rate_limits', expires_at: future(1) },
    { status: 'available', is_supported_by_plan: false, reset_type: 'codex_rate_limits', expires_at: future(1) },
    { status: 'available', is_supported_by_plan: true, reset_type: 'codex_rate_limits', expires_at: '2000-01-01T00:00:00Z' },
  ];
  const result = availableResetCredits({ credits: cards, available_count: 5 });
  assert.equal(result.status, 'ready');
  assert.equal(result.count, 2);
  assert.ok(Math.abs(Date.parse(result.nextExpiresAt) - Date.parse(cards[1].expires_at)) < 1);
});
test('reset card with none available reports zero instead of failing', () => {
  assert.deepEqual(availableResetCredits({ credits: [] }), { status: 'ready', count: 0, nextExpiresAt: null });
});
test('reset card rejects an unexpected payload shape', () => {
  assert.equal(availableResetCredits({}).status, 'unavailable');
  assert.equal(availableResetCredits(null).status, 'unavailable');
});
test('opening the usage page never takes a URL from the request', () => {
  const calls = [];
  const result = openUsagePage((command, args, options) => { calls.push({ command, args, options }); return { unref() {} }; });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'cmd.exe');
  assert.deepEqual(calls[0].args, ['/c', 'start', '', 'https://chatgpt.com/settings/usage?tab=overview']);
  assert.equal(calls[0].options.detached, true);
});
test('opening the usage page reports failure instead of throwing', () => {
  const result = openUsagePage(() => { throw new Error('spawn failed'); });
  assert.deepEqual(result, { ok: false, code: 'spawn-failed' });
});
test('the open route rejects GET and answers POST', async () => {
  const x = harness(); apply(x.ctx);
  const route = x.routes.get('/openai-quota/reset-card/open');
  assert.ok(route, 'open route is registered');
  const rejected = response();
  await route.handler({ method: 'GET' }, rejected);
  assert.equal(rejected.status, 405);
  assert.equal(JSON.parse(rejected.body).code, 'method-not-allowed');
});
test('the open route stays behind the local trust check', async () => {
  const x = harness({ guard: () => 401 }); apply(x.ctx);
  const r = response();
  await x.routes.get('/openai-quota/reset-card/open').handler({ method: 'POST' }, r);
  assert.equal(r.status, 401);
});
