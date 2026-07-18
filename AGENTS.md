# Palserver GUI — Codex project guidance

## Project map

- `packages/agent`: Fastify-based agent daemon and server integrations.
- `packages/web`: React/Vite management interface.
- `packages/shared`: Shared types, command metadata, and configuration schemas.

## Working conventions

- Use English for runtime errors, logs, diagnostics, command metadata, and source comments. User-facing UI text belongs in `packages/web/public/i18n/` and should use the existing `t()`/`translate()` helpers.
- Preserve Traditional Chinese source keys used by the web localization system; translate their values in locale dictionaries instead of changing keys casually.
- Do not commit secrets, host-specific paths, tokens, or generated scratch-directory paths.
- Keep `.claude/notes/` as historical research unless a task explicitly asks to migrate or remove it. Codex instructions live in this file.

## Validation

- Run `pnpm typecheck` after TypeScript changes.
- Run `pnpm build` for release-facing changes.
