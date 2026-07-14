# Repository Working Agreement

## Motto

**Clean boundaries. One source of truth. Reusable behavior. Polished interactions.**

Every change should leave the repository easier to understand, extend, test, and use.

## Engineering rules

- Keep route pages and feature shells focused on lifecycle, provider scope, and composition. Feature behavior belongs in a cohesive component, scoped service, directive, or pure helper.
- Give state one clear owner. Persisted document state belongs in the model, shared editor/session state in the appropriate scoped service, and temporary interaction state in the component or service that owns the gesture.
- Search for an existing implementation before adding UI, commands, geometry, mutation, or formatting logic. Extend the existing owner when the responsibility matches.
- Do not copy behavior between views. When an interaction has a second real consumer, extract the stable behavior into a shared component, directive, service, or pure function and keep view-specific presentation at the edge.
- Prefer composition and narrow typed interfaces over large components, inheritance hierarchies, or services that collect unrelated behavior.
- Keep templates declarative. Complex calculations, mutation orchestration, pointer state machines, and recursive projections should have named TypeScript owners.
- Keep persistent changes behind `DocumentMutationService` and structural layer changes behind `LayerOperationsService`/`LayerCommandService` as documented in `ARCHITECTURE.md`.
- Preserve serialization compatibility unless the task explicitly includes a versioned migration.

## UI and UX rules

- Build custom views as cohesive components with explicit layout and stacking behavior. Component extraction must preserve the original flex/grid box topology; use a deliberate host display instead of relying on browser defaults.
- Reusable interactions must support every input path relevant to the feature: pointer, keyboard, focus, cancellation, and no-op completion.
- Define overlay and editor-surface stacking deliberately. Avoid incidental DOM-order layering and broad selectors that can style nested component internals.
- Reuse design tokens and established controls before introducing new colors, spacing, radii, typography, or interaction patterns.
- Preserve visible behavior during refactors. Any intentional UX change must be called out and tested separately from structural movement.

## Completion checklist

- The change has one clear owner for each new responsibility.
- No equivalent implementation was duplicated elsewhere.
- Extracted components preserve layout, focus, overlay, and event behavior.
- Persistent mutations commit once through the correct domain boundary.
- Relevant characterization or interaction tests cover the change.
- `npm test -- --watch=false`, `npm run build`, and `git diff --check` pass.

See `CONTRIBUTING.md` for the human-facing guide and `ARCHITECTURE.md` for current ownership contracts.
