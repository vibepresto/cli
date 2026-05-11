#!/usr/bin/env node

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 2;
const EXIT_AUTH = 3;
const EXIT_VALIDATION = 4;
const EXIT_SERVER = 5;

const CONFIG_DIR = path.join(os.homedir(), '.vibepresto');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

main().catch((error) => {
    emitError(error, hasJsonFlag(process.argv.slice(2)));
    process.exit(exitCodeForError(error));
});

async function main() {
    const argv = process.argv.slice(2);
    const { positionals, options } = parseArgs(argv);
    const json = Boolean(options.json);
    const command = positionals[0];
    const subcommand = positionals[1];

    if (! command || options.help) {
        printHelp();
        process.exit(EXIT_SUCCESS);
    }

    if (command === 'login') {
        if (options.completionCode) {
            await completeLogin(options, json);
        } else {
            await startLogin(options, json);
        }
        return;
    }

    if (command === 'whoami') {
        const client = await createAuthenticatedClient(options);
        const response = await client.request('/auth/me');
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'logout') {
        await logout(options, json);
        return;
    }

    if (command === 'pages' && subcommand === 'search') {
        const client = await createAuthenticatedClient(options);
        const query = stringOption(options.query, '--query is required for `pages search`.');
        const response = await client.request('/pages?q=' + encodeURIComponent(query));
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'pages' && subcommand === 'list') {
        const client = await createAuthenticatedClient(options);
        const response = await listPages(client, options);
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'pages' && subcommand === 'create') {
        const client = await createAuthenticatedClient(options);
        const response = await createPage(client, options);
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'pages' && subcommand === 'set-status') {
        const client = await createAuthenticatedClient(options);
        const response = await setPageStatus(client, options);
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'pages' && subcommand === 'set-homepage') {
        const client = await createAuthenticatedClient(options);
        const response = await setPageHomepage(client, options);
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'upload') {
        const client = await createAuthenticatedClient(options);
        const response = await uploadBundle(client, options);
        emitSuccess(response.data, json);
        return;
    }

    throw cliError('usage_error', 'Unknown command.', EXIT_USAGE);
}

async function startLogin(options, json) {
    const site = normalizeSiteUrl(stringOption(options.site, '--site is required for `login`.'));
    const payload = {
        client_name: 'VibePresto CLI',
        machine_name: os.hostname(),
        scope: ['bundles:write', 'pages:read', 'pages:write', 'pages:assign', 'site:write'],
    };

    const response = await apiRequest(site, '/auth/device', {
        method: 'POST',
        json: payload,
    });

    if (options.manual) {
        emitSuccess({
            site_url: site,
            ...response.data,
        }, json);
        return;
    }

    const authorization = response.data;
    const verificationUrl = getVerificationUrl(authorization);
    if (! json) {
        process.stderr.write('Open this URL and approve the CLI:\n');
        process.stderr.write(verificationUrl + '\n');
        process.stderr.write('User code: ' + authorization.user_code + '\n');
    }

    if (! options.noOpen && verificationUrl) {
        openBrowser(verificationUrl);
    }

    const timeoutAt = Date.now() + authorization.expires_in * 1000;
    const interval = Math.max(authorization.interval || 5, 2);

    while (Date.now() < timeoutAt) {
        await sleep(interval * 1000);

        const tokenResponse = await apiRequest(site, '/auth/token', {
            method: 'POST',
            json: {
                device_code: authorization.device_code,
            },
            allowError: true,
        });

        if (tokenResponse.ok) {
            await saveSiteSession(site, tokenResponse.data);
            emitSuccess({
                site_url: site,
                ...tokenResponse.data,
            }, json);
            return;
        }

        const code = tokenResponse.error.code;
        if (code === 'authorization_pending' || code === 'slow_down') {
            continue;
        }

        throw apiError(tokenResponse);
    }

    throw cliError(
        'authorization_timeout',
        'Authorization timed out. Re-run login with `--completion-code` and the completion code from wp-admin if needed.',
        EXIT_AUTH,
        {
            site_url: site,
            device_code: authorization.device_code,
            user_code: authorization.user_code,
            verification_url: verificationUrl,
        }
    );
}

