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
        scope: ['bundles:write', 'pages:read', 'pages:assign'],
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
    if (! json) {
        process.stderr.write('Open this URL and approve the CLI:\n');
        process.stderr.write(authorization.verification_url + '\n');
        process.stderr.write('User code: ' + authorization.user_code + '\n');
    }

    if (! options.noOpen) {
        openBrowser(authorization.verification_url);
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
            verification_url: authorization.verification_url,
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
    const site = client.site;
    const form = new FormData();
    const displayName = options.name ? String(options.name) : '';

    if (options.zip) {
        form.append('mode', 'zip');
        if (displayName) {
            form.append('display_name', displayName);
        }
        form.append('bundle_zip', await fileBlob(options.zip), path.basename(String(options.zip)));
    } else {
        const html = stringOption(options.html, 'Either `--zip` or `--html` is required for `upload`.');
        form.append('mode', 'separate');
        if (displayName) {
            form.append('display_name', displayName);
        }
        form.append('bundle_html', await fileBlob(html), path.basename(html));

        if (options.css) {
            form.append('bundle_css', await fileBlob(options.css), path.basename(String(options.css)));
        }

        if (options.js) {
            form.append('bundle_js', await fileBlob(options.js), path.basename(String(options.js)));
        }

        const assets = arrayOption(options.asset);
        for (const asset of assets) {
            form.append('bundle_assets[]', await fileBlob(asset), path.basename(asset));
        }
    }

    if (options.pageId) {
        form.append('assign_page_id', String(options.pageId));
    }

    const response = await client.request('/bundles', {
        method: 'POST',
        body: form,
    });

    return {
        ok: true,
        data: {
            site_url: site,
            ...response.data,
        },
    };
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
        '  vibepresto pages search --site <url> --query <text> [--json]',
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

    if (data.verification_url) {
        process.stdout.write('Verification URL: ' + data.verification_url + '\n');
    }

    if (data.user_code) {
        process.stdout.write('User code: ' + data.user_code + '\n');
    }

    if (data.bundle_title) {
        process.stdout.write('Uploaded bundle: ' + data.bundle_title + '\n');
    } else if (data.user_display_name) {
        process.stdout.write('Authorized as: ' + data.user_display_name + '\n');
    } else {
        process.stdout.write('Success\n');
    }

    if (data.assigned_page_url) {
        process.stdout.write('Assigned page: ' + data.assigned_page_url + '\n');
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

function arrayOption(value) {
    if (value === undefined) {
        return [];
    }

    return Array.isArray(value) ? value.map(String) : [String(value)];
}

function normalizeSiteUrl(value) {
    return String(value).replace(/\/+$/, '');
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
