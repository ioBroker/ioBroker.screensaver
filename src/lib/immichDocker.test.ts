import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { ImmichSource, type ImmichClient } from './immich';
import {
    appAddresses,
    IMMICH_KEY_PERMISSIONS,
    ImmichDocker,
    immichStatusHtml,
    readDockerSettings,
    serverUrl,
    shellQuote,
    type ImmichDockerStatus,
    type ImmichKey,
} from './immichDocker';

const BASE = 'http://127.0.0.1:2283';
const EMAIL = 'family@example.com';
const PASSWORD = 'pw-1234';

interface Call {
    method: string;
    path: string;
    body?: string;
    auth?: string;
    key?: string;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * A fake Immich with the endpoints of v3.4.2 that the setup uses
 *
 * @param options - the server as it is found
 * @param options.admin - the account that exists; none for a new Immich
 * @param options.admin.email - its e-mail
 * @param options.admin.password - its password
 * @param options.keys - API keys that exist: id → secret
 * @param options.downPings - how many pings fail before the server answers
 */
function fakeImmich(
    options: { admin?: { email: string; password: string }; keys?: [string, string][]; downPings?: number } = {},
): { fetchFn: typeof fetch; calls: Call[]; keys: Map<string, string> } {
    let admin = options.admin || null;
    let pings = 0;
    let next = 1;
    const keys = new Map(options.keys || []);
    const calls: Call[] = [];
    // the setup always asks with a string
    const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
        const method = init?.method || 'GET';
        const headers = (init?.headers || {}) as Record<string, string>;
        const path = url.replace(`${BASE}/api`, '');
        const body = typeof init?.body === 'string' ? init.body : undefined;
        calls.push({ method, path, body, auth: headers.Authorization, key: headers['x-api-key'] });
        const signedIn = headers.Authorization === 'Bearer tok1';
        if (path === '/server/ping') {
            return pings++ < (options.downPings || 0)
                ? Promise.reject(new TypeError('fetch failed'))
                : Promise.resolve(json({ res: 'pong' }));
        }
        if (path === '/server/config') {
            return Promise.resolve(json({ isInitialized: !!admin, isOnboarded: false }));
        }
        if (path === '/auth/admin-sign-up' && method === 'POST') {
            if (admin) {
                return Promise.resolve(json({ message: 'The server already has an admin', statusCode: 400 }, 400));
            }
            const data = JSON.parse(body || '{}') as { email: string; password: string; name: string };
            admin = { email: data.email, password: data.password };
            return Promise.resolve(json({ id: 'u1', email: data.email, name: data.name }, 201));
        }
        if (path === '/auth/login' && method === 'POST') {
            const data = JSON.parse(body || '{}') as { email: string; password: string };
            if (!admin || data.email !== admin.email || data.password !== admin.password) {
                return Promise.resolve(json({ message: 'Incorrect email or password', statusCode: 401 }, 401));
            }
            return Promise.resolve(json({ accessToken: 'tok1', userEmail: data.email, isAdmin: true }, 201));
        }
        if (path === '/auth/logout') {
            return Promise.resolve(json({ successful: true }));
        }
        if (path === '/api-keys' && method === 'POST') {
            if (!signedIn) {
                return Promise.resolve(json({ message: 'Authentication required' }, 401));
            }
            const id = `k${next++}`;
            const secret = `secret-${id}`;
            keys.set(id, secret);
            const data = JSON.parse(body || '{}') as { name: string; permissions: string[] };
            // v3.2 answers flat and keeps the deprecated `apiKey` beside it
            return Promise.resolve(
                json({ id, secret, name: data.name, permissions: data.permissions, apiKey: { id } }, 201),
            );
        }
        if (path.startsWith('/api-keys/') && method === 'DELETE') {
            if (!signedIn) {
                return Promise.resolve(json({ message: 'Authentication required' }, 401));
            }
            keys.delete(decodeURIComponent(path.substring('/api-keys/'.length)));
            return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (path === '/albums') {
            if (![...keys.values()].includes(headers['x-api-key'])) {
                return Promise.resolve(json({ message: 'Invalid API key' }, 401));
            }
            return Promise.resolve(json([{ id: 'a1', albumName: 'Familie' }]));
        }
        return Promise.resolve(json({ message: 'Not found' }, 404));
    };
    return { fetchFn, calls, keys };
}

function setup(
    immich: ReturnType<typeof fakeImmich>,
    options: { email?: string; password?: string; stored?: ImmichKey | null } = {},
): {
    docker: ImmichDocker;
    saved: ImmichKey[];
    statuses: ImmichDockerStatus[];
    readyClient: () => ImmichClient | null;
} {
    let stored = options.stored ?? null;
    let readyClient: ImmichClient | null = null;
    const saved: ImmichKey[] = [];
    const statuses: ImmichDockerStatus[] = [];
    const quiet = (): void => undefined;
    const docker = new ImmichDocker({
        url: BASE,
        email: options.email ?? EMAIL,
        password: options.password ?? PASSWORD,
        keyName: 'ioBroker screensaver.0',
        loadKey: () => Promise.resolve(stored),
        saveKey: key => {
            stored = key;
            saved.push(key);
            return Promise.resolve();
        },
        onStatus: status => statuses.push(status),
        onReady: client => {
            readyClient = client;
        },
        log: { info: quiet, warn: quiet, debug: quiet },
        fetchFn: immich.fetchFn,
        sleep: () => new Promise(resolve => setImmediate(resolve)),
    });
    return { docker, saved, statuses, readyClient: () => readyClient };
}

const paths = (calls: Call[]): string[] => calls.map(call => `${call.method} ${call.path}`);

describe('Immich in Docker', () => {
    it('sets up a new Immich: the administrator, and a key that only reads', async () => {
        const immich = fakeImmich({ downPings: 2 });
        const { docker, saved, statuses, readyClient } = setup(immich);
        assert.throws(() => docker.client(), /not ready/);

        await docker.start();
        assert.deepEqual(
            statuses.map(status => status.state),
            ['starting', 'ready'],
        );
        assert.deepEqual(statuses[1], { state: 'ready', user: EMAIL });
        const signUp = immich.calls.find(call => call.path === '/auth/admin-sign-up');
        assert.deepEqual(JSON.parse(signUp?.body || ''), { email: EMAIL, password: PASSWORD, name: 'family' });
        const create = immich.calls.find(call => call.path === '/api-keys' && call.method === 'POST');
        assert.equal(create?.auth, 'Bearer tok1');
        assert.deepEqual(JSON.parse(create?.body || ''), {
            name: 'ioBroker screensaver.0',
            permissions: IMMICH_KEY_PERMISSIONS,
        });
        assert.ok(paths(immich.calls).includes('POST /auth/logout'), 'the session of the sign-in is closed');
        assert.deepEqual(saved, [{ url: BASE, email: EMAIL, keyId: 'k1', secret: 'secret-k1' }]);
        assert.ok(!JSON.stringify(saved).includes(PASSWORD), 'the password is not kept with the key');

        assert.equal(readyClient(), docker.client());
        const albums = await docker.client().albums();
        assert.equal(albums[0].albumName, 'Familie');
        assert.equal(immich.calls.at(-1)?.key, 'secret-k1');
    });

    it('uses a kept key without signing in', async () => {
        const immich = fakeImmich({ admin: { email: EMAIL, password: 'changed since' }, keys: [['k9', 's9']] });
        const { docker, saved, statuses } = setup(immich, {
            stored: { url: BASE, email: EMAIL, keyId: 'k9', secret: 's9' },
        });
        await docker.start();
        assert.equal(statuses.at(-1)?.state, 'ready');
        assert.ok(!paths(immich.calls).some(path => path.includes('/auth/')), 'no sign-in');
        assert.deepEqual(saved, []);
    });

    it('keeps the key when only the port changed', async () => {
        const immich = fakeImmich({ admin: { email: EMAIL, password: PASSWORD }, keys: [['k9', 's9']] });
        const { docker, saved } = setup(immich, {
            stored: { url: 'http://127.0.0.1:2284', email: EMAIL, keyId: 'k9', secret: 's9' },
        });
        await docker.start();
        assert.deepEqual(saved, [{ url: BASE, email: EMAIL, keyId: 'k9', secret: 's9' }]);
        assert.ok(!paths(immich.calls).includes('POST /auth/login'));
    });

    it('makes a new key when the kept one was deleted in Immich, and removes the old one', async () => {
        const immich = fakeImmich({ admin: { email: EMAIL, password: PASSWORD } });
        const { docker, saved, statuses } = setup(immich, {
            stored: { url: BASE, email: EMAIL, keyId: 'k9', secret: 's9' },
        });
        await docker.start();
        assert.equal(statuses.at(-1)?.state, 'ready');
        assert.ok(!paths(immich.calls).includes('POST /auth/admin-sign-up'), 'Immich has an account already');
        assert.ok(paths(immich.calls).includes('DELETE /api-keys/k9'));
        assert.deepEqual(saved, [{ url: BASE, email: EMAIL, keyId: 'k1', secret: 'secret-k1' }]);
    });

    it('signs in with another account when the e-mail of the settings changed', async () => {
        const immich = fakeImmich({ admin: { email: 'other@example.com', password: 'x' }, keys: [['k9', 's9']] });
        const { docker, statuses } = setup(immich, {
            email: 'other@example.com',
            password: 'x',
            stored: { url: BASE, email: EMAIL, keyId: 'k9', secret: 's9' },
        });
        await docker.start();
        assert.deepEqual(statuses.at(-1), { state: 'ready', user: 'other@example.com' });
        assert.ok(paths(immich.calls).includes('POST /auth/login'));
    });

    it('asks for the account when there is neither a key nor an e-mail', async () => {
        const immich = fakeImmich();
        const { docker, statuses } = setup(immich, { email: '', password: '' });
        await docker.start();
        assert.equal(statuses.at(-1)?.state, 'noAccount');
        assert.ok(!paths(immich.calls).some(path => path.includes('/auth/')), 'nothing is created without asking');
        assert.throws(() => docker.client(), /not ready/);
    });

    it('reports a wrong password and keeps nothing', async () => {
        const immich = fakeImmich({ admin: { email: EMAIL, password: 'the real one' } });
        const { docker, saved, statuses } = setup(immich);
        await docker.start();
        assert.equal(statuses.at(-1)?.state, 'loginFailed');
        assert.deepEqual(saved, []);
        assert.equal(immich.keys.size, 0);
    });

    it('lets an album wait for the server', async () => {
        const immich = fakeImmich({ downPings: 1 });
        const { docker } = setup(immich);
        const source = new ImmichSource(() => docker.client(), '');
        await assert.rejects(source.list(), /not ready/);
        await docker.start();
        assert.equal(docker.ready, true);
    });

    it('stops waiting when the instance stops', async () => {
        const immich = fakeImmich({ downPings: 1_000_000 });
        const { docker, statuses } = setup(immich);
        const running = docker.start();
        await new Promise(resolve => setTimeout(resolve, 5));
        docker.stop();
        await running;
        assert.equal(statuses.at(-1)?.state, 'starting');
    });
});

describe('the settings of Immich in Docker', () => {
    it('fills in the defaults', () => {
        assert.deepEqual(readDockerSettings(undefined), {
            enabled: false,
            bind: '0.0.0.0',
            port: 2283,
            location: '',
            machineLearning: false,
            autoImageUpdate: true,
            stopIfInstanceStopped: false,
        });
        assert.equal(readDockerSettings({ port: '8080' as unknown as number }).port, 8080);
        assert.equal(readDockerSettings({ port: 99999 }).port, 2283);
        assert.equal(readDockerSettings({ location: ' /srv/photos ' }).location, '/srv/photos');
    });

    it('reaches the server on this host, and tells the phones another address', () => {
        assert.equal(serverUrl({ bind: '0.0.0.0', port: 2283 }), 'http://127.0.0.1:2283');
        assert.equal(serverUrl({ bind: '192.168.1.5', port: 2300 }), 'http://192.168.1.5:2300');
        const interfaces = {
            lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
            eth0: [
                { address: '192.168.1.129', family: 'IPv4', internal: false },
                { address: 'fe80::1', family: 'IPv6', internal: false },
            ],
            docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
            'br-1a2b3c': [{ address: '172.18.0.1', family: 'IPv4', internal: false }],
            wlan0: [{ address: '169.254.10.2', family: 'IPv4', internal: false }],
        } as unknown as Parameters<typeof appAddresses>[1];
        assert.deepEqual(appAddresses({ bind: '0.0.0.0', port: 2283 }, interfaces), ['http://192.168.1.129:2283']);
        assert.deepEqual(appAddresses({ bind: '192.168.1.5', port: 2283 }, interfaces), ['http://192.168.1.5:2283']);
        assert.deepEqual(appAddresses({ bind: '127.0.0.1', port: 2283 }, interfaces), []);
    });

    it('shows the status with the address for the app', () => {
        const word = (key: string, ...args: string[]): string => `${key}(${args.join(',')})`;
        const ready = immichStatusHtml({ state: 'ready', user: '<b>x' }, word, ['http://192.168.1.129:2283']);
        assert.match(ready, /immich_status_ready\(&#60;b&#62;x\)/);
        assert.match(ready, /<a href="http:\/\/192\.168\.1\.129:2283"/);
        assert.match(ready, /immich_status_app\(<b>http:\/\/192\.168\.1\.129:2283<\/b>\)/);
        assert.match(immichStatusHtml({ state: 'ready', user: 'a' }, word, []), /immich_status_local_only/);
        assert.equal(immichStatusHtml({ state: 'starting' }, word, ['http://x:1']), 'immich_status_starting()');
        // the command to create the folder, quoted for the shell and escaped for HTML
        assert.equal(
            immichStatusHtml({ state: 'folderMissing', folder: '/ssd/immich' }, word, []),
            'immich_status_folder_missing(/ssd/immich)<br><code>sudo mkdir -p /ssd/immich</code>',
        );
        assert.equal(shellQuote("/mnt/Fotos <Ma's>"), `'/mnt/Fotos <Ma'\\''s>'`);
        assert.ok(
            immichStatusHtml({ state: 'folderMissing', folder: "/mnt/Fotos <Ma's>" }, word, []).endsWith(
                '<code>sudo mkdir -p &#39;/mnt/Fotos &#60;Ma&#39;\\&#39;&#39;s&#62;&#39;</code>',
            ),
        );
    });
});

describe('docker-compose.yaml through @iobroker/plugin-docker', () => {
    interface Container {
        name: string;
        image: string;
        iobEnabled?: boolean;
        iobWaitForReady?: boolean;
        environment?: Record<string, unknown>;
        mounts?: { type: string; source: string; target: string }[];
        ports?: { hostPort: number | string; containerPort: number | string; hostIP?: string }[];
    }
    // the steps of the plugin itself (src/index.ts of plugin-docker): parse, fill in the config, convert
    const load = createRequire(__filename);
    const lib = join(dirname(load.resolve('@iobroker/plugin-docker')), 'lib');
    const parse = (load(join(lib, 'parseDockerCompose.js')) as { default: (text: string) => unknown }).default;
    const { walkTheConfig } = load(join(lib, 'templates.js')) as {
        walkTheConfig: (config: unknown, native: unknown, options: { instance: number }) => unknown;
    };
    const { composeToContainerConfigs } = load(join(lib, 'compose2config.js')) as {
        composeToContainerConfigs: (compose: unknown) => Container[];
    };
    const root = join(__dirname, '..', '..');
    const compose = parse(readFileSync(join(root, 'docker-compose.yaml'), 'utf8'));
    const containers = (native: unknown, instance = 0): Container[] =>
        composeToContainerConfigs(walkTheConfig(compose, native, { instance }));
    const byName = (list: Container[], name: string): Container => {
        const found = list.find(container => container.name === name);
        assert.ok(found, `no container ${name}`);
        return found;
    };

    it('starts nothing with the defaults of a new instance', () => {
        const ioPackage = JSON.parse(readFileSync(join(root, 'io-package.json'), 'utf8')) as {
            native: unknown;
            common: { plugins: { docker: { iobDockerComposeFiles: string[] } } };
        };
        assert.deepEqual(ioPackage.common.plugins.docker.iobDockerComposeFiles, ['docker-compose.yaml']);
        const list = containers(ioPackage.native);
        assert.equal(list.length, 4);
        assert.deepEqual(
            list.filter(container => container.iobEnabled !== false).map(container => container.name),
            [],
        );
    });

    it('runs Immich with the folder of the settings, the containers finding each other', () => {
        const list = containers({
            dockerImmich: { enabled: true, bind: '0.0.0.0', port: 2283, location: '/srv/photos' },
        });
        assert.deepEqual(
            list.filter(container => container.iobEnabled).map(container => container.name),
            ['database', 'redis', 'immich-server'],
        );
        assert.equal(byName(list, 'immich-ml').iobEnabled, false);
        // the adapter creates the folder first, then lets them start
        assert.ok(list.every(container => container.iobWaitForReady === true));
        // the plugin finds a pulled image as `repository:tag` of Docker's list: no digest, no "docker.io/"
        for (const container of list) {
            assert.match(container.image, /^[^@]+:[^:@/]+$/, container.name);
            assert.ok(!container.image.startsWith('docker.io/'), container.image);
        }

        const server = byName(list, 'immich-server');
        assert.deepEqual(server.ports, [{ hostPort: 2283, containerPort: 2283, protocol: 'tcp', hostIP: '0.0.0.0' }]);
        assert.deepEqual(server.mounts?.[0], { type: 'bind', source: '/srv/photos', target: '/data' });
        const env = server.environment || {};
        // strings only: a boolean would differ from what Docker reports and recreate the container on every check
        for (const container of list) {
            for (const [key, value] of Object.entries(container.environment || {})) {
                assert.equal(typeof value, 'string', `${container.name}: ${key}`);
            }
        }
        assert.equal(env.IMMICH_MACHINE_LEARNING_ENABLED, 'false');
        // the plugin names the containers iob_screensaver_<instance>_<name>
        assert.equal(env.DB_HOSTNAME, 'iob_screensaver_0_database');
        assert.equal(env.REDIS_HOSTNAME, 'iob_screensaver_0_redis');
        assert.equal(env.IMMICH_MACHINE_LEARNING_URL, 'http://iob_screensaver_0_immich-ml:3003');
        assert.equal(env.DB_PASSWORD, byName(list, 'database').environment?.POSTGRES_PASSWORD);
    });

    it('adds machine learning, and follows the instance and the port', () => {
        const list = containers(
            {
                dockerImmich: {
                    enabled: true,
                    bind: '192.168.1.5',
                    port: 2300,
                    location: '/srv/photos',
                    machineLearning: true,
                },
            },
            1,
        );
        assert.equal(byName(list, 'immich-ml').iobEnabled, true);
        const server = byName(list, 'immich-server');
        assert.equal(server.environment?.IMMICH_MACHINE_LEARNING_ENABLED, 'true');
        assert.equal(server.environment?.DB_HOSTNAME, 'iob_screensaver_1_database');
        assert.equal(server.ports?.[0].hostPort, 2300);
        assert.equal(server.ports?.[0].hostIP, '192.168.1.5');
    });
});