async function completeLogin(options, json) {
    const site = normalizeSiteUrl(stringOption(options.site, '--site is required for `login --completion-code`.'));
    const completionCode = stringOption(options.completionCode, '--completion-code is required.');
    const deviceCode = options.deviceCode ? String(options.deviceCode) : '';

    const response = await apiRequest(site, '/auth/token', {
        method: 'POST',
        json: {
            device_code: deviceCode,
            completion_code: completionCode,
        },
    });

    await saveSiteSession(site, response.data);
    emitSuccess({
        site_url: site,
        ...response.data,
    }, json);
}

async function logout(options, json) {
    const site = normalizeSiteUrl(stringOption(options.site, '--site is required for `logout`.'));
    const config = await loadConfig();
    const session = config.sites[site];
    if (! session) {
        throw cliError('not_logged_in', 'No saved VibePresto session was found for that site.', EXIT_AUTH);
    }

    if (options.revoke) {
        try {
            const client = await createAuthenticatedClient({ site });
            await client.request('/auth/revoke', {
                method: 'POST',
                json: {
                    session_id: session.session_id,
                },
            });
        } catch (error) {
            if (! json) {
                process.stderr.write('Remote revoke failed, clearing local session anyway.\n');
            }
        }
    }

    delete config.sites[site];
    await saveConfig(config);
    emitSuccess({ site_url: site, logged_out: true }, json);
}

async function uploadBundle(client, options) {
    const input = await resolveUploadInput(options);
    const form = new FormData();
    const displayName = options.name ? String(options.name) : '';

    form.append('mode', input.mode);

    if (displayName) {
        form.append('display_name', displayName);
    }

    if (input.mode === 'zip') {
        form.append('bundle_zip', await fileBlob(input.zipPath), path.basename(input.zipPath));
    } else {
        form.append('bundle_html', await fileBlob(input.htmlPath), path.basename(input.htmlPath));

        if (input.cssPath) {
            form.append('bundle_css', await fileBlob(input.cssPath), path.basename(input.cssPath));
        }

        if (input.jsPath) {
            form.append('bundle_js', await fileBlob(input.jsPath), path.basename(input.jsPath));
        }

        for (const assetPath of input.assetPaths) {
            form.append('bundle_assets[]', await fileBlob(assetPath), path.basename(assetPath));
        }
    }

    if (options.pageId) {
        form.append('assign_page_id', String(options.pageId));
    }

    try {
        const response = await client.request('/bundles', {
            method: 'POST',
            body: form,
        });

        return {
            ok: true,
            data: {
                site_url: client.site,
                upload_source: input.uploadSource,
                auto_bundle: input.autoBundle,
                entry_html_local: input.entryHtmlLocal,
                verified_local_files: input.verifiedLocalFiles,
                ...response.data,
            },
        };
    } finally {
        if (input.cleanup) {
            await input.cleanup();
        }
    }
}

async function listPages(client, options) {
    const params = new URLSearchParams();
    if (options.status) {
        params.set('status', String(options.status));
    }

    const endpoint = '/pages' + (params.size > 0 ? '?' + params.toString() : '');
    return await client.request(endpoint);
}

async function createPage(client, options) {
    const title = stringOption(options.title, '--title is required for `pages create`.');
    const payload = { title };

    if (options.slug) {
        payload.slug = String(options.slug);
    }

    if (options.status) {
        payload.status = String(options.status);
    }

    if (options.content) {
        payload.content = String(options.content);
    }

    return await client.request('/pages', {
        method: 'POST',
        json: payload,
    });
}

async function setPageStatus(client, options) {
    const pageId = positiveIntOption(options.pageId, '--page-id is required for `pages set-status`.');
    const status = stringOption(options.status, '--status is required for `pages set-status`.');

    return await client.request('/pages/' + pageId + '/status', {
        method: 'POST',
        json: { status },
    });
}

async function setPageHomepage(client, options) {
    const pageId = positiveIntOption(options.pageId, '--page-id is required for `pages set-homepage`.');

    return await client.request('/pages/' + pageId + '/homepage', {
        method: 'POST',
        json: {},
    });
}

