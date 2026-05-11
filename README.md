# VibePresto CLI

CLI for managing WordPress pages and uploading VibePresto bundles through the plugin API.

## Current scope

This first pass targets simple static sites:

- `index.html` at the folder root
- plain HTML, CSS, and JS assets
- no build step, framework output detection, or dependency installation

If you point the CLI at a local site folder, it verifies local HTML/CSS/JS references, creates a temporary ZIP bundle, and uploads that ZIP for you.

## Use with npx

Run the published CLI without installing globally:

```bash
npx vibepresto --help
```

## Run locally

From this repo:

```bash
node ./bin/vibepresto.js --help
```

## Commands

### `login`

Start device-style login and wait for approval:

```bash
npx vibepresto login --site http://localhost:8000
```

Skip browser auto-open:

```bash
npx vibepresto login --site http://localhost:8000 --no-open
```

Manual flow:

```bash
npx vibepresto login --site http://localhost:8000 --manual --json
npx vibepresto login --site http://localhost:8000 --device-code <device_code> --completion-code <completion_code>
```

### `whoami`

Inspect the active saved session:

```bash
npx vibepresto whoami --site http://localhost:8000 --json
```

### `pages search`

Search WordPress pages before assigning a bundle:

```bash
npx vibepresto pages search --site http://localhost:8000 --query Home --json
```

### `pages list`

Retrieve all pages, optionally filtered by status:

```bash
npx vibepresto pages list --site http://localhost:8000 --json
npx vibepresto pages list --site http://localhost:8000 --status draft --json
```

### `pages create`

Create a new WordPress page:

```bash
npx vibepresto pages create \
  --site http://localhost:8000 \
  --title "Landing Page" \
  --slug landing-page \
  --status draft \
  --json
```

### `pages set-status`

Change the status of an existing page:

```bash
npx vibepresto pages set-status \
  --site http://localhost:8000 \
  --page-id 2 \
  --status publish \
  --json
```

### `pages set-homepage`

Set a page as the default WordPress homepage:

```bash
npx vibepresto pages set-homepage \
  --site http://localhost:8000 \
  --page-id 2 \
  --json
```

### `upload` with auto-bundling

Point at a local static site folder:

```bash
npx vibepresto upload \
  --site http://localhost:8000 \
  --site-dir ./landing-page \
  --name "Landing page" \
  --json
```

Upload and assign to a page:

```bash
npx vibepresto upload \
  --site http://localhost:8000 \
  --site-dir ./landing-page \
  --name "Landing page" \
  --page-id 2 \
  --json
```

Folder mode rules:

- `index.html` must exist at the folder root
- local HTML/CSS/JS references in `index.html` must resolve inside that folder
- remote URLs like `https://...`, `//...`, `data:...`, and anchors are allowed

### `upload` with an existing ZIP

```bash
npx vibepresto upload \
  --site http://localhost:8000 \
  --zip ./landing-page.zip \
  --name "Prebuilt bundle" \
  --json
```

### `upload` with explicit files

```bash
npx vibepresto upload \
  --site http://localhost:8000 \
  --html ./site/index.html \
  --css ./site/style.css \
  --js ./site/app.js \
  --name "Separate files bundle" \
  --json
```

Add extra assets:

```bash
npx vibepresto upload \
  --site http://localhost:8000 \
  --html ./site/index.html \
  --css ./site/style.css \
  --js ./site/app.js \
  --asset ./site/logo.png \
  --asset ./site/font.woff2 \
  --name "Separate files bundle" \
  --json
```

### `logout`

Clear local credentials:

```bash
npx vibepresto logout --site http://localhost:8000
```

Clear local credentials and revoke the remote session:

```bash
npx vibepresto logout --site http://localhost:8000 --revoke
```

## JSON output

Use `--json` for machine-readable automation output.

Success shape:

```json
{
  "ok": true,
  "data": {}
}
```

Failure shape:

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

## LLM-friendly example

Typical agent flow:

```bash
npx vibepresto whoami --site http://localhost:8000 --json
npx vibepresto pages create --site http://localhost:8000 --title "Sample Page" --status draft --json
npx vibepresto upload --site http://localhost:8000 --site-dir ./my-static-site --page-id 2 --json
npx vibepresto pages set-status --site http://localhost:8000 --page-id 2 --status publish --json
npx vibepresto pages set-homepage --site http://localhost:8000 --page-id 2 --json
```

The CLI is meant to be the main automation surface for Codex or other agents. Prefer `--json` so the caller can branch on stable response data.
