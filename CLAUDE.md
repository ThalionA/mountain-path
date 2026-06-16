# MountainPath — Quartz publishing site

Quartz v5 site ("The Mountain Path") publishing a curated subset of the private vaults (ResearchVault, PersonalWiki, ExpeditionVault). British English.

- **Source of truth for the site is `content/`.** Pieces are hand-curated copies from the private vaults — edits here do not flow back, and vault edits do not flow here automatically.
- Build/preview: `npx quartz build --serve` (Node ≥22, npm ≥10.9). Lint/typecheck: `npm run check`. Publishing: GitHub repo `ThalionA/mountain-path` → GitHub Pages (see `README.md`).
- Edit only `content/` and `quartz.config.yaml`. Never touch `quartz/` internals, `.quartz/`, or `node_modules/` — this is a vendored framework, not our code.
- When asked to publish a note from a vault: copy + adapt it into the right `content/` section (neuroscience, training, expeditions, book-club, musings), fix vault-internal wikilinks that won't resolve publicly, and strip anything private (names, finances, telemetry beyond what the note itself shows).
