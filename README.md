<h1 align="center">Narwhal</h1>
<p align="center">
  <strong>A local-first, privacy-first AI agent.</strong>

  Runs a compatible Harness runtime on loopback only. Owns every conversation, project, and work-context surface.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Desktop-App-47848F?logo=electron&logoColor=white" alt="Desktop App">
  <img src="https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=white" alt="React + Vite">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-3B82F6" alt="Platforms: macOS, Windows, Linux">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F" alt="MIT License"></a>
</p>

<p align="center">
  <img src="assets/screenshots/workbench-dark.png" alt="Narwhal — Local AI Agent (Dark)" width="100%">
</p>

## What is Narwhal?

Narwhal is a desktop application that brings a local-first, privacy-first AI agent to your machine. It starts a compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) runtime on loopback only, using it strictly as a local Agent sidecar. The desktop app owns every visible conversation, activity, project, and work-context surface — you never interact with the upstream product's UI.

Narwhal is designed for anyone who wants the power of DeepSeek Harness without compromising local control, privacy, or workflow autonomy.

## Key Features

| Capability | What it does |
| --- | --- |
| **Local-First, Privacy-First** | Native workspace picker, remembered local workspaces, and project-scoped session management — all stored locally. Zero cloud lock-in. |
| **Narwhal-Owned Conversations** | A dedicated Work / Activity view with real history loading, prompt cancellation, and local-only data persistence. |
| **Safe Task Execution** | Local task plans, checkable steps, Git branch/changed-file inspection, and safely pinned deliverables. |
| **Secure Loopback BFF** | A main-process-only Backend-for-Frontend: fixed Host origin, allow-listed session RPCs, and normalized event streams. The renderer cannot fetch the Host, pick a URL/cwd, or receive raw host configuration. |
| **Narrow Typed IPC Bridge** | No Node, generic file system, shell, terminal, raw IPC, or arbitrary-path API is exposed to the renderer. A strict typed contract in `src/shared/desktop-contract.ts` defines the entire surface. |
| **Zero Cloud Lock-In** | No accounts, cloud sync, teams, task assignments, telemetry, or automatic external uploads in V1. |

### V1 Scope

**Included:**
- Native workspace picker and remembered local workspaces
- Local task plans, checkable steps, Git branch/changed-file inspection, and safely pinned deliverables
- Narwhal-owned local Agent conversations with Work / Activity view, real history loading, and prompt cancellation
- Main-process-only loopback BFF with fixed Host origin and allow-listed session RPCs
- Narrow typed IPC bridge with no Node/shell/FS access from the renderer
- **Integrations marketplace** — search, install, and manage MCP servers, Runtime Extensions (Cordis plugins), and Skills. All changes persist in `config.json` and sync to the DSH runtime. Add Custom MCP form supports stdio (self-developed JS processes) and streamable-http (remote endpoints).

**Deferred (not in V1):**
- File/image uploads, approval and question-answer screens
- Advanced model or preset selection
- Conversation forks/search, prompt steering
- Upstream product's rich trajectory renderer

## Architecture

Narwhal follows a strict security boundary between the renderer (UI) and the runtime:

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron Main Process                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Host Bridge │  │  Runtime     │  │  BFF (loopback)  │   │
│  │  (IPC handlers)│  │  Supervisor │  │  fixed origin    │   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                │                   │              │
│  ┌──────┴────────────────┴───────────────────┴─────────┐   │
│  │              Typed IPC Bridge (preload)              │   │
│  │   src/preload/index.cts — narrow, audited surface    │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                               │
│  ┌──────────────────────────┴───────────────────────────┐   │
│  │              Renderer (React + Vite)                   │   │
│  │   src/renderer/ — no Node, no shell, no FS access      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Design principles:**
- The renderer can never directly access the Host runtime or its configuration
- All Host interactions go through the main process's loopback BFF with fixed origin
- The IPC bridge exposes only typed, narrowly-scoped operations
- User data stays local to the desktop application

## Platform Support

| Platform | Status | Notes |
| --- | --- | --- |
| macOS arm64 | ✅ Available | Primary development target |
| macOS x64 | 🚧 Planned | Universal build |
| Windows x64 | 🚧 Planned | On the roadmap |
| Linux | 🚧 Planned | On the roadmap |

## Screenshots

<details>
<summary><strong>Workbench</strong></summary>

<p align="center">
  <img src="assets/screenshots/workbench-dark.png" alt="Narwhal Workbench — Dark Theme" width="100%">
  <sub>Main workbench with workspace picker, composer controls, and chat view. Dark theme.</sub>
</p>

</details>

<details>
<summary><strong>Integrations — MCP Servers</strong></summary>

<p align="center">
  <img src="assets/screenshots/mcp-servers-dark.png" alt="MCP Servers — Integrations" width="100%">
  <sub>Search the public MCP registry, install with one click, or add a self-developed MCP server manually (stdio or streamable-http transport).</sub>
</p>