async function resolveUploadInput(options) {
    if (options.siteDir) {
        return prepareSiteDirectoryUpload(String(options.siteDir));
    }

    if (options.zip) {
        const zipPath = path.resolve(String(options.zip));
        await ensureReadableFile(zipPath, 'The ZIP bundle could not be read.');

        return {
            mode: 'zip',
            zipPath,
            uploadSource: 'zip',
            autoBundle: false,
            entryHtmlLocal: null,
            verifiedLocalFiles: [],
            cleanup: null,
        };
    }

    const html = stringOption(options.html, 'One of `--site-dir`, `--zip`, or `--html` is required for `upload`.');
    const htmlPath = path.resolve(html);
    await ensureReadableFile(htmlPath, 'The HTML file could not be read.');

    const cssPath = options.css ? path.resolve(String(options.css)) : null;
    const jsPath = options.js ? path.resolve(String(options.js)) : null;
    const assetPaths = arrayOption(options.asset).map((assetPath) => path.resolve(assetPath));

    if (cssPath) {
        await ensureReadableFile(cssPath, 'The CSS file could not be read.');
    }

    if (jsPath) {
        await ensureReadableFile(jsPath, 'The JS file could not be read.');
    }

    for (const assetPath of assetPaths) {
        await ensureReadableFile(assetPath, 'One of the asset files could not be read.');
    }

    return {
        mode: 'separate',
        htmlPath,
        cssPath,
        jsPath,
        assetPaths,
        uploadSource: 'explicit-files',
        autoBundle: false,
        entryHtmlLocal: path.basename(htmlPath),
        verifiedLocalFiles: [htmlPath].concat(cssPath ? [cssPath] : [], jsPath ? [jsPath] : [], assetPaths),
        cleanup: null,
    };
}

async function prepareSiteDirectoryUpload(siteDir) {
    const rootDir = path.resolve(siteDir);
    const indexPath = path.join(rootDir, 'index.html');
    await ensureReadableFile(indexPath, 'The site directory must contain a readable `index.html` at its root.', 'missing_entrypoint');

    const verification = await verifySiteDirectory(rootDir, indexPath);
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vibepresto-bundle-'));
    const zipPath = path.join(tempDir, sanitizeFileComponent(path.basename(rootDir) || 'site') + '.zip');

    try {
        await zipDirectory(rootDir, zipPath);
    } catch (error) {
        await cleanupPath(tempDir);
        throw error;
    }

    return {
        mode: 'zip',
        zipPath,
        uploadSource: 'site-dir',
        autoBundle: true,
        entryHtmlLocal: 'index.html',
        verifiedLocalFiles: verification.verifiedFiles,
        cleanup: async function () {
            await cleanupPath(tempDir);
        },
    };
}

async function verifySiteDirectory(rootDir, indexPath) {
    const html = await fsp.readFile(indexPath, 'utf8');
    const references = extractLocalAssetReferences(html);
    const verified = [indexPath];

    for (const reference of references) {
        const resolvedPath = resolveLocalReference(rootDir, reference);
        if (resolvedPath === null) {
            throw cliError(
                'unsupported_local_layout',
                'The site directory contains a local reference that escapes the bundle root.',
                EXIT_VALIDATION,
                { reference }
            );
        }

        await ensureReadableFile(
            resolvedPath,
            'A referenced local asset is missing from the site directory.',
            'missing_local_asset',
            { reference, resolved_path: resolvedPath }
        );
        verified.push(resolvedPath);
    }

    return {
        verifiedFiles: Array.from(new Set(verified)),
    };
}

