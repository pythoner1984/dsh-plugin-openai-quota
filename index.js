/**
 * Host half: read the existing ChatGPT OAuth quota and the signed-in DeepSeek
 * wallet balance, then hand both to the Web Client. Credentials stay here.
 */

import { spawn } from 'node:child_process';

const USAGE_ROUTE = '/openai-quota/usage';
const SUMMARY_ROUTE = '/openai-quota/summary';
const HEALTH_ROUTE = '/openai-quota/health';
const OPEN_RESET_CARD_ROUTE = '/openai-quota/reset-card/open';
const HEALTH_VERSION = '1.8.0';
const CREDENTIAL_KEY = 'llm-pi-ai/openai-codex';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const USAGE_SETTINGS_URL = 'https://chatgpt.com/settings/usage?tab=overview';
const RESET_CARD_SECTION = '使用限额重置';
const CLIENT_VERSION = '1.8.0';

export const inject = ['webServer', 'credentials', 'connection', 'deepseekAccount'];
export const name = 'dsh-plugin-openai-quota';

function rejectUntrusted(ctx, req, res) {
  try {
    const connection = serviceOf(ctx, 'connection');
    if (!connection || typeof connection.requestRejection !== 'function') {
      sendJson(res, 503, { ok: false, code: 'local-auth-unavailable' });
      return true;
    }
    const code = connection.requestRejection(req);
    if (code === undefined) return false;
    sendJson(res, code === 401 ? 401 : 403, { ok: false, code: 'local-auth-rejected' });
    return true;
  } catch (_) {
    sendJson(res, 403, { ok: false, code: 'local-auth-failed' });
    return true;
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
  });
  res.end(body);
}

function serviceOf(ctx, key) {
  try {
    const value = typeof ctx.get === 'function' ? ctx.get(key) : undefined;
    if (value) return value;
  } catch (_) {
    return undefined;
  }
  return undefined;
}

function grantPayload(record) {
  if (!record || record.kind !== 'grant' || !record.payload || typeof record.payload !== 'object') return null;
  return record.payload;
}

async function readOAuthGrant(credentials) {
  if (!credentials || typeof credentials.readRecord !== 'function') return null;
  const record = await credentials.readRecord(CREDENTIAL_KEY);
  const payload = grantPayload(record);
  if (!payload || typeof payload.access !== 'string' || !payload.access.trim()) return null;
  return {
    access: payload.access.trim(),
    accountId: typeof payload.accountId === 'string' ? payload.accountId.trim() : '',
  };
}

function pickWindow(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    used_percent: Number.isFinite(Number(value.used_percent)) ? Number(value.used_percent) : 0,
    limit_window_seconds: Number.isFinite(Number(value.limit_window_seconds)) ? Number(value.limit_window_seconds) : null,
    reset_after_seconds: Number.isFinite(Number(value.reset_after_seconds)) ? Number(value.reset_after_seconds) : null,
    reset_at: Number.isFinite(Number(value.reset_at)) ? Number(value.reset_at) : null,
  };
}

