# Narwhal Composer Handoff

## Scope

Continue development of the chat composer in `/Users/YMINGTA/01_YMT/narwhal-forge-macos`.

Original user requirements:

1. The permission control at the bottom of the chat composer could not be opened or changed.
2. Provider and model controls should sit farther to the right and may be clearer as one combined dropdown.
3. The composer also needs a reasoning `Effort` setting.
4. Remove redundant bottom status text when it conflicts with the composer controls.

Reference screenshots supplied during the discussion are temporary clipboard files:

- `/var/folders/s2/1w4sp2cd3ln5npm7zstcpvmw0000gn/T/codex-clipboard-a934b0ab-3ba3-4a3b-9033-4c79cf1061b2.png`
- `/var/folders/s2/1w4sp2cd3ln5npm7zstcpvmw0000gn/T/codex-clipboard-6db78ccd-2c69-4ed7-bd1a-b546808aa4c0.png`
- `/var/folders/s2/1w4sp2cd3ln5npm7zstcpvmw0000gn/T/codex-clipboard-b32a4cca-6320-4bf1-bfe5-94b114841cb9.png`
- `/var/folders/s2/1w4sp2cd3ln5npm7zstcpvmw0000gn/T/codex-clipboard-976f32a3-9a57-486c-9358-655c5a73967b.png`

The screenshots communicate the intended hierarchy: permission is an interactive control, provider/model are grouped, and model effort is visible near the composer footer. They are visual references only, not implementation instructions.

## Current Design Direction

- Dark native macOS workbench surface with the existing charcoal/teal palette.
- Permission is a compact native select on the left of the composer footer.
- Provider and model use one native select with provider `optgroup` sections.
- Reasoning effort is a compact native select beside the model selector when the selected model exposes efforts.
- The model/effort/actions cluster is right-aligned on desktop and wraps below 720px.
- The bottom status bar no longer repeats `Workspace write`; that value is represented by the composer permission select. Keep `Local only`, Git status, and Agent status.
- Native controls are intentional for keyboard access and reliable macOS menu behavior. A custom popover matching the reference screenshot is a future refinement, not required for this handoff.

## Implementation State

Implemented in:

- `src/renderer/main.tsx`
  - `App` loads and updates `AgentConfiguration`.
  - `Composer` renders permission options from `configuration.permissionOptions` and calls `api.setDefaultPermission` through `selectPermission`.
  - `ModelPicker` uses a composite provider/model value with `optgroup` sections.
  - `ModelPicker` renders `Effort` from `AgentModel.efforts` and calls `api.selectAgentModel` with `reasoningEffort` while preserving provider/model.
  - The footer no longer renders the redundant bottom `Workspace write` status.
- `src/renderer/styles.css`
  - Right-aligned composer action cluster.
  - Compact permission, model, and effort select styling.
  - Responsive wrapping below 720px.

The backend contract already supports the required operations:

- `src/shared/desktop-contract.ts`: `AgentConfiguration`, `AgentModel`, `ModelEffort`, `selectAgentModel`, and `setDefaultPermission`.
- `src/preload/index.cts`: typed renderer bridge.
- `src/main/index.ts`: IPC handlers.
- `src/main/host-bridge.ts`: configuration normalization and Host mutations.

## Behavioral Caveats

- `setDefaultPermission` changes the Host default for new conversations. The current Host bridge does not expose a separate per-active-session permission mutation.
- Selecting a provider in the combined dropdown chooses the first model from that provider and its default effort.
- Models without effort options do not render an Effort control.
- The current native select is not the full custom two-row popover shown in the reference image.

## Verification

Run from the project root:

```sh
pnpm run typecheck
pnpm run build
pnpm dev
```

`pnpm run typecheck` and `pnpm run build` passed after the latest Effort and status-bar changes. `pnpm dev` launches the Electron development instance. A packaged DMG is not required for UI iteration; use `pnpm run package:mac` only when a distributable artifact is needed.

Existing project documentation:

- `README.md`: architecture, development, V1 scope, and packaging commands.
- `docs/macos-release-checklist.md`: arm64 packaging, runtime staging, signing, notarization, and release verification.
- `output/playwright/`: prior renderer and packaged-app screenshots for visual comparison.

## Next Agent Task

Continue from this state by reviewing the current composer UI in the running app, then refine or replace the native grouped controls only if the user approves a closer custom popover design. Preserve the existing typed Host bridge and rerun typecheck/build after changes.