function extractLocalAssetReferences(html) {
    const references = new Set();
    const pattern = /\b(?:href|src)\s*=\s*(["'])([^"'#]+)\1/gi;
    let match;

    while ((match = pattern.exec(html)) !== null) {
        const candidate = String(match[2] || '').trim();
        if (! isBundledLocalReference(candidate)) {
            continue;
        }

        if (! /\.(?:html?|css|js)(?:[?#].*)?$/i.test(candidate)) {
            continue;
        }

        references.add(stripQueryAndHash(candidate));
    }

    return Array.from(references);
}

function isBundledLocalReference(reference) {
    if (! reference) {
        return false;
    }

    if (reference.startsWith('#') || reference.startsWith('data:')) {
        return false;
    }

    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) {
        return false;
    }

    return true;
}

function stripQueryAndHash(reference) {
    return reference.split('#')[0].split('?')[0];
}

function resolveLocalReference(rootDir, reference) {
    const normalized = reference.replace(/\\/g, '/');
    const resolved = path.resolve(rootDir, normalized);
    const relative = path.relative(rootDir, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }

    return resolved;
}

async function zipDirectory(sourceDir, outputZipPath) {
    const result = await runProcess('zip', ['-qr', outputZipPath, '.'], { cwd: sourceDir });
    if (result.code !== 0) {
        throw cliError(
            'bundle_zip_failed',
            'The CLI could not create a ZIP bundle from the site directory.',
            EXIT_SERVER,
            { stderr: result.stderr.trim() }
        );
    }
}

async function runProcess(command, args, options = {}) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', function (chunk) {
            stdout += chunk.toString();
        });

        child.stderr.on('data', function (chunk) {
            stderr += chunk.toString();
        });

        child.on('error', function (error) {
            reject(cliError(
                'process_spawn_failed',
                'A required local command could not be started.',
                EXIT_SERVER,
                { command, cause: error.message }
            ));
        });

        child.on('close', function (code) {
            resolve({ code, stdout, stderr });
        });
    });
}

async function ensureReadableFile(filePath, message, code = 'bundle_verification_failed', details = {}) {
    try {
        const stat = await fsp.stat(filePath);
        if (! stat.isFile()) {
            throw new Error('not_a_file');
        }
        await fsp.access(filePath);
    } catch (error) {
        throw cliError(code, message, EXIT_VALIDATION, {
            path: filePath,
            ...details,
        });
    }
}

async function cleanupPath(targetPath) {
    await fsp.rm(targetPath, { recursive: true, force: true });
}

async function createAuthenticatedClient(options) {
    const site = normalizeSiteUrl(stringOption(options.site, '--site is required.'));
    const config = await loadConfig();
    const session = config.sites[site];
    if (! session) {
        throw cliError('not_logged_in', 'No saved VibePresto session was found for that site. Run `vibepresto login --site <url>` first.', EXIT_AUTH);
    }

    if (! session.access_token || ! session.refresh_token) {
        throw cliError('not_logged_in', 'Saved VibePresto credentials are incomplete. Run login again.', EXIT_AUTH);
    }

    async function refreshIfNeeded() {
        const expiresSoon = ! session.access_expires_at || Number(session.access_expires_at) <= (Date.now() + 60000);
        if (! expiresSoon) {
            return;
        }

        const refreshed = await apiRequest(site, '/auth/refresh', {
            method: 'POST',
            json: {
                refresh_token: session.refresh_token,
            },
        });

        Object.assign(session, {
            access_token: refreshed.data.access_token,
            refresh_token: refreshed.data.refresh_token,
            access_expires_at: Date.now() + refreshed.data.expires_in * 1000,
            session_id: refreshed.data.session_id,
            user_display_name: refreshed.data.user_display_name,
        });

        config.sites[site] = session;
        await saveConfig(config);
    }

    return {
        site,
        async request(endpoint, init = {}) {
            await refreshIfNeeded();
            const headers = Object.assign({}, init.headers || {}, {
                Authorization: 'Bearer ' + session.access_token,
            });
            const response = await apiRequest(site, endpoint, {
                ...init,
                headers,
                allowError: true,
            });

            if (! response.ok) {
                if (response.error.code === 'expired_token' || response.error.code === 'invalid_token') {
                    Object.assign(session, { access_expires_at: 0 });
                    config.sites[site] = session;
                    await saveConfig(config);
                    await refreshIfNeeded();

                    const retried = await apiRequest(site, endpoint, {
                        ...init,
                        headers: Object.assign({}, init.headers || {}, {
                            Authorization: 'Bearer ' + session.access_token,
                        }),
                        allowError: true,
                    });

                    if (! retried.ok) {
                        throw apiError(retried);
                    }

                    return retried;
                }

                throw apiError(response);
            }

            return response;
        },
    };
}