async function fetchUsage(credentials) {
  const grant = await readOAuthGrant(credentials);
  if (!grant) return { status: 404, body: { ok: false, code: 'not-configured' } };

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${grant.access}`,
    'User-Agent': 'DeepSeek-Harness-OpenAI-Quota/1.2',
  };
  if (grant.accountId) headers['ChatGPT-Account-Id'] = grant.accountId;

  let response;
  try {
    response = await fetch(USAGE_URL, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (_) {
    return { status: 502, body: { ok: false, code: 'upstream-unreachable' } };
  }

  if (!response.ok) {
    return { status: 502, body: { ok: false, code: 'upstream-http', upstreamStatus: response.status } };
  }

  try {
    const raw = await response.json();
    const usage = {
      response_schema: {
        primary_window: Boolean(raw?.rate_limit?.primary_window),
        secondary_window: Boolean(raw?.rate_limit?.secondary_window),
      },
      rate_limit: {
        primary_window: pickWindow(raw?.rate_limit?.primary_window),
        secondary_window: pickWindow(raw?.rate_limit?.secondary_window),
      },
    };
    return { status: 200, body: { ok: true, usage, fetchedAt: new Date().toISOString() } };
  } catch (_) {
    return { status: 502, body: { ok: false, code: 'upstream-invalid-json' } };
  }
}

export function availableResetCredits(raw) {
  if (!raw || !Array.isArray(raw.credits)) return { status: 'unavailable', code: 'upstream-invalid-response' };
  const now = Date.now();
  const available = raw.credits
    .filter((card) => card?.status === 'available' && card?.is_supported_by_plan !== false)
    .map((card) => ({ expires: Date.parse(card.expires_at), type: String(card.reset_type || '') }))
    .filter((card) => Number.isFinite(card.expires) && card.expires > now)
    .sort((left, right) => left.expires - right.expires);
  return { status: 'ready', count: available.length, nextExpiresAt: available[0] ? new Date(available[0].expires).toISOString() : null };
}

async function fetchResetCredits(credentials) {
  const grant = await readOAuthGrant(credentials);
  if (!grant) return { status: 'unavailable', code: 'not-configured' };
  const headers = { Accept: 'application/json', Authorization: `Bearer ${grant.access}` };
  if (grant.accountId) headers['ChatGPT-Account-Id'] = grant.accountId;
  let response;
  try {
    response = await fetch(RESET_CREDITS_URL, { method: 'GET', headers, signal: AbortSignal.timeout(20_000) });
  } catch (_) {
    return { status: 'unavailable', code: 'upstream-unreachable' };
  }
  if (!response.ok) return { status: 'unavailable', code: 'upstream-http', upstreamStatus: response.status };
  try {
    return availableResetCredits(await response.json());
  } catch (_) {
    return { status: 'unavailable', code: 'upstream-invalid-response' };
  }
}

function accountClientMetadata() {
  return {
    version: CLIENT_VERSION,
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

function walletList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((wallet) => wallet && (wallet.currency === 'CNY' || wallet.currency === 'USD'))
    .map((wallet) => ({ currency: wallet.currency, balance: String(wallet.balance ?? '0') }));
}

async function fetchDeepSeekBalance(deepseekAccount) {
  if (!deepseekAccount || typeof deepseekAccount.getBalance !== 'function') {
    return { status: 'unavailable', code: 'service-unavailable', wallets: [], bonusWallets: [] };
  }
  try {
    const result = await deepseekAccount.getBalance(accountClientMetadata());
    if (!result) return { status: 'signed-out', code: 'not-configured', wallets: [], bonusWallets: [] };
    if (result.status !== 'ready') return { status: 'unavailable', code: 'upstream-failed', wallets: [], bonusWallets: [] };
    return {
      status: 'ready',
      wallets: walletList(result.value),
      bonusWallets: walletList(result.bonusWallets),
    };
  } catch (_) {
    return { status: 'unavailable', code: 'upstream-failed', wallets: [], bonusWallets: [] };
  }
}

async function fetchSummary(credentials, deepseekAccount) {
  const usagePromise = Promise.resolve()
    .then(() => fetchUsage(credentials))
    .catch(() => ({ status: 500, body: { ok: false, code: 'internal-error' } }));
  const deepseekPromise = fetchDeepSeekBalance(deepseekAccount).catch(() => ({
    status: 'unavailable', code: 'upstream-failed', wallets: [], bonusWallets: [],
  }));
  const resetCreditsPromise = Promise.resolve()
    .then(() => fetchResetCredits(credentials))
    .catch(() => ({ status: 'unavailable', code: 'internal-error' }));
  const [usageResult, deepseek, resetCredits] = await Promise.all([
    usagePromise,
    deepseekPromise,
    resetCreditsPromise,
  ]);
  return {
    status: 200,
    body: {
      ok: true,
      usage: usageResult.body?.ok ? usageResult.body.usage : null,
      usageError: usageResult.body?.ok ? null : usageResult.body?.code || 'unavailable',
      upstreamStatus: usageResult.body?.upstreamStatus,
      deepseek,
      resetCredits,
      fetchedAt: new Date().toISOString(),
    },
  };
}

/**
 * Open the fixed ChatGPT usage page in the operating system's default browser.
 * The URL is a Host-side constant: no request input ever reaches the command
 * line, so this route cannot be turned into an open redirect or shell injection.
 */
export function openUsagePage(runner = spawn) {
  if (process.platform !== 'win32') return { ok: false, code: 'platform-unsupported' };
  try {
    const child = runner('cmd.exe', ['/c', 'start', '', USAGE_SETTINGS_URL], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    if (child && typeof child.unref === 'function') child.unref();
    return { ok: true, url: USAGE_SETTINGS_URL };
  } catch (_) {
    return { ok: false, code: 'spawn-failed' };
  }
}

export function apply(ctx) {
  const webServer = serviceOf(ctx, 'webServer');
  const credentials = serviceOf(ctx, 'credentials');
  const deepseekAccount = serviceOf(ctx, 'deepseekAccount');
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[openai-quota] webServer is unavailable; quota route was not registered');
    return;
  }

  let disposed = false;
  const register = (path, handler, methods = ['GET']) => webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (disposed) return;
      if (rejectUntrusted(ctx, req, res)) return;
      if (!methods.includes((req.method || 'GET').toUpperCase())) {
        sendJson(res, 405, { ok: false, code: 'method-not-allowed' });
        return;
      }
      try {
        await handler(req, res);
      } catch (_) {
        sendJson(res, 500, { ok: false, code: 'internal-error' });
      }
    },
  });

  ctx.effect(() => {
    const disposers = [];
    const cleanup = () => {
      disposed = true;
      for (const dispose of disposers.reverse()) {
        try { dispose(); } catch (_) { /* continue releasing other routes */ }
      }
    };
    try {
      disposers.push(register(HEALTH_ROUTE, async (_req, res) => {
        const grant = await readOAuthGrant(credentials);
        const usageResult = grant ? await fetchUsage(credentials) : null;
        sendJson(res, 200, {
          ok: true,
          plugin: name,
          version: HEALTH_VERSION,
          routes: { usage: true, summary: true, health: true, openResetCard: true },
          credentialConfigured: Boolean(grant),
          openaiReachable: usageResult?.body?.ok === true,
          usageError: usageResult?.body?.ok ? null : usageResult?.body?.code || 'not-configured',
          upstreamStatus: usageResult?.body?.upstreamStatus,
          windows: usageResult?.body?.usage?.response_schema || null,
          resetCredits: grant ? await fetchResetCredits(credentials) : { status: 'unavailable', code: 'not-configured' },
        });
      }));
      disposers.push(register(USAGE_ROUTE, async (_req, res) => {
        const result = await fetchUsage(credentials);
        sendJson(res, result.status, result.body);
      }));
      disposers.push(register(SUMMARY_ROUTE, async (_req, res) => {
        const result = await fetchSummary(credentials, deepseekAccount);
        sendJson(res, result.status, result.body);
      }));
      disposers.push(register(OPEN_RESET_CARD_ROUTE, async (_req, res) => {
        const result = openUsagePage();
        sendJson(res, result.ok ? 200 : 501, {
          ok: result.ok,
          url: USAGE_SETTINGS_URL,
          section: RESET_CARD_SECTION,
          code: result.code,
        });
      }, ['POST']));
    } catch (error) {
      cleanup();
      throw error;
    }
    return cleanup;
  });
}
