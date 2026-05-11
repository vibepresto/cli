# VibePresto CLI

CLI for uploading VibePresto bundles to WordPress through the plugin API.

## Current scope

This first pass targets simple static sites:

- `index.html` at the folder root
- plain HTML, CSS, and JS assets
- no build step, framework output detection, or dependency installation

If you point the CLI at a local site folder, it verifies local HTML/CSS/JS references, creates a temporary ZIP bundle, and uploads that ZIP for you.

## Run locally

From this repo:

```bash
node packages/vibepresto-cli/bin/vibepresto.js --help
```

## Commands

### `login`

Start device-style login and wait for approval:

```bash
node packages/vibepresto-cli/bin/vibepresto.js login --site http://localhost:8000
```

Skip browser auto-open:

```bash
node packages/vibepresto-cli/bin/vibepresto.js login --site http://localhost:8000 --no-open
```

Manual flow:

```bash
node packages/vibepresto-cli/bin/vibepresto.js login --site http://localhost:8000 --manual --json
node packages/vibepresto-cli/bin/vibepresto.js login --site http://localhost:8000 --device-code <device_code> --completion-code <completion_code>
```

### `whoami`

Inspect the active saved session:

```bash
node packages/vibepresto-cli/bin/vibepresto.js whoami --site http://localhost:8000 --json
```

### `pages search`

Search WordPress pages before assigning a bundle:

```bash
node packages/vibepresto-cli/bin/vibepresto.js pages search --site http://localhost:8000 --query Home --json
```

### `upload` with auto-bundling

Point at a local static site folder:

```bash
node packages/vibepresto-cli/bin/vibepresto.js upload \
  --site http://localhost:8000 \
  --site-dir examples/landing-page \
  --name "Landing page" \
  --json
```

Upload and assign to a page:

```bash
node packages/vibepresto-cli/bin/vibepresto.js upload \
  --site http://localhost:8000 \
  --site-dir examples/landing-page \
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
node packages/vibepresto-cli/bin/vibepresto.js upload \
  --site http://localhost:8000 \
  --zip examples/landing-page.zip \
  --name "Prebuilt bundle" \
  --json
```

### `upload` with explicit files

```bash
node packages/vibepresto-cli/bin/vibepresto.js upload \
  --site http://localhost:8000 \
  --html ./site/index.html \
  --css ./site/style.css \
  --js ./site/app.js \
  --name "Separate files bundle" \
  --json
```

Add extra assets:

```bash
node packages/vibepresto-cli/bin/vibepresto.js upload \
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
node packages/vibepresto-cli/bin/vibepresto.js logout --site http://localhost:8000
```

Clear local credentials and revoke the remote session:

```bash
node packages/vibepresto-cli/bin/vibepresto.js logout --site http://localhost:8000 --revoke
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
node packages/vibepresto-cli/bin/vibepresto.js whoami --site http://localhost:8000 --json
node packages/vibepresto-cli/bin/vibepresto.js pages search --site http://localhost:8000 --query sample-page --json
node packages/vibepresto-cli/bin/vibepresto.js upload --site http://localhost:8000 --site-dir ./my-static-site --page-id 2 --json
```

The CLI is meant to be the main automation surface for Codex or other agents. Prefer `--json` so the caller can branch on stable response data.
