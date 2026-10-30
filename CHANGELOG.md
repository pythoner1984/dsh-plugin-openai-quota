# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.8.0] - 2026-10-30

First release packaged as a standalone repository.

### Changed

- Package renamed from `@local/openai-quota` to `dsh-plugin-openai-quota`; loader id, `cordis.patch.yml`, and both locale files follow the new name.
- Host `inject` narrowed to what the plugin actually uses: `webServer`, `credentials`, `connection`, `deepseekAccount`.
- Upstream payloads slimmed: account email, plan type, credit details, and the configured-model list are no longer fetched or forwarded to the browser.
- `/openai-quota/usage` is now the only quota route; the legacy 404 fallback in the client was removed.
- Client copy table reduced to the keys that are actually rendered.

### Added

- `README.md`, `README.zh-CN.md`, `LICENSE` (MIT), `.gitignore`, and this changelog.
- `npm test` runs both halves with `node --test` (22 assertions).

### Removed

- Dead helpers left over from earlier iterations: `maskEmail()`, the model-extraction chain, and the diagnostic write of `last-open.json`.

## [1.7.2] - 2026-10-30

### Removed

- The `recordOpenAttempt()` diagnostic and its `last-open.json` side file, now that the click path is verified end to end.

## [1.7.1] - 2026-10-30

### Fixed

- The reset-card link was not clickable. The notice sits at `top: 0`, inside the Windows desktop shell's drag strip (`.frame:before { -webkit-app-region: drag }`), which swallowed mouse events before the DOM saw them. The link now sets `-webkit-app-region: no-drag` to carve a hole in that strip.

### Added

- A client test asserting the no-drag style, so the regression cannot come back silently.

## [1.7.0] - 2026-10-30

### Added

- Clicking the reset-card segment opens the ChatGPT usage page in the default browser.
- `POST /openai-quota/reset-card/open` on the Host: platform-gated (`win32` only) `spawn('cmd.exe', ['/c','start','',URL])`. The URL is a Host constant and never comes from the request, so the route cannot be turned into an open redirect.
- Per-route HTTP method allowlists; anything else returns `405 method-not-allowed`.
- When the GUI runs in a real browser tab, the client re-navigates the opened tab with a `#:~:text=` fragment so the page lands on the 使用限额重置 section.

### Notes

- The desktop shell hands `window.open` to `shell.openExternal()` and returns no window handle, so in the desktop app the page opens at the top and cannot be scrolled by the plugin.

## [1.6.0] - 2026-10-30

### Added

- Reset-card segment: `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`, showing `无` when empty, otherwise the nearest expiry among cards that are `available` and supported by the plan.
- Reset cards are display-only; the plugin never redeems one.

## [1.5.0] - 2026-10-30

### Added

- `GET /openai-quota/health`: redacted self-check covering credential presence, upstream reachability, upstream status, which quota windows came back, and reset-card state.
- `response_schema` in the usage payload.

### Changed

- Refresh polling pauses while the page is hidden, refreshes immediately on visibility, and skips a tick when a request is still in flight.
- Client fetches send `credentials: 'same-origin'` explicitly.

## [1.4.1] - 2026-10-30

### Fixed

- The plugin could not read the OpenAI quota. The Host failed at startup with `cannot get property "deepseekAccount" without inject`, so `/openai-quota/summary` was never registered and authenticated requests returned 404. `inject` now declares `deepseekAccount`.

### Changed

- Trust checks fail closed: a missing `connection` service returns `503 local-auth-unavailable`, a rejected call returns `401`/`403`, and a throwing guard returns `403 local-auth-failed`.
- Service lookups no longer fall back to `ctx[key]`.
- Route registration goes through `ctx.effect` and rolls back on failure.

### Added

- `host.test.mjs`, covering registration, rollback, and the trust fences.

## [1.4.0] - 2026-10-30

### Added

- `QuotaWidgetBoundary` error boundary so a rendering fault degrades to a plain line instead of breaking the overlay.
- `String()` coercion in `renderNotice` so non-string values cannot throw during render.

## [1.3.0] - 2026-10-30

### Added

- Weekly quota and weekly reset time, read from `secondary_window`.

## [1.0.0] - 2026-10-30

### Added

- Initial notice: DeepSeek balance and the current OpenAI quota window with its reset time.
- Host routes `/openai-quota/usage` and `/openai-quota/summary`, reading the existing ChatGPT OAuth grant (`llm-pi-ai/openai-codex`) and the official `deepseekAccount` service.
- `shell.overlay` entry rendered top-center, transparent, borderless, shadowless, with tabular numerals.

[Unreleased]: https://github.com/pythoner1984/dsh-plugin-openai-quota/compare/v1.8.0...HEAD
[1.8.0]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.8.0
[1.7.2]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.7.2
[1.7.1]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.7.1
[1.7.0]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.7.0
[1.6.0]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.6.0
[1.5.0]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.5.0
[1.4.1]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.4.1
[1.4.0]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.4.0
[1.3.0]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.3.0
[1.0.0]: https://github.com/pythoner1984/dsh-plugin-openai-quota/releases/tag/v1.0.0
