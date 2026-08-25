# Narwhal for macOS

Narwhal is a local-first personal AI coding workbench. It starts a compatible Harness runtime on loopback only and uses it strictly as a local Agent sidecar; the macOS app owns every visible conversation, activity, project and work-context surface.

## Development

The project defaults to the adjacent `../DeepSeek-Harness` checkout, pinned in [`runtime/manifest.json`](runtime/manifest.json). It uses React + Vite for the renderer and Electron for the secure macOS shell.

```sh
pnpm install
pnpm dev
```

Set `DSH_RUNTIME_ROOT` to use another verified checkout, or `DSH_NODE_EXECUTABLE` when the appropriate Node binary is not on `PATH`.

Narwhal workbench data is atomically stored under `~/Library/Application Support/narwhal-forge-macos/narwhal-forge/workbench.json`, separate from all project repositories. V1 disables Harness telemetry and forwards `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` only when present in the launching environment.

## V1 capabilities

- Native workspace picker and remembered local workspaces.
- Local task plans, checkable steps, Git branch/changed-file inspection, and safely pinned deliverables.
- Narwhal-owned local Agent conversations with a Work / Activity view, real history loading and prompt cancellation.
- A main-process-only loopback BFF: fixed Host origin, allow-listed session RPCs and normalized event streams. The renderer cannot fetch the Host, pick a URL/cwd, or receive raw host configuration.
- A narrow typed IPC bridge: no Node, generic file system, shell, terminal, raw IPC, or arbitrary-path API is exposed to the renderer.

There are no accounts, cloud sync, teams, task assignments, telemetry, or automatic external uploads in V1.

V1 deliberately defers file/image uploads, approval and question answer screens, advanced model or preset selection, conversation forks/search, prompt steering and the upstream product's rich trajectory renderer.

## Packaging

Stage a verified closed runtime from the local upstream source and build the arm64 artifacts:

```sh
DSH_RUNTIME_SOURCE=/absolute/path/to/DeepSeek-Harness pnpm package:mac
```

`com.example.narwhalforge` is an intentionally non-commercial development placeholder. Replace it with an owner-controlled reverse-domain identifier before distribution. Builds remain unsigned until the owner supplies Apple Developer signing and notarization credentials; see [`docs/macos-release-checklist.md`](docs/macos-release-checklist.md).

## Attribution

Narwhal owns its desktop branding and does not use DeepSeek's visual identity. Its central Agent surface relies on a compatible DeepSeek Harness runtime; preserve the upstream license and notices for the staged runtime when distributing it.
