import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { floatingToText } from './dateFilter';
import { GoogleConnection, statusHtml, type GoogleAccount, type GoogleStatus } from './googleConnection';
import {
    AmbientClient,
    DAILY_LIST_BUDGET,
    GoogleError,
    GoogleSession,
    GoogleSource,
    MIN_LIST_INTERVAL_MS,
    OAuthProxy,
    URL_LIFETIME_MS,
    parseDuration,
    type AmbientMediaItem,
    type GoogleAccess,
} from './googlePhotos';

const OAUTH = 'https://oauth.test/googlephotos';
const API = 'https://photosambient.googleapis.com/v1';

interface Call {
    method: string;
    url: string;
    body?: string;
    auth?: string;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function item(id: string, createTime: string, mimeType = 'image/jpeg'): AmbientMediaItem {
    return {
        id,
        createTime,
        mediaFile: { baseUrl: `https://lh3.test/${id}`, mimeType, mediaFileMetadata: { width: '4000', height: 3000 } },
    };
}

/** A Google that answers like the documentation says, and records what it was asked */
function fakeGoogle(
    options: {
        pendingPolls?: number;
        sourcesAfter?: number;
        pages?: AmbientMediaItem[][];
        partner?: boolean;
        /** DELETE of a device fails */
        deleteFails?: boolean;
    } = {},
): {
    calls: Call[];
    fetchFn: typeof fetch;
    state: { polls: number; deviceReads: number; deleted: string[]; revoked: string[]; refreshes: number };
} {
    const calls: Call[] = [];
    const state = { polls: 0, deviceReads: 0, deleted: [] as string[], revoked: [] as string[], refreshes: 0 };
    const pages = options.pages || [[item('a', '2024-07-14T16:22:05Z')]];
    const device = (sourcesSet: boolean): Record<string, unknown> => ({
        id: 'dev1',
        displayName: 'ioBroker test',
        settingsUri: 'https://photos.google.com/ambient/dev1',
        pollingConfig: { pollInterval: '3.5s' },
        mediaSourcesSet: sourcesSet,
        mediaSources: sourcesSet ? [{ id: 'src-family', displayName: 'Familie' }] : [],
    });
    const fetchFn = ((input: string | URL, init: RequestInit = {}) => {
        const url = String(input);
        const method = init.method || 'GET';
        const headers = (init.headers || {}) as Record<string, string>;
        calls.push({ method, url, body: init.body as string | undefined, auth: headers.Authorization });
        if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
            return Promise.resolve(
                json({ sub: '1', name: 'Demo User', picture: 'https://lh3.googleusercontent.test/a/demo"x' }),
            );
        }
        if (url === `${OAUTH}/device`) {
            return Promise.resolve(
                json({
                    device_code: 'dc1',
                    user_code: 'ABCD-EFGH',
                    verification_url: 'https://www.google.com/device',
                    expires_in: 1800,
                    interval: 5,
                }),
            );
        }
        if (url === `${OAUTH}/token`) {
            state.polls++;
            if (state.polls <= (options.pendingPolls ?? 1)) {
                return Promise.resolve(json({ error: 'authorization_pending' }, 428));
            }
            return Promise.resolve(
                json({
                    access_token: 'at1',
                    refresh_token: 'rt1',
                    expires_in: 3599,
                    scope: 'https://www.googleapis.com/auth/photosambient.mediaitems profile',
                }),
            );
        }
        if (url === `${OAUTH}/refresh`) {
            state.refreshes++;
            const body = JSON.parse(init.body as string) as { refresh_token: string };
            if (body.refresh_token === 'revoked') {
                return Promise.resolve(
                    json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400),
                );
            }
            return Promise.resolve(json({ access_token: `at-${state.refreshes}`, expires_in: 3599 }));
        }
        if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
            state.revoked.push(new URLSearchParams(init.body as string).get('token') || '');
            return Promise.resolve(new Response('', { status: 200 }));
        }
        if (url.startsWith(`${API}/devices?requestId=`) && method === 'POST') {
            if (options.partner === false) {
                // what Google answered on 2026-11-20 for a client outside the partner program
                return Promise.resolve(
                    json(
                        {
                            error: {
                                code: 403,
                                status: 'PERMISSION_DENIED',
                                message:
                                    'You do not have permission to perform the requested operation. Please refer to the partner program at https://developers.google.com/photos/partner-program/overview.',
                            },
                        },
                        403,
                    ),
                );
            }
            return Promise.resolve(json(device(false)));
        }
        if (url.startsWith(`${API}/devices/`) && method === 'DELETE') {
            if (options.deleteFails) {
                return Promise.resolve(json({ error: { code: 503, status: 'UNAVAILABLE', message: 'later' } }, 503));
            }
            state.deleted.push(decodeURIComponent(url.substring(`${API}/devices/`.length)));
            return Promise.resolve(json({}));
        }
        if (url === `${API}/devices/gone`) {
            return Promise.resolve(json({ error: { code: 404, status: 'NOT_FOUND', message: 'not found' } }, 404));
        }
        if (url.startsWith(`${API}/devices/`)) {
            state.deviceReads++;
            return Promise.resolve(json(device(state.deviceReads > (options.sourcesAfter ?? 1))));
        }
        if (url.startsWith(`${API}/mediaItems?`)) {
            const query = new URL(url).searchParams;
            const page = Number(query.get('pageToken') || 0);
            return Promise.resolve(
                json({
                    mediaItems: pages[page] || [],
                    nextPageToken: page + 1 < pages.length ? String(page + 1) : undefined,
                }),
            );
        }
        if (url.startsWith('https://lh3.test/')) {
            return Promise.resolve(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 }));
        }
        return Promise.resolve(new Response('unexpected', { status: 500 }));
    }) as typeof fetch;
    return { calls, fetchFn, state };
}

