# VibePresto CLI

CLI for managing WordPress pages, framework-aware static builds, versioned VibePresto bundles, and multi-route deployments through the plugin API.

## Scope

The CLI supports two deployment styles:

- simple single-page static uploads for raw HTML/CSS/JS bundles
- framework-aware build, verify, route inspection, and deployment for static/exported frontend apps

Supported targets are static/exportable builds from common React, Next.js static export, Nuxt static export, Vite, Svelte/SvelteKit static output, TanStack static output, and similar projects that emit HTML plus assets on disk.

## Use with npx

```bash
npx vibepresto --help
```

## Run locally

```bash
node ./bin/vibepresto.js --help
```

## Core commands

### Auth

```bash
npx vibepresto login --site http://localhost:8000
npx vibepresto whoami --site http://localhost:8000 --json
npx vibepresto logout --site http://localhost:8000 --revoke
```

### Framework prep

```bash
npx vibepresto detect --project-dir ./landingpage --json
npx vibepresto build --project-dir ./landingpage --json
npx vibepresto verify --output-dir ./landingpage/dist --json
npx vibepresto routes inspect --output-dir ./landingpage/dist --json
```

Force SPA fallback mode for router apps:

```bash
npx vibepresto routes inspect --output-dir ./dist --route-mode spa --json
```

### Pages

```bash
npx vibepresto pages list --site http://localhost:8000 --json
npx vibepresto pages search --site http://localhost:8000 --query Home --json
npx vibepresto pages create --site http://localhost:8000 --title "Landing Page" --status draft --json
npx vibepresto pages set-status --site http://localhost:8000 --page-id 2 --status publish --json
npx vibepresto pages set-homepage --site http://localhost:8000 --page-id 2 --json
```

### Upload

Simple static folder upload:

```bash
npx vibepresto upload \
  --site http://localhost:8000 \
  --site-dir ./landing-page \
  --name "Landing page" \
  --page-id 2 \
  --json
```

Prebuilt artifact upload with route-aware metadata:

```bash
npx vibepresto upload \
  --site http://localhost:8000 \
  --zip ./dist.zip \
  --bundle-kind multi-entry \
  --route-manifest ./route-manifest.json \
  --json
```

Existing single-page folder mode still works:

- `index.html` must exist at the folder root
- local HTML/CSS/JS references must resolve inside that folder
- remote URLs, `data:` URLs, and anchors are allowed

### Deploy

Build, verify, inspect routes, upload, resolve pages, optionally create missing pages, and create a deployment:

```bash
npx vibepresto deploy \
  --site http://localhost:8000 \
  --project-dir ./landingpage \
  --json
```

Deploy a prebuilt output directory in mixed mode:

```bash
npx vibepresto deploy \
  --site http://localhost:8000 \
  --output-dir ./dist \
  --create-missing-pages \
  --json
```

Preview the route and page mapping plan without uploading:

```bash
npx vibepresto deploy \
  --site http://localhost:8000 \
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
npx vibepresto bundles list --site http://localhost:8000 --json
npx vibepresto bundles versions --site http://localhost:8000 --bundle-id 12 --json
npx vibepresto bundles rollback --site http://localhost:8000 --page-id 2 --version 1 --json

npx vibepresto deployments list --site http://localhost:8000 --json
npx vibepresto deployments show --site http://localhost:8000 --deployment-id 3 --json
npx vibepresto deployments promote --site http://localhost:8000 --deployment-id 3 --bundle-version-id 18 --json
npx vibepresto deployments rollback --site http://localhost:8000 --deployment-id 3 --version 1 --json
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
npx vibepresto whoami --site http://localhost:8000 --json
npx vibepresto build --project-dir ./my-app --json
npx vibepresto routes inspect --output-dir ./my-app/dist --json
npx vibepresto deploy --site http://localhost:8000 --output-dir ./my-app/dist --create-missing-pages --json
```

The CLI is the main automation surface for Codex or other agents. Prefer `--json` so callers can branch on stable response data.