</details>

<details>
<summary><strong>Integrations — Runtime Extensions</strong></summary>

<p align="center">
  <img src="assets/screenshots/runtime-extensions-dark.png" alt="Runtime Extensions — Integrations" width="100%">
  <sub>Browse and install DSH Cordis plugin bundles — framework-level extensions that add new capabilities to the Agent runtime (sandbox shells, credential management, MCP protocol client, etc.).</sub>
</p>

</details>

<details>
<summary><strong>Integrations — Skills</strong></summary>

<p align="center">
  <img src="assets/screenshots/skills-dark.png" alt="Skills — Integrations" width="100%">
  <sub>Add Markdown skill packs from GitHub raw URLs or git repositories. Installed skills land in <code>~/.config/narwhal/skills/</code> and are loaded into the Agent's system prompt.</sub>
</p>

</details>

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- A local [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) checkout for development mode

```sh
# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

Development mode (`pnpm dev`) expects a DeepSeek Harness checkout adjacent to this repo at `../DeepSeek-Harness` by default. Without it, the local Agent runtime cannot start. To point elsewhere, set `DSH_RUNTIME_ROOT`. Set `DSH_NODE_EXECUTABLE` when the appropriate Node binary is not on `PATH`.

## Configuration

Narwhal uses a single authoritative config file that is synced to the DSH runtime before each startup.

**Config file location:** `~/.config/narwhal/config.json` (override with `NARWHAL_CONFIG_DIR`)

Every time Narwhal launches, it regenerates two runtime files from `config.json`:
- `dsh-home/settings.yaml` — provider routes, default model, permission preset
- `dsh-home/profiles/web/cordis.patch.yml` — MCP servers and skills

Edit `config.json` (or use the in-app Settings UI), then restart Narwhal for changes to take effect.

### Complete Example

```jsonc
{
  "version": 1,
  "theme": "auto",
  "defaultModel": {
    "provider": "deepseek",
    "model": "deepseek-chat"
  },
  "agent": {
    "preset": "standard",
    "permissionLevel": "workspace-write"
  },
  "providers": {
    "deepseek": {
      "displayName": "DeepSeek",
      "api": "openai-completions",
      "baseURL": "https://api.deepseek.com/v1",
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "models": [
        { "id": "deepseek-chat", "contextWindow": 128000, "reasoningEfforts": ["low", "medium", "high"] },
        { "id": "deepseek-reasoner", "contextWindow": 64000, "reasoningEfforts": ["low", "medium", "high"] }
      ]
    },
    "anthropic": {
      "displayName": "Anthropic",
      "api": "messages",
      "baseURL": "https://api.anthropic.com",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "headers": { "anthropic-version": "2023-06-01" },
      "models": [
        { "id": "claude-sonnet-4-20250514", "contextWindow": 200000, "reasoningEfforts": ["low", "medium", "high"] }
      ]
    }
  },
  "skills": {
    "enabled": true,
    "customDirs": ["~/.config/narwhal/skills"]
  },
  "bundlePlugins": ["dsh-web-app"],
  "mcpServers": [
    {
      "serverName": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/YMINGTA/projects"],
      "toolCallTimeoutMs": 60000,
      "failOnStartupError": false
    },
    {
      "serverName": "github",
      "transport": "streamable-http",
      "url": "https://mcp.example.com/github",
      "headers": { "Authorization": "{env:GITHUB_TOKEN}" },
      "toolCallTimeoutMs": 30000
    }
  ]
}
```

### Integrations: MCP · Runtime Extensions · Skills

Narwhal has three tiers of extensibility, all managed through the **Integrations** settings panel:

| Tier | What it is | Where it lives | Install flow |
| --- | --- | --- | --- |
| **Runtime Extensions** | Cordis framework plugins (npm packages with JS) — e.g. sandbox shells, credential manager, MCP protocol client | `<dsh-home>/profiles/web/node_modules/` | `dsh plugin add <package>` → tracked in `config.json.bundlePlugins` |
| **MCP Servers** | Tool servers exposing JSON-RPC tools to the Agent | Config-only (no code downloaded) — DSH spawns them at runtime | Registry search **or** Add Custom form → `config.json.mcpServers[]` |
| **Skills** | Markdown guidance packages (`SKILL.md` + optional resources) that steer Agent behavior | `~/.config/narwhal/skills/<name>/SKILL.md` | URL paste (GitHub raw or git repo) → `config.json.skills.customDirs[]` + `enabled=true` |

Every change writes to `config.json` and `syncToDsh()` regenerates `cordis.patch.yml`, which DSH loads at next startup.

### API Keys

Narwhal never stores plaintext API keys in `config.json`. Provider credentials are referenced by environment variable name via `apiKeyEnv`:

```jsonc
"providers": {
  "my-provider": {
    "apiKeyEnv": "MY_PROVIDER_API_KEY"
  }
}
```

MCP server headers can also use the `{env:VAR_NAME}` pattern to keep secrets out of config files:

```jsonc
"headers": { "Authorization": "{env:GITHUB_TOKEN}" }
```

The required env vars are automatically passed through to the DSH runtime process. Export them in your shell profile, GUI session manager, or set them via Narwhal's Settings UI (they are still stored in the OS keychain, never in config.json).

### MCP Servers

Narwhal supports both MCP transports. Each server becomes one `dsh-mcp-client` plugin entry in the generated `cordis.patch.yml`.

**stdio transport** — spawns a local process:

```jsonc
{
  "serverName": "brave-search",
  "transport": "stdio",
  "command": "node",
  "args": ["/path/to/brave-mcp-server/index.js"],
  "env": { "BRAVE_API_KEY": "{env:BRAVE_API_KEY}" },
  "cwd": "/path/to/brave-mcp-server",
  "toolCallTimeoutMs": 120000,
  "failOnStartupError": false
}
```

**streamable-http transport** — connects to a remote MCP endpoint:

```jsonc
{
  "serverName": "datadog",
  "transport": "streamable-http",
  "url": "https://mcp.datadoghq.com/v1",
  "headers": { "DD_API_KEY": "{env:DD_API_KEY}" },
  "toolCallTimeoutMs": 60000,
  "failOnStartupError": true
}
```

| Option | Default | Description |
| --- | --- | --- |
| `toolCallTimeoutMs` | `60000` | Maximum milliseconds per tool call |
| `failOnStartupError` | `false` | If `true`, the Agent aborts when this server fails to start; if `false`, the server is skipped silently |

### Skills

Narwhal's skill system is disabled by default. Enable it to give the Agent persistent skill packs from bundled and custom directories:

```jsonc
"skills": {
  "enabled": true,
  "customDirs": ["~/.config/narwhal/skills", "./my-skills"],
  "bundledDir": "/opt/narwhal/skills"
}
```

| Field | Description |
| --- | --- |
| `enabled` | Enable skill loading. When `true`, Narwhal writes the `skill-filesystem` DSH plugin entry into `cordis.patch.yml`. |
| `customDirs` | Absolute paths to directories containing skill folders. Each folder has a `SKILL.md` at its root. Default install path is `~/.config/narwhal/skills` (written by the Integrations UI). |
| `bundledDir` | Optional path to a bundled skill directory distributed alongside Narwhal itself. |

### Configuration Schema

Narwhal uses Zod to validate `config.json` on every load. See [`src/shared/config-schema.ts`](src/shared/config-schema.ts) for the authoritative schema and [`src/main/dsh-sync.ts`](src/main/dsh-sync.ts) for the exact `settings.yaml` and `cordis.patch.yml` builders.

## Development

The project uses:
- **React + Vite** for the renderer UI
- **Electron** for the desktop shell
- **TypeScript** throughout

```sh
# Type checking
pnpm typecheck

