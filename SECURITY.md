# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

The Narwhal team takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose your findings.

Please report security vulnerabilities by opening a **private** GitHub issue or emailing the maintainers directly. Do NOT publically disclose the issue until we have had a chance to address it.

**What to include in your report:**

- A detailed description of the vulnerability
- Steps to reproduce the issue
- Affected versions
- Potential mitigations

## Security Design Principles

Narwhal is designed with the following security principles:

1. **Loopback-only runtime**: The Harness runtime binds to loopback only and is never exposed to the network.
2. **Typed IPC bridge**: The preload script exposes a narrow, typed API surface. No Node.js, file system, shell, or terminal access is available to the renderer.
3. **Fixed origin BFF**: The main process acts as a Backend-for-Frontend with a fixed Host origin and allow-listed session RPCs.
4. **Local-only data**: All conversation history, workspace data, and configuration is stored locally. No cloud sync or telemetry in V1.
5. **No raw configuration exposure**: The renderer cannot read or receive raw host configuration, API keys, or runtime settings.

## Dependency Security

- We regularly update dependencies to address known vulnerabilities
- The `runtime/dsh/` directory stages a pinned, verified Harness runtime
- Build processes verify integrity of packaged artifacts

## Security Best Practices for Contributors

- Always run `pnpm typecheck` and `pnpm build` before submitting PRs
- Never expose secrets, API keys, or credentials in code or commits
- Use environment variables for sensitive configuration
- Review the architecture section in README.md to understand the security boundary
