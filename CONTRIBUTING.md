# Contributing to Narwhal

First off, thank you for considering contributing to Narwhal! It's people like you that make Narwhal a great tool.

## Code of Conduct

This project and everyone participating in it is governed by the following principles:

- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Describe the behavior you observed and what you expected to see**
- **Include your environment details** (OS version, Node version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When suggesting an enhancement:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Explain why this enhancement would be useful**

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow the existing code style** (TypeScript, React, CSS conventions)
3. **Write meaningful commit messages**
4. **Include comments** in your code where necessary
5. **Update the README** if needed
6. **Ensure `pnpm typecheck` and `pnpm build` pass**
7. **Create a pull request** to `main`

## Development Setup

```sh
# Clone your fork
git clone <your-fork-url>
cd narwhal

# Install dependencies
pnpm install

# Run development mode
pnpm dev

# Run type checking
pnpm typecheck

# Build
pnpm build
```

## Style Guidelines

- **TypeScript**: Follow strict type checking. Use `interface` over `type` for object shapes.
- **React**: Prefer functional components with hooks. Keep components small and focused.
- **CSS**: Use the existing CSS architecture. Follow the established color palette and spacing.
- **File naming**: Use kebab-case for files (e.g., `my-component.tsx`, `use-hook.ts`).
- **IPC contracts**: Keep the shared contract in `src/shared/` in sync with both main and preload processes.

## Project Structure

```
src/
├── main/          # Electron main process (BFF, runtime management)
├── preload/       # Preload script (typed IPC bridge)
├── renderer/      # React renderer (UI components)
├── recovery/      # Recovery mode UI
└── shared/        # Shared types and contracts
```

## Questions?

Feel free to open an issue for any questions. We're happy to help!