/** Let the loops of the connection run until a condition holds */
async function until(test: () => boolean): Promise<void> {
    for (let i = 0; i < 500 && !test(); i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(test(), 'the condition never came true');
}

function connection(
    google: ReturnType<typeof fakeGoogle>,
    stored: GoogleAccount | null = null,
): {
    connection: GoogleConnection;
    statuses: GoogleStatus[];
    saved: (GoogleAccount | null)[];
    chosen: number[];
    sleeps: number[];
} {
    const statuses: GoogleStatus[] = [];
    const saved: (GoogleAccount | null)[] = [];
    const chosen: number[] = [];
    const sleeps: number[] = [];
    const log = { info: (): void => undefined, warn: (): void => undefined, debug: (): void => undefined };
    return {
        connection: new GoogleConnection({
            oauth: new OAuthProxy(OAUTH, google.fetchFn),
            fetchFn: google.fetchFn,
            displayName: 'ioBroker test',
            loadAccount: () => Promise.resolve(stored),
            saveAccount: account => {
                saved.push(account);
                return Promise.resolve();
            },
            onStatus: status => statuses.push(status),
            onSourcesChosen: () => chosen.push(1),
            log,
            sleep: ms => {
                sleeps.push(ms);
                return Promise.resolve();
            },
            uuid: () => '0b2b7c4e-3f1a-4d2e-9c8b-7a6f5e4d3c2b',
        }),
        statuses,
        saved,
        chosen,
        sleeps,
    };
}

describe('Google Photos', () => {
    it('connects: code, consent, device, sources chosen in the app', async () => {
        const google = fakeGoogle({ pendingPolls: 2, sourcesAfter: 1 });
        const { connection: c, statuses, saved, chosen, sleeps } = connection(google);

        const code = await c.connect();
        assert.equal(code.userCode, 'ABCD-EFGH');
        assert.equal(code.verificationUrl, 'https://www.google.com/device');
        await until(() => c.status.state === 'connected');

        assert.deepEqual(
            statuses.map(status => status.state),
            ['code', 'sources', 'connected'],
        );
        // the device code was asked with the request ID the device is created with: one QR code is enough
        const device = google.calls.find(call => call.url === `${OAUTH}/device`);
        assert.deepEqual(JSON.parse(device.body), {
            requestId: '0b2b7c4e-3f1a-4d2e-9c8b-7a6f5e4d3c2b',
            displayName: 'ioBroker test',
        });
        const create = google.calls.find(call => call.method === 'POST' && call.url.startsWith(`${API}/devices`));
        assert.equal(create.url, `${API}/devices?requestId=0b2b7c4e-3f1a-4d2e-9c8b-7a6f5e4d3c2b`);
        assert.deepEqual(JSON.parse(create.body), { displayName: 'ioBroker test' });
        // the token of the sign-in is used at once, no refresh needed
        assert.equal(create.auth, 'Bearer at1');
        assert.equal(google.state.refreshes, 0);

        // name and avatar of the account, read with the token of the sign-in, for the settings
        const profile = google.calls.find(call => call.url.endsWith('/oauth2/v3/userinfo'));
        assert.equal(profile?.auth, 'Bearer at1');
        assert.deepEqual(saved, [
            {
                refreshToken: 'rt1',
                deviceId: 'dev1',
                requestId: '0b2b7c4e-3f1a-4d2e-9c8b-7a6f5e4d3c2b',
                displayName: 'ioBroker test',
                name: 'Demo User',
                picture: 'https://lh3.googleusercontent.test/a/demo"x',
            },
        ]);
        assert.deepEqual(statuses.at(-1), {
            state: 'connected',
            settingsUri: 'https://photos.google.com/ambient/dev1',
            sources: [{ id: 'src-family', displayName: 'Familie' }],
            account: { name: 'Demo User', picture: 'https://lh3.googleusercontent.test/a/demo"x' },
        });
        // polled at the pace Google asked for: 5 s for the token, 3.5 s for the device
        assert.deepEqual(sleeps.slice(0, 3), [5000, 5000, 5000]);
        assert.ok(sleeps.includes(3500));
        assert.equal(chosen.length, 1);
        const access = c.access();
        assert.equal(access?.deviceId, 'dev1');
        assert.deepEqual(access?.sources, [{ id: 'src-family', displayName: 'Familie' }]);
        assert.equal(c.settingsUri, 'https://photos.google.com/ambient/dev1');
    });

    it('says when Google keeps the API closed, and withdraws the unused consent', async () => {
        const google = fakeGoogle({ partner: false });
        const { connection: c, saved, chosen } = connection(google);
        await c.connect();
        await until(() => c.status.state === 'notAllowed');
        assert.deepEqual(google.state.revoked, ['rt1']);
        assert.deepEqual(saved, []);
        assert.equal(chosen.length, 0);
        assert.equal(c.access(), null);
        const html = statusHtml(
            c.status,
            key => key,
            () => '',
        );
        assert.match(html, /google_status_not_allowed/);
        assert.match(html, /href="https:\/\/developers\.google\.com\/photos\/partner-program\/overview"/);
    });

    it('reports a refused sign-in and a code that ran out', async () => {
        const google = fakeGoogle({ pendingPolls: 1000 });
        let time = 0;
        const statuses: GoogleStatus[] = [];
        const c = new GoogleConnection({
            oauth: new OAuthProxy(OAUTH, google.fetchFn),
            fetchFn: google.fetchFn,
            displayName: 'x',
            loadAccount: () => Promise.resolve(null),
            saveAccount: () => Promise.resolve(),
            onStatus: status => statuses.push(status),
            onSourcesChosen: () => undefined,
            log: { info: () => undefined, warn: () => undefined, debug: () => undefined },
            now: () => time,
            sleep: ms => {
                time += ms;
                return Promise.resolve();
            },
            uuid: () => '0b2b7c4e-3f1a-4d2e-9c8b-7a6f5e4d3c2b',
        });
        await c.connect();
        await until(() => c.status.state === 'denied');
        // 1800 s at 5 s: asked about 360 times, then given up
        assert.ok(google.state.polls >= 359 && google.state.polls <= 361, String(google.state.polls));
    });

    it('starts with a stored account: connected, device gone, sign-in revoked', async () => {
        const google = fakeGoogle({ sourcesAfter: 0 });
        const account: GoogleAccount = { refreshToken: 'rt1', deviceId: 'dev1', requestId: 'r', displayName: 'x' };
        const ok = connection(google, account);
        await ok.connection.start();
        assert.equal(ok.connection.status.state, 'connected');
        assert.equal(ok.chosen.length, 0);
        // an account kept before names were read gets them once
        assert.equal(ok.saved.length, 1);
        assert.equal(ok.saved[0]?.name, 'Demo User');
        const status = ok.connection.status;
        assert.equal(status.state === 'connected' ? status.account?.name : '', 'Demo User');

        // removed in the app: the consent is withdrawn and nothing of the account is kept
        const goneGoogle = fakeGoogle();
        const gone = connection(goneGoogle, { ...account, deviceId: 'gone' });
        await gone.connection.start();
        assert.equal(gone.connection.status.state, 'gone');
        assert.equal(gone.connection.access(), null);
        await until(() => gone.saved.at(-1) === null);
        assert.deepEqual(goneGoogle.state.revoked, ['rt1']);

        // revoked in the Google account: nothing of the account is kept
        const revokedGoogle = fakeGoogle();
        const revoked = connection(revokedGoogle, { ...account, refreshToken: 'revoked' });
        await revoked.connection.start();
        assert.equal(revoked.connection.status.state, 'expired');
        await until(() => revoked.saved.at(-1) === null);
        assert.deepEqual(revokedGoogle.state.revoked, []);
    });

    it('disconnects: device removed, consent withdrawn, account forgotten', async () => {
        const google = fakeGoogle({ sourcesAfter: 0 });
        const account: GoogleAccount = { refreshToken: 'rt1', deviceId: 'dev1', requestId: 'r', displayName: 'x' };
        const { connection: c, saved } = connection(google, account);
        await c.start();
        await c.disconnect();
        assert.deepEqual(google.state.deleted, ['dev1']);
        assert.deepEqual(google.state.revoked, ['rt1']);
        assert.deepEqual(saved.at(-1), null);
        assert.equal(c.status.state, 'disconnected');
        assert.equal(c.access(), null);
    });

    it('withdraws the consent on disconnect also where the device cannot be removed', async () => {
        const google = fakeGoogle({ sourcesAfter: 0, deleteFails: true });
        const account: GoogleAccount = {
            refreshToken: 'rt1',
            deviceId: 'dev1',
            requestId: 'r',
            displayName: 'x',
            name: 'Demo User',
        };
        const { connection: c, saved } = connection(google, account);
        await c.start();
        await c.disconnect();
        assert.deepEqual(google.state.deleted, []);
        assert.deepEqual(google.state.revoked, ['rt1']);
        assert.deepEqual(saved, [null]);
        assert.equal(c.status.state, 'disconnected');
    });

    it('reads a source chosen in the app, page by page, without videos', async () => {
        let time = Date.UTC(2026, 10, 20, 12);
        const pages = [
            [item('a', '2024-07-14T16:22:05Z'), item('v', '2024-07-14T16:23:00Z', 'video/mp4')],
            [item('b', '2025-11-20T08:00:00Z', 'image/gif'), item('c', '2025-11-21T08:00:00Z')],
            [item('a', '2024-07-14T16:22:05Z')],
        ];
        const google = fakeGoogle({ pages });
        const session = new GoogleSession(new OAuthProxy(OAUTH, google.fetchFn), 'rt1', () => time);
        const client = new AmbientClient(session, google.fetchFn, () => time);
        let sources = [{ id: 'src-family', displayName: 'Familie' }];
        const access: GoogleAccess = {
            access: () => ({ client, deviceId: 'dev1', sources }),
            refreshSources: () => Promise.resolve(sources),
        };

        const source = new GoogleSource(access, 'familie', () => time);
        const entries = await source.list();
        assert.deepEqual(
            entries.map(entry => [entry.key, entry.name, entry.width, entry.height, entry.known]),
            [
                ['a', 'a.jpg', 4000, 3000, true],
                ['b', 'b.gif', 4000, 3000, true],
                ['c', 'c.jpg', 4000, 3000, true],
            ],
        );
        // the time of the picture as the clock of this host shows it
        const expected = new Date(Date.parse('2024-07-14T16:22:05Z'));
        const pad = (n: number): string => String(n).padStart(2, '0');
        assert.equal(
            floatingToText(entries[0].date),
            `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T${pad(expected.getHours())}:${pad(expected.getMinutes())}:05`,
        );
        const lists = (): Call[] => google.calls.filter(call => call.url.startsWith(`${API}/mediaItems`));
        assert.equal(lists().length, 3);
        assert.equal(new URL(lists()[0].url).searchParams.get('mediaSourceId'), 'src-family');
        assert.equal(new URL(lists()[0].url).searchParams.get('pageSize'), '100');

        // within a few hours the list of before is good enough
        time += 60 * 60_000;
        await source.list();
        assert.equal(lists().length, 3);

        // a picture with a fresh address: loaded in the size of the frame
        time = Date.UTC(2026, 10, 20, 12) + 10 * 60_000;
        const fresh = new GoogleSource(access, '', () => time);
        await fresh.list();
        const before = lists().length;
        await fresh.read('c', 1920);
        assert.ok(google.calls.some(call => call.url === 'https://lh3.test/c=w1920-h1920'));
        assert.equal(lists().length, before);
        // after an hour the address is gone: the list is asked again first
        time += URL_LIFETIME_MS + 1;
        await fresh.read('c', 1280);
        assert.equal(lists().length, before + 3);
        assert.ok(google.calls.some(call => call.url === 'https://lh3.test/c=w1280-h1280'));

        // the selection of Google: no source in the request
        assert.equal(new URL(lists()[before].url).searchParams.has('mediaSourceId'), false);
        // a source that is not chosen (any more)
        sources = [];
        await assert.rejects(new GoogleSource(access, 'Urlaub', () => time).list(), /not chosen/);
        assert.ok(MIN_LIST_INTERVAL_MS > URL_LIFETIME_MS);
    });

    it('keeps to the daily limit of the API', async () => {
        let time = new Date(2026, 10, 20, 10).getTime();
        const google = fakeGoogle({ pages: [[item('a', '2024-07-14T16:22:05Z')]] });
        const client = new AmbientClient(
            new GoogleSession(new OAuthProxy(OAUTH, google.fetchFn), 'rt1', () => time),
            google.fetchFn,
            () => time,
        );
        for (let i = 0; i < DAILY_LIST_BUDGET; i++) {
            await client.listMediaItems('dev1');
        }
        assert.equal(client.budgetLeft, 0);
        await assert.rejects(
            client.listMediaItems('dev1'),
            (e: unknown) => e instanceof GoogleError && e.code === 'BUDGET',
        );
        // a new day
        time += 24 * 60 * 60_000;
        assert.equal(client.budgetLeft, DAILY_LIST_BUDGET);
        await client.listMediaItems('dev1');
    });

    it('asks for a new access token once when Google refuses the old one', async () => {
        const google = fakeGoogle({ sourcesAfter: 0 });
        let refused = false;
        const fetchFn = ((input: string | URL, init?: RequestInit) => {
            if (String(input).startsWith(`${API}/devices/`) && !refused) {
                refused = true;
                return Promise.resolve(json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, 401));
            }
            return google.fetchFn(input, init);
        }) as typeof fetch;
        const client = new AmbientClient(new GoogleSession(new OAuthProxy(OAUTH, google.fetchFn), 'rt1'), fetchFn);
        const device = await client.getDevice('dev1');
        assert.equal(device.id, 'dev1');
        assert.equal(google.state.refreshes, 2);
    });

    it('reads durations and shows the status safely', () => {
        assert.equal(parseDuration('3.5s', 1), 3500);
        assert.equal(parseDuration('10s', 1), 10000);
        assert.equal(parseDuration('soon', 7), 7);
        const word = (key: string, ...args: string[]): string => `${key}(${args.join('|')})`;
        const html = statusHtml(
            { state: 'code', userCode: 'AB<C', verificationUrl: 'https://www.google.com/device', expiresAt: 0 },
            word,
            () => '14:35',
        );
        assert.match(
            html,
            /<a href="https:\/\/www\.google\.com\/device" target="_blank" rel="noopener noreferrer" style="color:inherit;font-weight:bold;text-decoration:underline">google\.com\/device<\/a>/,
        );
        assert.match(html, /AB&#60;C/);
        assert.match(html, /google_status_code_until\(14:35\)/);
        const connected = statusHtml(
            {
                state: 'connected',
                settingsUri: 'javascript:alert(1)',
                sources: [{ id: '1', displayName: '<b>Familie</b>' }],
            },
            word,
            () => '',
        );
        assert.doesNotMatch(connected, /<b>|href="javascript/);
        assert.match(connected, /&#60;b&#62;Familie/);

        // the account with its avatar, and a QR code to the settings of the device in the app
        const qr = (text: string): string => `[QR ${text}]`;
        const withAccount = statusHtml(
            {
                state: 'connected',
                settingsUri: 'https://photos.google.com/ambient/dev1',
                sources: [],
                account: { name: 'Demo <User>', picture: 'https://lh3.test/a"onerror="x' },
            },
            word,
            () => '',
            qr,
        );
        assert.match(withAccount, /<img src="https:\/\/lh3\.test\/a&#34;onerror=&#34;x" alt="" width="32" height="32"/);
        assert.match(withAccount, /google_status_account\(Demo &#60;User&#62;\)/);
        assert.match(withAccount, /\[QR https:\/\/photos\.google\.com\/ambient\/dev1\]/);
        assert.match(withAccount, /google_status_connected\(google_status_curated\(\)\)/);
        // no QR code for an address that is not https, and none for no account
        assert.doesNotMatch(
            statusHtml({ state: 'sources', settingsUri: '' }, word, () => '', qr),
            /\[QR|<img/,
        );
        // the code is shown with a QR code of the page to enter it on
        assert.match(
            statusHtml(
                { state: 'code', userCode: 'X', verificationUrl: 'https://www.google.com/device', expiresAt: 0 },
                word,
                () => '',
                qr,
            ),
            /\[QR https:\/\/www\.google\.com\/device\]/,
        );
        // the real QR code is an SVG on white
        assert.match(
            statusHtml({ state: 'sources', settingsUri: 'https://photos.google.com/x' }, word, () => ''),
            /<svg[^>]*>.*fill="white"/,
        );
    });
});
