# VibePresto CLI

CLI for managing WordPress pages, preparing static frontend builds, uploading versioned bundles, and creating multi-route VibePresto deployments.

## Overview

The CLI supports two deployment styles:

- simple single-page uploads for raw HTML/CSS/JS bundles
- framework-aware build, verify, route inspection, and deployment for static/exported frontend apps

Supported targets are static/exportable builds from common React, Next.js static export, Nuxt static export, Vite, Svelte/SvelteKit static output, TanStack static output, and similar projects that emit HTML plus assets on disk.

## Use with npx

```bash
npx vibepresto --help
```

## Core commands

### Auth

```bash
npx vibepresto login --site https://your-site.example
npx vibepresto whoami --site https://your-site.example --json
npx vibepresto logout --site https://your-site.example --revoke
```

### Framework prep

```bash
npx vibepresto detect --project-dir ./my-app --json
npx vibepresto build --project-dir ./my-app --json
npx vibepresto verify --output-dir ./my-app/dist --json
npx vibepresto routes inspect --output-dir ./my-app/dist --json
```

Force SPA fallback mode for router apps:

```bash
npx vibepresto routes inspect --output-dir ./dist --route-mode spa --json
```

### Pages

```bash
npx vibepresto pages list --site https://your-site.example --json
npx vibepresto pages search --site https://your-site.example --query Home --json
npx vibepresto pages create --site https://your-site.example --title "Landing Page" --status draft --json
npx vibepresto pages set-status --site https://your-site.example --page-id 123 --status publish --json
npx vibepresto pages set-homepage --site https://your-site.example --page-id 123 --json
```

### Upload

Simple static folder upload:

```bash
npx vibepresto upload \
  --site https://your-site.example \
  --site-dir ./landing-page \
  --name "Landing page" \
  --page-id 123 \
  --json
```

Prebuilt artifact upload with route-aware metadata:

```bash
npx vibepresto upload \
  --site https://your-site.example \
  --zip ./dist.zip \
  --bundle-kind multi-entry \
  --route-manifest ./route-manifest.json \
  --json
```

Single-page folder mode rules:

- `index.html` must exist at the folder root
- local HTML/CSS/JS references must resolve inside that folder
- remote URLs, `data:` URLs, and anchors are allowed

### Deploy

Build, verify, inspect routes, upload, resolve pages, optionally create missing pages, and create a deployment:

```bash
npx vibepresto deploy \
  --site https://your-site.example \
  --project-dir ./my-app \
  --json
```

Deploy a prebuilt output directory in mixed mode:

```bash
npx vibepresto deploy \
  --site https://your-site.example \
  --output-dir ./dist \
  --create-missing-pages \
  --json
```

Preview the route and page mapping plan without uploading:

```bash
npx vibepresto deploy \
  --site https://your-site.example \
  --output-dir ./dist \
  --dry-run \
  --json
```

Useful deploy flags:

- `--route-mode auto|manifest|spa`
- `--create-missing-pages`
- `--no-create-missing-pages`
- `--page-status draft|publish|pending|private`
- `--page-title-strategy from-manifest|from-route|explicit-prefix`
- `--page-prefix <slug-prefix>`
- `--homepage-route /`

### Bundle and deployment history

```bash
npx vibepresto bundles list --site https://your-site.example --json
npx vibepresto bundles versions --site https://your-site.example --bundle-id 12 --json
npx vibepresto bundles rollback --site https://your-site.example --page-id 123 --version 1 --json

npx vibepresto deployments list --site https://your-site.example --json
npx vibepresto deployments show --site https://your-site.example --deployment-id 3 --json
npx vibepresto deployments promote --site https://your-site.example --deployment-id 3 --bundle-version-id 18 --json
npx vibepresto deployments rollback --site https://your-site.example --deployment-id 3 --version 1 --json
```

## JSON output

Success:

```json
{
  "ok": true,
  "data": {}
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "bundle_verification_failed",
    "message": "Human-readable error message.",
    "details": {}
  }
}
```

## Agent flow

Typical framework-aware flow:

```bash
npx vibepresto whoami --site https://your-site.example --json
npx vibepresto build --project-dir ./my-app --json
npx vibepresto routes inspect --output-dir ./my-app/dist --json
npx vibepresto deploy --site https://your-site.example --output-dir ./my-app/dist --create-missing-pages --json
```

The CLI is the main automation surface for Codex or other agents. Prefer `--json` so callers can branch on stable response data.
