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

    if (command === 'detect') {
        const projectDir = path.resolve(stringOption(options.projectDir, '--project-dir is required for `detect`.'));
        const detection = await detectProject(projectDir, options);
        emitSuccess(detection, json);
        return;
    }

    if (command === 'build') {
        const projectDir = path.resolve(stringOption(options.projectDir, '--project-dir is required for `build`.'));
        const result = await buildProject(projectDir, options);
        emitSuccess(result, json);
        return;
    }

    if (command === 'verify') {
        const outputDir = path.resolve(stringOption(options.outputDir, '--output-dir is required for `verify`.'));
        const routeManifest = await loadRouteManifestOption(options.routeManifest);
        const verification = await verifyOutputDirectory(outputDir, {
            routeManifest,
            framework: typeof options.framework === 'string' ? options.framework : '',
        });
        emitSuccess(verification, json);
        return;
    }

    if (command === 'routes' && subcommand === 'inspect') {
        const result = await inspectRoutes(options);
        emitSuccess(result, json);
        return;
    }

    if (command === 'deploy') {
        const result = await deployProject(options);
        emitSuccess(result, json);
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

    if (command === 'bundles' && subcommand === 'list') {
        const client = await createAuthenticatedClient(options);
        const response = await client.request('/bundles');
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'bundles' && subcommand === 'versions') {
        const client = await createAuthenticatedClient(options);
        const bundleId = positiveIntOption(options.bundleId, '--bundle-id is required for `bundles versions`.');
        const response = await client.request('/bundles/' + bundleId + '/versions');
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'bundles' && subcommand === 'rollback') {
        const client = await createAuthenticatedClient(options);
        const response = await rollbackBundle(client, options);
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'deployments' && subcommand === 'list') {
        const client = await createAuthenticatedClient(options);
        const response = await client.request('/deployments');
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'deployments' && subcommand === 'show') {
        const client = await createAuthenticatedClient(options);
        const deploymentId = positiveIntOption(options.deploymentId, '--deployment-id is required for `deployments show`.');
        const response = await client.request('/deployments/' + deploymentId);
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'deployments' && subcommand === 'promote') {
        const client = await createAuthenticatedClient(options);
        const deploymentId = positiveIntOption(options.deploymentId, '--deployment-id is required for `deployments promote`.');
        const bundleVersionId = positiveIntOption(options.bundleVersionId, '--bundle-version-id is required for `deployments promote`.');
        const response = await client.request('/deployments/' + deploymentId + '/promote', {
            method: 'POST',
            json: {
                bundle_version_id: bundleVersionId,
            },
        });
        emitSuccess(response.data, json);
        return;
    }

    if (command === 'deployments' && subcommand === 'rollback') {
        const client = await createAuthenticatedClient(options);
        const deploymentId = positiveIntOption(options.deploymentId, '--deployment-id is required for `deployments rollback`.');
        const bundleVersionId = options.bundleVersionId ? positiveIntOption(options.bundleVersionId, '--bundle-version-id must be a positive integer.') : 0;
        const versionNumber = options.version ? positiveIntOption(options.version, '--version must be a positive integer.') : 0;

        if (! bundleVersionId && ! versionNumber) {
            throw cliError('usage_error', 'Provide either --bundle-version-id or --version for `deployments rollback`.', EXIT_USAGE);
        }

        const response = await client.request('/deployments/' + deploymentId + '/rollback', {
            method: 'POST',
            json: {
                bundle_version_id: bundleVersionId || undefined,
                version_number: versionNumber || undefined,
            },
        });
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

async function uploadBundle(client, options) {
    const input = await resolveUploadInput(options);
    const form = new FormData();
    const displayName = options.name ? String(options.name) : '';
    const routeManifest = await loadRouteManifestForUpload(options, input);
    const buildMetadata = await loadBuildMetadataOption(options.buildMetadata);

    form.append('mode', input.mode);
    if (displayName) {
        form.append('display_name', displayName);
    }

    if (options.bundleKind) {
        form.append('bundle_kind', String(options.bundleKind));
    }

    if (routeManifest.length > 0) {
        form.append('route_manifest', JSON.stringify(routeManifest));
    }

    if (Object.keys(buildMetadata).length > 0) {
        form.append('build_metadata', JSON.stringify(buildMetadata));
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

async function rollbackBundle(client, options) {
    const pageId = positiveIntOption(options.pageId, '--page-id is required for `bundles rollback`.');
    const bundleVersionId = options.bundleVersionId ? positiveIntOption(options.bundleVersionId, '--bundle-version-id must be a positive integer.') : 0;
    const versionNumber = options.version ? positiveIntOption(options.version, '--version must be a positive integer.') : 0;

    if (! bundleVersionId && ! versionNumber) {
        throw cliError('usage_error', 'Provide either --bundle-version-id or --version for `bundles rollback`.', EXIT_USAGE);
    }

    return await client.request('/pages/' + pageId + '/bundle-rollback', {
        method: 'POST',
        json: {
            bundle_version_id: bundleVersionId || undefined,
            version_number: versionNumber || undefined,
        },
    });
}

async function inspectRoutes(options) {
    const projectDir = options.projectDir ? path.resolve(String(options.projectDir)) : '';
    const outputDir = options.outputDir ? path.resolve(String(options.outputDir)) : '';
    const routeManifest = await loadRouteManifestOption(options.routeManifest);
    const routeMode = routeModeOption(options.routeMode);
    let detection = null;
    let resolvedOutputDir = outputDir;

    if (projectDir) {
        detection = await detectProject(projectDir, options);
        if (! resolvedOutputDir) {
            resolvedOutputDir = await findOutputDir(projectDir, detection.outputDirCandidates, false);
        }
    }

    if (! resolvedOutputDir) {
        throw cliError('usage_error', 'Provide `--project-dir` or `--output-dir` for `routes inspect`.', EXIT_USAGE);
    }

    const inspected = await inspectRouteManifest(resolvedOutputDir, {
        routeManifest,
        routeMode,
        framework: detection ? detection.framework : '',
    });

    emitValidationSummary(inspected.verification);
    return {
        project_dir: projectDir || null,
        output_dir: resolvedOutputDir,
        framework: detection ? detection.framework : '',
        route_manifest: inspected.routeManifest,
        bundle_kind: inspected.bundleKind,
        route_count: inspected.routeManifest.length,
        verification: inspected.verification,
    };
}

async function deployProject(options) {
    const client = await createAuthenticatedClient(options);
    const dryRun = Boolean(options.dryRun);
    const createMissingPages = options.noCreateMissingPages ? false : Boolean(options.createMissingPages);
    const pageStatus = allowedPageStatus(options.pageStatus || 'draft');
    const homepageRoute = typeof options.homepageRoute === 'string' ? normalizeRoutePath(options.homepageRoute) : '';
    const pagePrefix = typeof options.pagePrefix === 'string' ? sanitizeFileComponent(options.pagePrefix) : '';
    const titleStrategy = pageTitleStrategyOption(options.pageTitleStrategy);
    const routeMode = routeModeOption(options.routeMode);

    let projectDir = options.projectDir ? path.resolve(String(options.projectDir)) : '';
    let outputDir = options.outputDir ? path.resolve(String(options.outputDir)) : '';
    let buildResult = null;
    let detection = null;

    if (! projectDir && ! outputDir) {
        throw cliError('usage_error', 'Provide either `--project-dir` or `--output-dir` for `deploy`.', EXIT_USAGE);
    }

    if (projectDir) {
        detection = await detectProject(projectDir, options);
        buildResult = await buildProject(projectDir, options, detection);
        outputDir = buildResult.output_dir;
    } else {
        detection = {
            framework: typeof options.framework === 'string' ? options.framework : 'prebuilt-static',
            builder: 'prebuilt',
            buildCommand: '',
            packageManager: '',
            outputDirCandidates: [outputDir],
            staticCapable: true,
            projectDir: null,
        };
    }

    const routeManifestOption = await loadRouteManifestOption(options.routeManifest);
    const inspected = await inspectRouteManifest(outputDir, {
        routeManifest: routeManifestOption,
        routeMode,
        framework: detection.framework,
    });

    const routeItems = inspected.routeManifest.map((item) => ({
        route_path: item.route_path,
        target_slug: applyPagePrefix(pagePrefix, item.target_slug),
        target_path: applyPagePrefix(pagePrefix, item.target_path),
        page_title: item.page_title || derivePageTitle(item, titleStrategy, pagePrefix),
        entry_html: item.entry_html,
        route_type: item.route_type,
        is_homepage: homepageRoute ? item.route_path === homepageRoute : Boolean(item.is_homepage),
    }));

    const resolveResponse = await client.request('/pages/batch-resolve', {
        method: 'POST',
        json: {
            items: routeItems,
        },
    });

    const missing = resolveResponse.data.items.filter((item) => ! item.matched);
    const existing = resolveResponse.data.items.filter((item) => item.matched);

    if (dryRun) {
        return {
            dry_run: true,
            site_url: client.site,
            project_dir: projectDir || null,
            output_dir: outputDir,
            framework: detection.framework,
            builder: detection.builder,
            build: buildResult,
            verification: inspected.verification,
            bundle_kind: inspected.bundleKind,
            route_manifest: inspected.routeManifest,
            existing_pages: existing,
            missing_pages: missing,
            create_missing_pages: createMissingPages,
        };
    }

    let createdItems = [];
    if (missing.length > 0 && createMissingPages) {
        const createResponse = await client.request('/pages/batch-create', {
            method: 'POST',
            json: {
                items: missing.map((item) => ({
                    route_path: item.route_path,
                    target_slug: item.target_slug,
                    title: item.target_slug ? derivePageTitle(item, titleStrategy, pagePrefix) : item.route_path,
                    status: pageStatus,
                })),
            },
        });

        createdItems = createResponse.data.items;
    }

    if (missing.length > 0 && ! createMissingPages) {
        throw cliError(
            'missing_pages',
            'Some deployment routes do not have matching WordPress pages. Re-run with `--create-missing-pages` or create them first.',
            EXIT_VALIDATION,
            { missing_pages: missing }
        );
    }

    const pageMap = new Map();
    for (const item of existing) {
        if (item.page && item.page.page_id) {
            pageMap.set(item.route_path, item.page);
        }
    }
    for (const item of createdItems) {
        if (item.page && item.page.page_id) {
            pageMap.set(item.route_path, item.page);
        }
    }

    const uploadInput = await prepareOutputDirectoryUpload(outputDir);
    const buildMetadata = {
        framework: detection.framework,
        builder: detection.builder,
        package_manager: detection.packageManager,
        build_command: buildResult ? buildResult.build_command : '',
        output_dir: path.relative(process.cwd(), outputDir) || outputDir,
        verification: inspected.verification,
    };

    const uploadOptions = {
        zip: uploadInput.zipPath,
        name: String(options.name || path.basename(projectDir || outputDir)),
        bundleKind: inspected.bundleKind,
        routeManifest: JSON.stringify(inspected.routeManifest),
        buildMetadata: JSON.stringify(buildMetadata),
    };

    try {
        const uploadResponse = await uploadBundle(client, uploadOptions);
        const bundleVersionId = uploadResponse.data.bundle_version_id;
        const targets = routeItems.map((item) => {
            const page = pageMap.get(item.route_path);
            if (! page || ! page.page_id) {
                throw cliError('missing_pages', 'A deployment route is missing a resolved WordPress page after creation.', EXIT_SERVER, { route_path: item.route_path });
            }

            return {
                page_id: page.page_id,
                route_path: item.route_path,
                target_slug: item.target_slug,
                target_path: item.target_path,
                entry_html: item.entry_html,
                route_type: item.route_type,
                is_homepage: item.is_homepage,
            };
        });

        const deploymentResponse = await client.request('/deployments', {
            method: 'POST',
            json: {
                bundle_version_id: bundleVersionId,
                title: String(options.name || path.basename(projectDir || outputDir)),
                homepage_route: homepageRoute || undefined,
                targets,
            },
        });

        return {
            site_url: client.site,
            project_dir: projectDir || null,
            output_dir: outputDir,
            framework: detection.framework,
            builder: detection.builder,
            build: buildResult,
            verification: inspected.verification,
            bundle_kind: inspected.bundleKind,
            route_manifest: inspected.routeManifest,
            created_pages: createdItems,
            upload: uploadResponse.data,
            deployment: deploymentResponse.data,
        };
    } finally {
        if (uploadInput.cleanup) {
            await uploadInput.cleanup();
        }
    }
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

    const verification = await verifyOutputDirectory(rootDir, { framework: 'static-site-dir' });
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
        verifiedLocalFiles: verification.verified_files,
        cleanup: async function () {
            await cleanupPath(tempDir);
        },
    };
}

async function prepareOutputDirectoryUpload(outputDir) {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vibepresto-build-'));
    const zipPath = path.join(tempDir, sanitizeFileComponent(path.basename(outputDir) || 'site') + '.zip');
    await zipDirectory(outputDir, zipPath);
    return {
        zipPath,
        cleanup: async function () {
            await cleanupPath(tempDir);
        },
    };
}

async function detectProject(projectDir, options = {}) {
    const packageJsonPath = path.join(projectDir, 'package.json');
    const packageJson = await readJsonIfExists(packageJsonPath);
    const deps = Object.assign({}, packageJson ? packageJson.dependencies : {}, packageJson ? packageJson.devDependencies : {});
    const files = await filePresenceMap(projectDir, [
        'next.config.js',
        'next.config.mjs',
        'nuxt.config.js',
        'nuxt.config.ts',
        'svelte.config.js',
        'vite.config.js',
        'vite.config.ts',
        'tanstack.config.js',
        'tanstack.config.ts',
    ]);

    let framework = 'static-site';
    let outputDirCandidates = [];
    let staticCapable = true;

    if (files['next.config.js'] || files['next.config.mjs'] || deps.next) {
        framework = 'nextjs-static';
        outputDirCandidates = ['out', 'dist'];
    } else if (files['nuxt.config.js'] || files['nuxt.config.ts'] || deps.nuxt) {
        framework = 'nuxt-static';
        outputDirCandidates = ['dist', '.output/public'];
    } else if (files['svelte.config.js'] || deps['@sveltejs/kit']) {
        framework = deps['@sveltejs/kit'] ? 'sveltekit-static' : 'svelte-static';
        outputDirCandidates = ['build', 'dist'];
    } else if (deps['@tanstack/start'] || deps['@tanstack/react-start'] || files['tanstack.config.js'] || files['tanstack.config.ts']) {
        framework = 'tanstack-static';
        outputDirCandidates = ['dist'];
    } else if (files['vite.config.js'] || files['vite.config.ts'] || deps.vite) {
        framework = deps.react ? 'react-vite' : 'vite-static';
        outputDirCandidates = ['dist'];
    } else if (deps.react) {
        framework = 'react-static';
        outputDirCandidates = ['dist', 'build'];
    } else if (await pathExists(path.join(projectDir, 'index.html'))) {
        framework = 'static-site';
        outputDirCandidates = ['.'];
    } else {
        framework = 'generic-static-build';
        outputDirCandidates = ['dist', 'build', 'out'];
    }

    const packageManager = detectPackageManager(projectDir);
    const buildCommand = typeof options.buildCommand === 'string' && options.buildCommand
        ? String(options.buildCommand)
        : detectBuildCommand(packageJson, packageManager);

    return {
        framework,
        builder: framework,
        projectDir,
        packageManager,
        buildCommand,
        outputDirCandidates,
        staticCapable,
    };
}

async function buildProject(projectDir, options = {}, providedDetection = null) {
    const detection = providedDetection || await detectProject(projectDir, options);
    if (! detection.staticCapable) {
        throw cliError('unsupported_framework', 'This project is not detected as a static-export-capable frontend build.', EXIT_VALIDATION, { framework: detection.framework });
    }

    if (detection.framework === 'static-site' && detection.outputDirCandidates[0] === '.') {
        const verification = await verifyOutputDirectory(projectDir, { framework: detection.framework });
        return {
            project_dir: projectDir,
            output_dir: projectDir,
            framework: detection.framework,
            builder: detection.builder,
            package_manager: detection.packageManager,
            build_command: '',
            command_output: { stdout: '', stderr: '', code: 0 },
            verification,
        };
    }

    const buildCommand = typeof options.buildCommand === 'string' && options.buildCommand
        ? String(options.buildCommand)
        : detection.buildCommand;

    if (! buildCommand) {
        throw cliError('missing_build_command', 'No build command could be determined. Pass `--build-command`.', EXIT_USAGE);
    }

    const result = await runShellCommand(buildCommand, { cwd: projectDir });
    if (result.code !== 0) {
        throw cliError('build_failed', 'The local build command failed.', EXIT_SERVER, {
            command: buildCommand,
            stdout: result.stdout.trim(),
            stderr: result.stderr.trim(),
        });
    }

    const outputDir = options.outputDir
        ? path.resolve(String(options.outputDir))
        : await findOutputDir(projectDir, detection.outputDirCandidates, true);

    const verification = await verifyOutputDirectory(outputDir, { framework: detection.framework });
    return {
        project_dir: projectDir,
        output_dir: outputDir,
        framework: detection.framework,
        builder: detection.builder,
        package_manager: detection.packageManager,
        build_command: buildCommand,
        command_output: result,
        verification,
    };
}

async function findOutputDir(projectDir, candidates, required) {
    for (const candidate of candidates) {
        const resolved = candidate === '.'
            ? projectDir
            : path.resolve(projectDir, candidate);

        if (await isDirectory(resolved)) {
            return resolved;
        }
    }

    if (required) {
        throw cliError('missing_output_dir', 'The build finished but no supported static output directory was found.', EXIT_VALIDATION, {
            project_dir: projectDir,
            candidates,
        });
    }

    return '';
}

async function inspectRouteManifest(outputDir, options = {}) {
    const verification = await verifyOutputDirectory(outputDir, {
        routeManifest: options.routeManifest,
        framework: options.framework || '',
    });

    const routeManifest = options.routeManifest && options.routeManifest.length > 0
        ? normalizeRouteManifest(options.routeManifest, options.routeMode, options.framework)
        : inferRouteManifestFromHtml(verification.html_files, outputDir, options.routeMode, options.framework);

    const bundleKind = determineBundleKind(routeManifest, options.routeMode, options.framework);
    return {
        routeManifest,
        bundleKind,
        verification,
    };
}

async function verifyOutputDirectory(outputDir, options = {}) {
    const rootDir = path.resolve(outputDir);
    if (! await isDirectory(rootDir)) {
        throw cliError('missing_output_dir', 'The output directory does not exist.', EXIT_VALIDATION, { path: rootDir });
    }

    const files = await walkFiles(rootDir);
    const htmlFiles = files.filter((file) => file.toLowerCase().endsWith('.html'));
    if (htmlFiles.length === 0) {
        throw cliError('missing_html_output', 'The output directory does not contain any HTML files.', EXIT_VALIDATION, { path: rootDir });
    }

    const verified = [];
    for (const relativePath of htmlFiles) {
        const absolutePath = path.join(rootDir, relativePath);
        const html = await fsp.readFile(absolutePath, 'utf8');
        const htmlReferences = extractLocalAssetReferences(html);
        verified.push(absolutePath);

        for (const reference of htmlReferences) {
            const resolved = resolveLocalReference(path.dirname(absolutePath), reference, rootDir);
            if (resolved === null) {
                throw cliError('unsupported_local_layout', 'The built site contains a local reference that escapes the bundle root.', EXIT_VALIDATION, {
                    reference,
                    html_file: relativePath,
                });
            }

            await ensureReadableFile(resolved, 'A referenced local asset is missing from the output directory.', 'missing_local_asset', {
                reference,
                resolved_path: resolved,
                html_file: relativePath,
            });
            verified.push(resolved);

            if (resolved.toLowerCase().endsWith('.css')) {
                const css = await fsp.readFile(resolved, 'utf8');
                const cssReferences = extractCssAssetReferences(css);
                for (const cssReference of cssReferences) {
                    const cssResolved = resolveLocalReference(path.dirname(resolved), cssReference, rootDir);
                    if (cssResolved === null) {
                        throw cliError('unsupported_local_layout', 'A CSS asset reference escapes the bundle root.', EXIT_VALIDATION, {
                            reference: cssReference,
                            css_file: path.relative(rootDir, resolved),
                        });
                    }

                    await ensureReadableFile(cssResolved, 'A referenced CSS asset is missing from the output directory.', 'missing_local_asset', {
                        reference: cssReference,
                        resolved_path: cssResolved,
                    });
                    verified.push(cssResolved);
                }
            }
        }
    }

    if (options.routeManifest && options.routeManifest.length > 0) {
        for (const route of options.routeManifest) {
            const entryHtml = typeof route.entry_html === 'string' ? route.entry_html : '';
            if (! entryHtml) {
                throw cliError('invalid_route_manifest', 'Each route manifest entry must include `entry_html`.', EXIT_VALIDATION);
            }

            const resolved = path.resolve(rootDir, entryHtml);
            if (! resolved.startsWith(rootDir)) {
                throw cliError('invalid_route_manifest', 'A route manifest entry escapes the output root.', EXIT_VALIDATION, {
                    entry_html: entryHtml,
                });
            }

            await ensureReadableFile(resolved, 'A route manifest entry points to a missing HTML file.', 'invalid_route_manifest', {
                entry_html: entryHtml,
            });
        }
    }

    return {
        ok: true,
        framework: options.framework || '',
        output_dir: rootDir,
        html_files: htmlFiles,
        total_files: files.length,
        verified_files: Array.from(new Set(verified.map((item) => path.resolve(item)))),
    };
}

function inferRouteManifestFromHtml(htmlFiles, outputDir, routeMode, framework) {
    const normalizedHtml = htmlFiles.map((file) => file.replace(/\\/g, '/'));
    if (routeMode === 'spa') {
        const entryHtml = normalizedHtml.includes('index.html') ? 'index.html' : normalizedHtml[0];
        return [{
            route_path: '/',
            target_slug: 'home',
            target_path: '',
            entry_html: entryHtml,
            route_type: 'spa-fallback',
            is_homepage: true,
        }];
    }

    if (routeMode === 'auto' && normalizedHtml.length === 1 && framework && framework !== 'static-site') {
        return [{
            route_path: '/',
            target_slug: 'home',
            target_path: '',
            entry_html: normalizedHtml[0],
            route_type: 'spa-fallback',
            is_homepage: true,
        }];
    }

    return normalizedHtml.sort().map((relativePath) => {
        const routePath = routePathForHtml(relativePath);
        return {
            route_path: routePath,
            target_slug: slugForRoute(routePath),
            target_path: routePath === '/' ? '' : routePath.slice(1),
            entry_html: relativePath,
            route_type: 'entry',
            is_homepage: routePath === '/',
        };
    });
}

function routePathForHtml(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    if (normalized === 'index.html') {
        return '/';
    }

    if (normalized.endsWith('/index.html')) {
        return '/' + normalized.slice(0, -'/index.html'.length);
    }

    return '/' + normalized.replace(/\.html?$/i, '');
}

function determineBundleKind(routeManifest, routeMode, framework) {
    if (routeMode === 'spa') {
        return 'spa';
    }

    if (routeManifest.some((item) => item.route_type === 'spa-fallback')) {
        return 'spa';
    }

    if (routeManifest.length > 1) {
        return 'multi-entry';
    }

    if (framework && framework !== 'static-site' && routeMode === 'auto') {
        return routeManifest[0] && routeManifest[0].route_type === 'spa-fallback' ? 'spa' : 'single-entry';
    }

    return 'single-entry';
}

async function loadRouteManifestForUpload(options, input) {
    const fromOption = await loadRouteManifestOption(options.routeManifest);
    if (fromOption.length > 0) {
        return normalizeRouteManifest(fromOption, routeModeOption(options.routeMode), '');
    }

    if (input.mode === 'zip' && options.bundleKind) {
        return [];
    }

    return [];
}

async function loadRouteManifestOption(routeManifestOption) {
    if (! routeManifestOption) {
        return [];
    }

    const candidate = String(routeManifestOption);
    if (candidate.trim().startsWith('[')) {
        const parsed = JSON.parse(candidate);
        return Array.isArray(parsed) ? parsed : [];
    }

    const manifestPath = path.resolve(candidate);
    const raw = await fsp.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (! Array.isArray(parsed)) {
        throw cliError('invalid_route_manifest', 'Route manifest files must contain a JSON array.', EXIT_VALIDATION, {
            path: manifestPath,
        });
    }

    return parsed;
}

async function loadBuildMetadataOption(buildMetadataOption) {
    if (! buildMetadataOption) {
        return {};
    }

    const candidate = String(buildMetadataOption);
    if (candidate.trim().startsWith('{')) {
        const parsed = JSON.parse(candidate);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }

    const metadataPath = path.resolve(candidate);
    const raw = await fsp.readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function normalizeRouteManifest(routeManifest, routeMode, framework) {
    const normalized = routeManifest
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
            const routePath = normalizeRoutePath(item.route_path || '/');
            const routeType = routeMode === 'spa'
                ? 'spa-fallback'
                : (item.route_type === 'spa-fallback' ? 'spa-fallback' : 'entry');

            return {
                route_path: routePath,
                target_slug: sanitizeFileComponent(item.target_slug || slugForRoute(routePath)),
                target_path: String(item.target_path || (routePath === '/' ? '' : routePath.slice(1))),
                entry_html: String(item.entry_html || 'index.html').replace(/\\/g, '/'),
                route_type: routeType,
                is_homepage: item.is_homepage === true || routePath === '/',
                page_title: typeof item.page_title === 'string' ? item.page_title : '',
            };
        });

    if (normalized.length === 1 && routeMode === 'auto' && framework && framework !== 'static-site') {
        normalized[0].route_type = normalized[0].route_type || 'spa-fallback';
    }

    return normalized;
}

async function walkFiles(rootDir) {
    const result = [];

    async function visit(currentDir, prefix) {
        const entries = await fsp.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(currentDir, entry.name);
            const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
            if (entry.isDirectory()) {
                await visit(absolutePath, relativePath);
                continue;
            }

            result.push(relativePath.replace(/\\/g, '/'));
        }
    }

    await visit(rootDir, '');
    return result;
}

function extractLocalAssetReferences(html) {
    const references = new Set();
    const attributePattern = /\b(?:href|src|action|poster)\s*=\s*(["'])([^"']+)\1/gi;
    const sourceSetPattern = /\bsrcset\s*=\s*(["'])([^"']+)\1/gi;
    let match;

    while ((match = attributePattern.exec(html)) !== null) {
        const candidate = String(match[2] || '').trim();
        if (isBundledLocalReference(candidate)) {
            references.add(stripQueryAndHash(candidate));
        }
    }

    while ((match = sourceSetPattern.exec(html)) !== null) {
        const parts = String(match[2] || '').split(',');
        for (const part of parts) {
            const candidate = part.trim().split(/\s+/)[0] || '';
            if (isBundledLocalReference(candidate)) {
                references.add(stripQueryAndHash(candidate));
            }
        }
    }

    return Array.from(references);
}

function extractCssAssetReferences(css) {
    const references = new Set();
    const pattern = /url\(([^)]+)\)/gi;
    let match;

    while ((match = pattern.exec(css)) !== null) {
        const raw = String(match[1] || '').trim().replace(/^["']|["']$/g, '');
        if (isBundledLocalReference(raw)) {
            references.add(stripQueryAndHash(raw));
        }
    }

    return Array.from(references);
}

function isBundledLocalReference(reference) {
    if (! reference) {
        return false;
    }

    if (reference.startsWith('#') || reference.startsWith('data:') || reference.startsWith('mailto:') || reference.startsWith('tel:')) {
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

function resolveLocalReference(baseDir, reference, rootDir) {
    const normalized = reference.replace(/\\/g, '/');

    if (normalized.startsWith('/')) {
        return null;
    }

    const resolved = path.resolve(baseDir, normalized);
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
            shell: Boolean(options.shell),
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

async function runShellCommand(command, options = {}) {
    return await runProcess(command, [], {
        cwd: options.cwd,
        shell: true,
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
        '  vibepresto detect --project-dir <dir> [--json]',
        '  vibepresto build --project-dir <dir> [--build-command <cmd>] [--output-dir <dir>] [--json]',
        '  vibepresto verify --output-dir <dir> [--route-manifest <file-or-json>] [--json]',
        '  vibepresto routes inspect (--project-dir <dir> | --output-dir <dir>) [--route-mode <auto|manifest|spa>] [--route-manifest <file-or-json>] [--json]',
        '  vibepresto deploy (--project-dir <dir> | --output-dir <dir>) --site <url> [--name <label>] [--route-mode <auto|manifest|spa>] [--create-missing-pages] [--no-create-missing-pages] [--page-status <status>] [--page-title-strategy <from-manifest|from-route|explicit-prefix>] [--page-prefix <slug-prefix>] [--homepage-route <route>] [--dry-run] [--json]',
        '  vibepresto pages list --site <url> [--status <status>] [--json]',
        '  vibepresto pages search --site <url> --query <text> [--json]',
        '  vibepresto pages create --site <url> --title <title> [--slug <slug>] [--status <status>] [--content <html>] [--json]',
        '  vibepresto pages set-status --site <url> --page-id <id> --status <status> [--json]',
        '  vibepresto pages set-homepage --site <url> --page-id <id> [--json]',
        '  vibepresto bundles list --site <url> [--json]',
        '  vibepresto bundles versions --site <url> --bundle-id <id> [--json]',
        '  vibepresto bundles rollback --site <url> --page-id <id> (--version <n> | --bundle-version-id <id>) [--json]',
        '  vibepresto upload --site <url> --site-dir <dir> [--name <label>] [--page-id <id>] [--route-manifest <file-or-json>] [--bundle-kind <single-entry|multi-entry|spa>] [--json]',
        '  vibepresto upload --site <url> --zip <file> [--name <label>] [--route-manifest <file-or-json>] [--bundle-kind <single-entry|multi-entry|spa>] [--json]',
        '  vibepresto upload --site <url> --html <file> [--css <file>] [--js <file>] [--asset <file> ...] [--name <label>] [--page-id <id>] [--json]',
        '  vibepresto deployments list --site <url> [--json]',
        '  vibepresto deployments show --site <url> --deployment-id <id> [--json]',
        '  vibepresto deployments promote --site <url> --deployment-id <id> --bundle-version-id <id> [--json]',
        '  vibepresto deployments rollback --site <url> --deployment-id <id> (--version <n> | --bundle-version-id <id>) [--json]',
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

    if (Array.isArray(data.items) && data.items.length > 0 && Object.prototype.hasOwnProperty.call(data.items[0], 'slug')) {
        process.stdout.write('Pages: ' + data.items.length + '\n');
        for (const item of data.items) {
            const status = item.status ? ' [' + item.status + ']' : '';
            const homepage = item.is_homepage ? ' (homepage)' : '';
            process.stdout.write('- ' + item.id + ': ' + item.title + status + homepage + '\n');
        }
        return;
    }

    if (Array.isArray(data.items) && data.items.length > 0 && Object.prototype.hasOwnProperty.call(data.items[0], 'bundle_version_id') && Object.prototype.hasOwnProperty.call(data.items[0], 'deployment_id')) {
        process.stdout.write('Deployments: ' + data.items.length + '\n');
        for (const item of data.items) {
            process.stdout.write('- ' + item.deployment_id + ': ' + item.title + ' (' + item.targets.length + ' targets)\n');
        }
        return;
    }

    if (Array.isArray(data.items) && data.items.length > 0 && Object.prototype.hasOwnProperty.call(data.items[0], 'bundle_version_id') && ! Object.prototype.hasOwnProperty.call(data.items[0], 'version_count')) {
        process.stdout.write('Bundle versions: ' + data.items.length + '\n');
        for (const item of data.items) {
            const current = item.is_current ? ' (current)' : '';
            process.stdout.write('- ' + item.bundle_version_id + ': ' + item.bundle_version_label + current + '\n');
        }
        return;
    }

    if (Array.isArray(data.items) && data.items.length > 0 && Object.prototype.hasOwnProperty.call(data.items[0], 'lineage_id')) {
        process.stdout.write('Bundles: ' + data.items.length + '\n');
        for (const item of data.items) {
            const version = item.bundle_version_number ? ' v' + item.bundle_version_number : '';
            const count = item.version_count ? ' (' + item.version_count + ' versions)' : '';
            process.stdout.write('- ' + item.lineage_id + ': ' + item.bundle_title + version + count + '\n');
        }
        return;
    }

    if (data.deployment && data.deployment.deployment_id) {
        process.stdout.write('Deployment: ' + data.deployment.title + '\n');
        process.stdout.write('Targets: ' + data.deployment.targets.length + '\n');
        return;
    }

    if (data.deployment_id && Array.isArray(data.targets)) {
        process.stdout.write('Deployment: ' + data.title + '\n');
        process.stdout.write('Targets: ' + data.targets.length + '\n');
        return;
    }

    if (data.route_manifest && data.output_dir) {
        process.stdout.write('Route manifest: ' + data.route_manifest.length + ' routes\n');
        process.stdout.write('Output directory: ' + data.output_dir + '\n');
        return;
    }

    if (data.output_dir && Object.prototype.hasOwnProperty.call(data, 'verification')) {
        process.stdout.write('Build complete for ' + (data.framework || 'project') + '\n');
        process.stdout.write('Output directory: ' + data.output_dir + '\n');
        return;
    }

    if (data.framework && Object.prototype.hasOwnProperty.call(data, 'buildCommand')) {
        process.stdout.write('Detected framework: ' + data.framework + '\n');
        process.stdout.write('Build command: ' + (data.buildCommand || '(none)') + '\n');
        return;
    }

    if (data.bundle_title) {
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

    if (data.bundle_kind) {
        process.stdout.write('Bundle kind: ' + data.bundle_kind + '\n');
    }

    if (Array.isArray(data.route_manifest) && data.route_manifest.length > 0) {
        process.stdout.write('Routes: ' + data.route_manifest.length + '\n');
    }

    if (data.assigned_page_url) {
        process.stdout.write('Assigned page: ' + data.assigned_page_url + '\n');
    }

    if (data.bundle_version_label) {
        process.stdout.write('Bundle version: ' + data.bundle_version_label + '\n');
    }

    if (data.bundle_version_number) {
        process.stdout.write('Version number: ' + data.bundle_version_number + '\n');
    }

    if (data.lineage_name) {
        process.stdout.write('Bundle lineage: ' + data.lineage_name + '\n');
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
    return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'bundle';
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
        ? [['cmd.exe', ['/c', 'start', '""', '"' + url.replace(/"/g, '\\"') + '"']]]
        : process.platform === 'darwin'
            ? [['open', [url]]]
            : [
                ['xdg-open', [url]],
                ['open', [url]],
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

async function readJsonIfExists(filePath) {
    try {
        const raw = await fsp.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

async function filePresenceMap(rootDir, files) {
    const result = {};
    for (const file of files) {
        result[file] = await pathExists(path.join(rootDir, file));
    }
    return result;
}

async function pathExists(targetPath) {
    try {
        await fsp.access(targetPath);
        return true;
    } catch (error) {
        return false;
    }
}

async function isDirectory(targetPath) {
    try {
        const stat = await fsp.stat(targetPath);
        return stat.isDirectory();
    } catch (error) {
        return false;
    }
}

function detectPackageManager(projectDir) {
    if (require('node:fs').existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (require('node:fs').existsSync(path.join(projectDir, 'yarn.lock'))) {
        return 'yarn';
    }
    if (require('node:fs').existsSync(path.join(projectDir, 'bun.lockb')) || require('node:fs').existsSync(path.join(projectDir, 'bun.lock'))) {
        return 'bun';
    }
    return 'npm';
}

function detectBuildCommand(packageJson, packageManager) {
    if (! packageJson || ! packageJson.scripts || ! packageJson.scripts.build) {
        return '';
    }

    if (packageManager === 'pnpm') {
        return 'pnpm build';
    }
    if (packageManager === 'yarn') {
        return 'yarn build';
    }
    if (packageManager === 'bun') {
        return 'bun run build';
    }
    return 'npm run build';
}

function routeModeOption(value) {
    const normalized = typeof value === 'string' ? value : 'auto';
    if (normalized === 'manifest' || normalized === 'spa' || normalized === 'auto') {
        return normalized;
    }
    return 'auto';
}

function pageTitleStrategyOption(value) {
    const normalized = typeof value === 'string' ? value : 'from-route';
    if (normalized === 'from-manifest' || normalized === 'from-route' || normalized === 'explicit-prefix') {
        return normalized;
    }
    return 'from-route';
}

function normalizeRoutePath(routePath) {
    const trimmed = String(routePath || '').trim();
    if (! trimmed || trimmed === '/') {
        return '/';
    }

    return '/' + trimmed.replace(/^\/+|\/+$/g, '');
}

function slugForRoute(routePath) {
    const trimmed = normalizeRoutePath(routePath).replace(/^\//, '');
    if (! trimmed) {
        return 'home';
    }
    const segments = trimmed.split('/');
    return sanitizeFileComponent(segments[segments.length - 1] || 'page');
}

function applyPagePrefix(prefix, value) {
    const normalizedValue = String(value || '').trim();
    if (! prefix) {
        return normalizedValue;
    }
    if (! normalizedValue) {
        return prefix;
    }
    return [prefix, normalizedValue].filter(Boolean).join('-');
}

function derivePageTitle(item, strategy, prefix) {
    if (strategy === 'from-manifest' && item.page_title) {
        return item.page_title;
    }

    const routePath = normalizeRoutePath(item.route_path);
    const pretty = routePath === '/'
        ? 'Home'
        : routePath.slice(1).split('/').map((segment) => segment.replace(/[-_]+/g, ' ')).map(capitalizeWord).join(' / ');

    if (strategy === 'explicit-prefix' && prefix) {
        return capitalizeWord(prefix.replace(/[-_]+/g, ' ')) + ' ' + pretty;
    }

    return pretty;
}

function capitalizeWord(value) {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function allowedPageStatus(value) {
    const normalized = String(value || 'draft');
    return ['publish', 'draft', 'pending', 'private'].includes(normalized) ? normalized : 'draft';
}

function emitValidationSummary(verification) {
    return verification;
}