async function apiRequest(site, endpoint, init = {}) {
    const [routePath, routeQuery] = String(endpoint).split('?');
    const url = site + '/index.php?rest_route=' + encodeURIComponent('/vibepresto/v1' + routePath) + (routeQuery ? '&' + routeQuery : '');
    const headers = new Headers(init.headers || {});

    if (init.json) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
        method: init.method || 'GET',
        headers,
        body: init.json ? JSON.stringify(init.json) : init.body,
    });

    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : {};
    } catch (error) {
        throw cliError('invalid_response', 'The WordPress site returned a non-JSON response.', EXIT_SERVER, {
            status: response.status,
            body: text,
        });
    }

    if (payload && typeof payload.ok === 'boolean') {
        payload.status = response.status;
        if (! payload.ok && ! init.allowError) {
            throw apiError(payload, response.status);
        }

        return payload;
    }

    if (! response.ok) {
        throw cliError('http_error', 'The WordPress site returned an unexpected error response.', statusToExitCode(response.status), {
            status: response.status,
            body: payload,
        });
    }

    throw cliError('invalid_response', 'The WordPress site returned an unexpected response shape.', EXIT_SERVER, payload);
}

async function loadConfig() {
    try {
        const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        parsed.sites = parsed && typeof parsed.sites === 'object' && parsed.sites !== null ? parsed.sites : {};
        return parsed;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { sites: {} };
        }

        throw error;
    }
}

async function saveConfig(config) {
    await fsp.mkdir(CONFIG_DIR, { recursive: true });
    await fsp.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

async function saveSiteSession(site, tokenPayload) {
    const config = await loadConfig();
    config.sites[site] = {
        site_url: site,
        access_token: tokenPayload.access_token,
        refresh_token: tokenPayload.refresh_token,
        access_expires_at: Date.now() + tokenPayload.expires_in * 1000,
        session_id: tokenPayload.session_id,
        token_type: tokenPayload.token_type,
        user_display_name: tokenPayload.user_display_name,
    };
    await saveConfig(config);
}

function parseArgs(argv) {
    const positionals = [];
    const options = {};

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (! arg.startsWith('--')) {
            positionals.push(arg);
            continue;
        }

        const key = arg.slice(2);
        const next = argv[index + 1];
        const camelKey = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

        if (next && ! next.startsWith('--')) {
            if (options[camelKey] === undefined) {
                options[camelKey] = next;
            } else if (Array.isArray(options[camelKey])) {
                options[camelKey].push(next);
            } else {
                options[camelKey] = [options[camelKey], next];
            }
            index++;
            continue;
        }

        options[camelKey] = true;
    }

    return { positionals, options };
}

function printHelp() {
    const message = [
        'VibePresto CLI',
        '',
        'Commands:',
        '  vibepresto login --site <url> [--manual] [--no-open] [--json]',
        '  vibepresto login --site <url> --completion-code <code> [--device-code <code>] [--json]',
        '  vibepresto whoami --site <url> [--json]',
        '  vibepresto logout --site <url> [--revoke] [--json]',
        '  vibepresto pages list --site <url> [--status <status>] [--json]',
        '  vibepresto pages search --site <url> --query <text> [--json]',
        '  vibepresto pages create --site <url> --title <title> [--slug <slug>] [--status <status>] [--content <html>] [--json]',
        '  vibepresto pages set-status --site <url> --page-id <id> --status <status> [--json]',
        '  vibepresto pages set-homepage --site <url> --page-id <id> [--json]',
        '  vibepresto upload --site <url> --site-dir <dir> [--name <label>] [--page-id <id>] [--json]',
        '  vibepresto upload --site <url> --zip <file> [--name <label>] [--page-id <id>] [--json]',
        '  vibepresto upload --site <url> --html <file> [--css <file>] [--js <file>] [--asset <file> ...] [--name <label>] [--page-id <id>] [--json]',
    ].join('\n');

    process.stdout.write(message + '\n');
}

