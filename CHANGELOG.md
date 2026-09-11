# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-11

### Added

- Initial public release of Narwhal
- Local-first AI coding workbench with secure loopback Harness runtime
- Native workspace picker with remembered local workspaces
- Narwhal-owned Agent conversations with Work / Activity view
- Local task plans, checkable steps, Git inspection, and safe deliverables
- Secure typed IPC bridge — no Node/FS/shell access from renderer
- Main-process-only BFF with fixed Host origin and allow-listed RPCs
- V1 feature set: zero cloud lock-in, no telemetry, local-only data
- macOS arm64 packaging (DMG and ZIP)
- Cross-platform positioning: Windows and Linux on the roadmap
- Full internationalization (English / 中文) across the app including the
  Settings panel, with an in-app language toggle
- Custom OpenAI-compatible providers are fully runnable from the UI:
  credential ref derivation, create/update/delete with credential cleanup,
  and composer model filtering by runnability

### Changed

- Reasoning effort (low / medium / high / xhigh / max) is now passed
  through to OpenAI-compatible gateways for hand-declared models — all five
  levels pi-ai supports are advertised by default, the gateway sees the
  selected effort instead of silently defaulting to off. Effort is also
  remembered per model (`provider/model`) and restored when switching models.
  Anthropic providers keep the three-level ladder (low / medium / high).

### Fixed

- Gateway failures reached over a successful HTTP/SSE connection (mid-stream
  errors or empty 0-token error events) are now shown in the conversation with
  the provider's actual message, instead of being swallowed or misreported as
  a 20-second "check your API key" timeout.
- The prompt watchdog is now inactivity-based (60s with no stream activity),
  so slow first-token responses from reasoning models no longer abort
  mid-flight; each failed turn gets its own visible error card.
- Custom providers no longer rejected with "Provider not found" on
  edit/delete; deleting a provider also cleans its stored credential;
  `saveConfig` deep-merge no longer resurrects deleted providers.
- Workspace/session robustness: orphaned sessions survive list refreshes,
  deleting a workspace purges its DSH sessions, and stuck prompts surface a
  visible timeout with a working stop action.
- Settings → Appearance black screen; dark-theme native select styling;
  language switch not applying.
- Release pipeline: tag-driven DMG + ZIP build with symlink-safe packaging
  and pinned pnpm version.

