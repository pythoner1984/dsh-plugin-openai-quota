import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8');

function flatten(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'object' && node.props) return flatten(node.children);
  return '';
}

function render(state, localeId = 'zh', options = {}) {
  let loading = null;
  const timers = [];
  const window = {
    __ModuleLoader__: { load: (definition) => { loading = definition; } },
    open: options.open || (() => null),
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    navigator: options.navigator || { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0 Safari/537.36' },
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: () => [React.__states.shift(), () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    Component: class { constructor(props) { this.props = props; } setState() {} },
  };
  React.__states = [0, state];
  new Function('window', 'require', source)(window, (name) => {
    assert.equal(name, 'react');
    return React;
  });
  assert.equal(loading.id, 'dsh-plugin-openai-quota');
  const exported = loading.factory((name) => React);
  const locale = { getLocale: () => localeId, subscribe: () => () => {} };
  let renderer = null;
  exported.apply({
    get: () => locale,
    slots: { inject: (_key, callback) => callback(), register: (_options, fn) => { renderer = fn; } },
  });
  const boundary = renderer({});
  const widget = boundary.children[0];
  const tree = widget.type(widget.props);
  return { text: flatten(tree.children), tree, timers };
}

const readyBase = {
  usage: { rate_limit: { primary_window: { used_percent: 74, reset_after_seconds: 3600 }, secondary_window: { used_percent: 54, reset_after_seconds: 400000 } } },
  deepseek: { wallets: [{ currency: 'CNY', balance: '65.2' }] },
};

test('shows the nearest reset-card expiry when cards are available', () => {
  const { text } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 1, nextExpiresAt: '2026-11-06T21:23:57.312Z' } });
  assert.match(text, /重置卡：/);
  assert.match(text, /1张 11月7日 05:23到期/);
  assert.match(text, /DeepSeek余额：65\.2元/);
});

test('shows none when no card is available', () => {
  const { text } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 0, nextExpiresAt: null } });
  assert.match(text, /重置卡：无$/);
});

test('shows a distinct unavailable state instead of claiming none', () => {
  const { text } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'unavailable', code: 'upstream-http' } });
  assert.match(text, /重置卡：暂不可用$/);
  assert.doesNotMatch(text, /重置卡：无/);
});

function findKey(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findKey(child, key);
      if (hit) return hit;
    }
    return null;
  }
  if (node.props && node.props.key === key) return node;
  return findKey(node.children, key);
}

test('renders the reset card as a link to the official usage page', () => {
  const { tree } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 2, nextExpiresAt: '2026-11-06T21:23:57.312Z' } });
  const link = findKey(tree, 'reset-card-link');
  assert.ok(findKey(tree, 'reset-card'), 'reset card segment is rendered');
  assert.equal(link.type, 'a');
  assert.equal(link.props.href, 'https://chatgpt.com/settings/usage?tab=overview');
  assert.equal(link.props.target, '_blank');
  assert.match(link.props.rel, /noopener/);
  assert.equal(flatten(link.children), '2张 11月7日 05:23到期');
  assert.match(link.props.style.pointerEvents, /auto/, 'the click-through overlay lets the link receive clicks');
  assert.equal(link.props.style.WebkitAppRegion, 'no-drag', 'the link carves a hole in the window drag strip');
});

test('keeps the loading placeholder and continues to show quota and balance', () => {
  const { text } = render({ kind: 'loading' });
  assert.match(text, /读取中/);
  assert.match(text, /重置卡：—/);
});

test('clicking opens the usage page and re-navigates the tab to the reset-card anchor', () => {
  const popup = { closed: false, location: { href: '' } };
  const opened = [];
  const state = { kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 1, nextExpiresAt: '2026-11-06T21:23:57.312Z' } };
  const { tree, timers } = render(state, 'zh', { open: (url, target) => { opened.push([url, target]); return popup; } });
  const link = findKey(tree, 'reset-card-link');
  let prevented = false;
  link.props.onClick({ preventDefault: () => { prevented = true; } });

  assert.equal(prevented, true, 'the default navigation is replaced by the scroll-aware flow');
  assert.deepEqual(opened, [['https://chatgpt.com/settings/usage?tab=overview', '_blank']]);
  assert.equal(timers.length, 3, 'a few retries are scheduled for slow hydration');

  timers[0].fn();
  assert.equal(
    popup.location.href,
    'https://chatgpt.com/settings/usage?tab=overview#:~:text=' + encodeURIComponent('使用限额重置'),
  );
  timers[1].fn();
  assert.match(decodeURIComponent(popup.location.href), /#:~:text=重置额度$/);
  assert.equal(timers[0].delay < timers[1].delay, true);
});

test('retries stop once the popup is closed', () => {
  const popup = { closed: true, location: { href: 'untouched' } };
  const { tree, timers } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 1, nextExpiresAt: '2026-11-06T21:23:57.312Z' } }, 'zh', { open: () => popup });
  findKey(tree, 'reset-card-link').props.onClick({ preventDefault: () => {} });
  timers.forEach((timer) => timer.fn());
  assert.equal(popup.location.href, 'untouched');
});

test('falls back to the Host opener when the shell refuses to open a tab', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { calls.push([url, init]); return Promise.resolve({ ok: true }); };
  try {
    const { tree, timers } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 0, nextExpiresAt: null } }, 'zh', { open: () => null });
    findKey(tree, 'reset-card-link').props.onClick({ preventDefault: () => {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(timers.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/openai-quota/reset-card/open');
    assert.equal(calls[0][1].method, 'POST');
    assert.equal(calls[0][1].credentials, 'same-origin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the desktop shell skips window.open so the page is not opened twice', async () => {
  const calls = [];
  const opened = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { calls.push([url, init]); return Promise.resolve({ ok: true }); };
  try {
    const { tree, timers } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 1, nextExpiresAt: '2026-11-06T21:23:57.312Z' } }, 'zh', {
      open: (url) => { opened.push(url); return { closed: false, location: { href: '' } }; },
      navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.0.0 Electron/38.0.0 Safari/537.36' },
    });
    findKey(tree, 'reset-card-link').props.onClick({ preventDefault: () => {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(opened, [], 'the shell already hands this URL to the default browser');
    assert.equal(timers.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/openai-quota/reset-card/open');
    assert.equal(calls[0][1].method, 'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('localizes the reset card in English', () => {
  const { text } = render({ kind: 'ready', ...readyBase, resetCredits: { status: 'ready', count: 0, nextExpiresAt: null } }, 'en');
  assert.match(text, /Reset card: none$/);
});