# Build only
pnpm build

# Development with live reload
pnpm dev
```

The project defaults to an adjacent `../DeepSeek-Harness` checkout, pinned in [`runtime/manifest.json`](runtime/manifest.json).

## Packaging

Stage a verified closed runtime from the local upstream source and build the artifacts:

```sh
DSH_RUNTIME_SOURCE=/absolute/path/to/DeepSeek-Harness pnpm package:mac
```

Currently, only macOS arm64 builds are available. Windows and Linux packaging are on the roadmap.

Builds remain unsigned until the owner supplies signing and notarization credentials. See [`docs/macos-release-checklist.md`](docs/macos-release-checklist.md) for details.

## Project Structure

```
narwhal/
├── src/
│   ├── main/            # Electron main process (BFF, runtime management, IPC)
│   ├── preload/         # Preload script (typed IPC bridge)
│   ├── renderer/        # React renderer (UI components, styles)
│   ├── recovery/        # Recovery mode UI
│   └── shared/          # Shared types and contracts
├── runtime/             # Staged Harness runtime
├── scripts/             # Build utilities
├── docs/                # Documentation
└── build/               # Icons and build assets
```

> `runtime/dsh/package.json` is a generated staging manifest produced by `pnpm stage:runtime`. It pins `@deepseek-ai/dsh-*` workspace packages from a local Harness checkout and is only resolvable inside that upstream workspace. Do not edit it by hand or run `pnpm install` against it directly.

## Relationship to DeepSeek Harness

Narwhal is an independent project that relies on a compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) runtime. Key points:

- Narwhal does not modify or redistribute DeepSeek Harness source code
- It stages a verified compatible runtime for local-only execution
- Narwhal's desktop UI, branding, and interaction patterns are entirely its own
- The upstream license and notices must be preserved when distributing the staged runtime

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes (ensure `pnpm typecheck` and `pnpm build` pass)
4. Commit your changes (`git commit -m 'Add some amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

When distributing Narwhal, preserve the upstream license and notices for the staged runtime located in `runtime/dsh/`.

## Star History

Star history chart will be added after the repository is published to GitHub.
