# The Mountain Path

A [Quartz v5](https://quartz.jzhao.xyz/) site publishing a curated subset of my notes — neuroscience, climbing, training, books, and the musings that don't fit anywhere else.

Lives at: `https://theoamvr.github.io/mountain-path` (after the first GitHub Pages deploy).

## Working on the site locally

You need **Node v22+** and **npm v10.9+**.

```bash
# Clone (first time on a new machine)
git clone https://github.com/theoamvr/mountain-path.git
cd mountain-path
npm ci
npx quartz plugin install

# Preview locally with hot reload
npx quartz build --serve
# → http://localhost:8080
```

Edit anything under `content/`. Files are plain Markdown with frontmatter; Obsidian opens this folder as a vault unchanged.

## Repo layout

```
content/                  ← all published Markdown lives here
  index.md                ← landing page
  journal-club/           ← neuroscience paper / concept notes
  book-club/              ← book notes
  training/               ← climbing, lifting, running, telemetry analyses
  expeditions/            ← goals and trip write-ups
  musings/                ← essays and half-formed thoughts
  youtube/                ← video plans, transcripts, links
quartz.config.yaml        ← site configuration (title, theme, plugins)
.github/workflows/        ← GitHub Pages deploy workflow
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds Quartz and publishes to GitHub Pages. To set this up the first time:

1. Create a public repo on GitHub: `theoamvr/mountain-path`.
2. `git init && git add . && git commit -m "Initial commit"`
3. `git branch -M main`
4. `git remote add origin git@github.com:theoamvr/mountain-path.git`
5. `git push -u origin main`
6. In the repo's **Settings → Pages**, set **Source: GitHub Actions**.
7. (Once the first build succeeds) — the site URL appears at the top of the Pages settings page.

## What's published vs. private

The site is fed by a *curated copy* of selected notes from several private Obsidian vaults. Source vaults are not mounted into this repo; nothing here is auto-synced. Publishing happens by deliberately copying a note in, lightly editing it for a public reader, and committing.

## Re-enabling Open Graph preview images

The `og-image` plugin is disabled in `quartz.config.yaml` because it requires network access to Google Fonts at build time. To re-enable for production:

```yaml
- source: github:quartz-community/og-image
  enabled: true
```

GitHub Actions has network access, so this works fine when triggered by a push — only local sandbox builds fail.
