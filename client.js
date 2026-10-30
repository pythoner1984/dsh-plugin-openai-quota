window.__ModuleLoader__.load({
  id: 'dsh-plugin-openai-quota',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const COPY = {
      zh: {
        title: '额度提示',
        notice: 'DeepSeek余额：{balance}元|OpenAI额度{quota}%（{weeklyQuota}%） 重置时间：{reset}（{weeklyReset}）',
        loading: '读取中…',
        error: '读取失败',
        resetCardLabel: '重置卡：',
        resetCardNone: '无',
        resetCardUnavailable: '暂不可用',
        resetCardExpires: '{count}张 {date}到期',
        resetCardHint: '在 ChatGPT 使用情况页查看并使用重置卡',
      },
      en: {
        title: 'Quota notice',
        notice: 'DeepSeek balance: {balance} CNY|OpenAI quota {quota}% ({weeklyQuota}%) Reset: {reset} ({weeklyReset})',
        loading: 'Loading…',
        error: 'Unable to load',
        resetCardLabel: 'Reset card: ',
        resetCardNone: 'none',
        resetCardUnavailable: 'unavailable',
        resetCardExpires: '{count} expiring {date}',
        resetCardHint: 'Review and use reset cards on the ChatGPT usage page',
      },
    };

    function languageOf(locale) {
      try {
        const snapshot = locale && (locale.getLocale?.() || locale.getSnapshot?.());
        const id = typeof snapshot === 'string' ? snapshot : snapshot?.id || snapshot?.locale || snapshot?.language;
        return String(id || globalThis.navigator?.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
      } catch (_) {
        return 'en';
      }
    }

    function text(locale, key, vars) {
      const dict = COPY[languageOf(locale)] || COPY.en;
      let value = dict[key] || COPY.en[key] || key;
      for (const [name, replacement] of Object.entries(vars || {})) value = value.replace(`{${name}}`, String(replacement));
      return value;
    }

    function numberValue(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }

    function formatPercent(value) {
      return `${Math.max(0, Math.min(100, numberValue(value))).toFixed(1).replace(/\.0$/, '')}%`;
    }

    function formatBeijingTime(date) {
      if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return '—';
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
      return `${parts.hour}:${parts.minute}`;
    }

    function formatBeijingDate(date) {
      if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return '—';
      const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
      }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
      return `${parts.month}月${parts.day}日`;
    }

    function formatBalance(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(1) : String(value ?? '—');
    }

    function deepSeekCnyBalance(deepseek) {
      const wallets = deepseek?.wallets || [];
      const wallet = wallets.find((item) => String(item.currency || '').toUpperCase() === 'CNY') || wallets[0];
      return wallet ? formatBalance(wallet.balance) : '—';
    }

    function windowData(usage, name) {
      const value = usage?.rate_limit?.[name] || usage?.rate_limit?.[name === 'primary_window' ? 'primary' : 'secondary'] || {};
      const used = numberValue(value.used_percent);
      const resetAt = value.reset_at ? new Date(Number(value.reset_at) * 1000) : value.reset_after_seconds != null ? new Date(Date.now() + Number(value.reset_after_seconds) * 1000) : null;
      return {
        remaining: Math.max(0, 100 - used),
        reset: formatBeijingTime(resetAt),
        resetDate: resetAt,
      };
    }

    async function loadSummary() {
      const response = await fetch('/openai-quota/summary', { cache: 'no-store', credentials: 'same-origin' });
      let payload = null;
      try { payload = await response.json(); } catch (_) { /* handled below */ }
      if (!response.ok || !payload?.ok) {
        const error = new Error(payload?.code || `HTTP ${response.status}`);
        error.status = response.status;
        error.code = payload?.code;
        error.upstreamStatus = payload?.upstreamStatus;
        throw error;
      }
      return payload;
    }

    const USAGE_SETTINGS_URL = 'https://chatgpt.com/settings/usage?tab=overview';
    const RESET_CARD_OPEN_ROUTE = '/openai-quota/reset-card/open';

    /**
     * The usage settings page renders its reset-card section only after hydration, so
     * a cold load that carries a text-fragment directive never scrolls: the browser
     * resolves the directive before the section exists and never retries. Opening the
     * tab first and then re-navigating that same tab to the same URL plus a directive
     * makes the second step a same-document navigation, which does scroll.
     *
     * The desktop shell, however, answers `window.open` by handing the URL to the
     * operating system's default browser and returning no window handle, so the tab
     * cannot be re-navigated from here. That case opens through the Host instead.
     */
    const RESET_CARD_ANCHORS = ['使用限额重置', '重置额度'];
    const SCROLL_RETRY_DELAYS = [4000, 8000, 12000];
    const pendingTimers = [];

    function anchorUrl(anchor) {
      return `${USAGE_SETTINGS_URL}#:~:text=${encodeURIComponent(anchor)}`;
    }

    function isDesktopShell() {
      try {
        const agent = window.navigator?.userAgent || '';
        return /\bElectron\//i.test(agent) || /\bDeepSeek Harness\b/i.test(agent);
      } catch (_) {
        return false;
      }
    }

    function requestHostOpen() {
      void fetch(RESET_CARD_OPEN_ROUTE, {
        method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' },
      }).catch(() => {});
    }

    function scheduleResetCardScroll(popup, timers) {
      SCROLL_RETRY_DELAYS.forEach((delay, index) => {
        const id = window.setTimeout(() => {
          try {
            if (!popup || popup.closed) return;
            popup.location.href = anchorUrl(RESET_CARD_ANCHORS[index % RESET_CARD_ANCHORS.length]);
          } catch (_) { /* the tab may have been closed or navigated away */ }
        }, delay);
        timers.push(id);
      });
    }

    function openResetCard(timers) {
      if (isDesktopShell()) {
        requestHostOpen();
        return 'host';
      }
      let popup = null;
      try {
        popup = window.open(USAGE_SETTINGS_URL, '_blank');
      } catch (_) {
        popup = null;
      }
      if (!popup || popup.closed) {
        requestHostOpen();
        return 'host';
      }
      scheduleResetCardScroll(popup, timers);
      return 'tab';
    }

    function resetCardText(locale, resetCredits) {
      const t = (key, vars) => text(locale, key, vars);
      if (!resetCredits || resetCredits.status !== 'ready') return t('resetCardUnavailable');
      if (!(resetCredits.count > 0) || !resetCredits.nextExpiresAt) return t('resetCardNone');
      const expires = new Date(resetCredits.nextExpiresAt);
      if (Number.isNaN(expires.valueOf())) return t('resetCardUnavailable');
      return t('resetCardExpires', {
        count: resetCredits.count,
        date: formatBeijingDate(expires) === '—'
          ? expires.toISOString().slice(0, 10)
          : `${formatBeijingDate(expires)} ${formatBeijingTime(expires)}`,
      });
    }

    function renderNotice(notice) {
      const value = typeof notice === 'string' ? notice : String(notice ?? '');
      const separator = '|';
      const index = value.indexOf(separator);
      if (index < 0) return value;
      return [
        h('span', { key: 'notice-before' }, value.slice(0, index)),
        h('span', {
          key: 'notice-separator',
          'aria-hidden': 'true',
          style: { display: 'inline-block', marginInline: '12px' },
        }, separator),
        h('span', { key: 'notice-after' }, value.slice(index + separator.length)),
      ];
    }

    class QuotaWidgetBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false };
      }

      static getDerivedStateFromError() {
        return { hasError: true };
      }

      componentDidCatch(error) {
        try { console.warn('[openai-quota] client render failed', error); } catch (_) { /* noop */ }
      }

      render() {
        if (this.state.hasError) return h('div', {
          role: 'status',
          'aria-label': text(this.props.locale, 'title'),
          style: {
            position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
            pointerEvents: 'none', maxWidth: 'calc(100vw - 36px)', boxSizing: 'border-box',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
            fontSize: 13, fontWeight: 500, lineHeight: '20px', letterSpacing: '0.15px',
            color: 'var(--dsw-alias-label-primary)', background: 'transparent', padding: '6px 12px',
          },
        }, text(this.props.locale, 'error'));
        return this.props.children;
      }
    }

    function QuotaWidget({ locale }) {
      const [localeTick, setLocaleTick] = React.useState(0);
      const [state, setState] = React.useState({ kind: 'loading' });

      React.useEffect(() => {
        if (!locale?.subscribe) return undefined;
        return locale.subscribe(() => setLocaleTick((value) => value + 1));
      }, [locale]);

      const refresh = React.useCallback(async () => {
        setState({ kind: 'loading' });
        try {
          const result = await loadSummary();
          setState({ kind: 'ready', ...result });
        } catch (error) {
          setState({ kind: 'error', status: error.status, code: error.code, upstreamStatus: error.upstreamStatus });
        }
      }, []);

      React.useEffect(() => {
        let disposed = false;
        let requestInFlight = false;
        const run = async () => {
          if (disposed || requestInFlight || globalThis.document?.visibilityState === 'hidden') return;
          requestInFlight = true;
          try { await refresh(); } finally { requestInFlight = false; }
        };
        const onVisibility = () => { if (globalThis.document?.visibilityState === 'visible') void run(); };
        void run();
        const timer = globalThis.setInterval(run, 15 * 60 * 1000);
        globalThis.document?.addEventListener('visibilitychange', onVisibility);
        return () => {
          disposed = true;
          globalThis.clearInterval(timer);
          globalThis.document?.removeEventListener('visibilitychange', onVisibility);
        };
      }, [refresh]);

      void localeTick;
      const t = (key, vars) => text(locale, key, vars);
      const ready = state.kind === 'ready' ? state : null;
      const primary = ready?.usage ? windowData(ready.usage, 'primary_window') : null;
      const weekly = ready?.usage ? windowData(ready.usage, 'secondary_window') : null;
      const notice = state.kind === 'loading'
        ? t('loading')
        : state.kind === 'error'
          ? t('error')
          : t('notice', {
            balance: deepSeekCnyBalance(ready?.deepseek),
            quota: primary ? formatPercent(primary.remaining).replace('%', '') : '—',
            reset: primary?.reset || '—',
             weeklyQuota: weekly ? formatPercent(weekly.remaining).replace('%', '') : '—',
             weeklyReset: weekly ? formatBeijingDate(weekly.resetDate) : '—',
          });

      return h('div', {
        role: 'status', 'aria-label': t('title'),
        style: {
          position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, pointerEvents: 'none',
          maxWidth: 'calc(100vw - 36px)', boxSizing: 'border-box', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          fontSize: 13, fontWeight: 500, lineHeight: '20px', letterSpacing: '0.15px',
          fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"',
          color: 'var(--dsw-alias-label-primary)', border: 'none', borderRadius: 0,
          background: 'transparent', padding: '6px 12px', boxShadow: 'none',
        },
      }, renderNotice(notice), h('span', {
        key: 'reset-card',
        style: { display: 'inline-flex', alignItems: 'center', gap: 0 },
      }, [
        h('span', { key: 'reset-card-separator', 'aria-hidden': 'true', style: { display: 'inline-block', marginInline: '12px 4px' } }, '|'),
        h('span', { key: 'reset-card-label' }, t('resetCardLabel')),
        h('a', {
          key: 'reset-card-link',
          href: USAGE_SETTINGS_URL,
          target: '_blank',
          rel: 'noopener noreferrer',
          title: t('resetCardHint'),
          'aria-label': t('resetCardHint'),
          onClick: (event) => {
            try { event?.preventDefault?.(); } catch (_) { /* noop */ }
            openResetCard(pendingTimers);
          },
          style: {
            pointerEvents: 'auto',
            // On Windows the desktop shell paints a drag strip across the top of the
            // frame (`-webkit-app-region: drag`), so the notice sits inside a window
            // drag region and never receives the click. Carving a no-drag hole here
            // is what makes the link clickable.
            WebkitAppRegion: 'no-drag',
            color: 'inherit', textDecoration: 'underline',
            textUnderlineOffset: '2px', cursor: 'pointer',
          },
        }, state.kind === 'loading' ? '—' : resetCardText(locale, ready?.resetCredits)),
      ]));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale');
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'openai-quota', order: 600,
        }, (props) => h(
          QuotaWidgetBoundary,
          { locale },
          h(QuotaWidget, { ...props, locale }),
        )));
      },
    };
  },
});