function emitSuccess(data, json) {
    if (json) {
        process.stdout.write(JSON.stringify({ ok: true, data }, null, 2) + '\n');
        return;
    }

    const verificationUrl = getVerificationUrl(data);
    if (verificationUrl) {
        process.stdout.write('Verification URL: ' + verificationUrl + '\n');
    }

    if (data.user_code) {
        process.stdout.write('User code: ' + data.user_code + '\n');
    }

    if (Array.isArray(data.items)) {
        process.stdout.write('Pages: ' + data.items.length + '\n');
        for (const item of data.items) {
            const status = item.status ? ' [' + item.status + ']' : '';
            const homepage = item.is_homepage ? ' (homepage)' : '';
            process.stdout.write('- ' + item.id + ': ' + item.title + status + homepage + '\n');
        }
    } else if (data.bundle_title) {
        process.stdout.write('Uploaded bundle: ' + data.bundle_title + '\n');
    } else if (data.page_title) {
        process.stdout.write('Page: ' + data.page_title + '\n');
    } else if (data.user_display_name) {
        process.stdout.write('Authorized as: ' + data.user_display_name + '\n');
    } else {
        process.stdout.write('Success\n');
    }

    if (data.auto_bundle) {
        process.stdout.write('Auto-bundled from local site directory.\n');
    }

    if (data.assigned_page_url) {
        process.stdout.write('Assigned page: ' + data.assigned_page_url + '\n');
    }

    if (data.page_status) {
        process.stdout.write('Page status: ' + data.page_status + '\n');
    }

    if (data.page_url) {
        process.stdout.write('Page URL: ' + data.page_url + '\n');
    }

    if (data.is_homepage) {
        process.stdout.write('This page is now the homepage.\n');
    }
}

function emitError(error, json) {
    const payload = {
        ok: false,
        error: {
            code: error.code || 'unknown_error',
            message: error.message || 'Unknown error.',
            details: error.details || {},
        },
    };

    if (json) {
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        return;
    }

    process.stderr.write(payload.error.message + '\n');
    if (payload.error.details && Object.keys(payload.error.details).length > 0) {
        process.stderr.write(JSON.stringify(payload.error.details, null, 2) + '\n');
    }
}

function apiError(response, statusOverride) {
    const error = response.error || {};
    return cliError(
        error.code || 'api_error',
        error.message || 'The WordPress API request failed.',
        statusToExitCode(statusOverride || response.status || 500),
        error.details || {}
    );
}

function cliError(code, message, exitCode, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.exitCode = exitCode;
    error.details = details;
    return error;
}

function exitCodeForError(error) {
    return Number(error.exitCode || EXIT_SERVER);
}

function statusToExitCode(status) {
    if (status === 400) {
        return EXIT_VALIDATION;
    }

    if (status === 401 || status === 403) {
        return EXIT_AUTH;
    }

    return EXIT_SERVER;
}

function stringOption(value, message) {
    if (! value || typeof value !== 'string') {
        throw cliError('usage_error', message, EXIT_USAGE);
    }

    return value;
}

function positiveIntOption(value, message) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (! Number.isInteger(parsed) || parsed < 1) {
        throw cliError('usage_error', message, EXIT_USAGE);
    }

    return parsed;
}

function arrayOption(value) {
    if (value === undefined) {
        return [];
    }

    return Array.isArray(value) ? value.map(String) : [String(value)];
}

function normalizeSiteUrl(value) {
    return String(value).replace(/\/+$/, '');
}

function sanitizeFileComponent(value) {
    return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'bundle';
}

function getVerificationUrl(data) {
    if (! data || typeof data !== 'object') {
        return '';
    }

    if (typeof data.verification_url_complete === 'string' && data.verification_url_complete) {
        return data.verification_url_complete;
    }

    if (typeof data.verification_url === 'string' && data.verification_url) {
        return data.verification_url;
    }

    return '';
}

async function fileBlob(filePath) {
    const absolutePath = path.resolve(String(filePath));
    const buffer = await fsp.readFile(absolutePath);
    return new Blob([buffer]);
}

function openBrowser(url) {
    const commands = process.platform === 'win32'
        ? [['cmd.exe', ['/c', 'start', '', url]]]
        : process.platform === 'darwin'
            ? [['open', [url]]]
            : [
                ['cmd.exe', ['/c', 'start', '', url]],
                ['xdg-open', [url]],
            ];

    for (const [command, args] of commands) {
        try {
            const child = spawn(command, args, { detached: true, stdio: 'ignore' });
            child.on('error', function () {
                // Best effort only.
            });
            child.unref();
            return;
        } catch (error) {
            // Try the next launcher.
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasJsonFlag(argv) {
    return argv.includes('--json');
}
