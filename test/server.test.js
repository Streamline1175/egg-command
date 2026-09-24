const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp, isLocalHost } = require('../server');
const { DeviceSession } = require('../lib/flameboss/session');
const { ConfigStore } = require('../lib/config-store');
const { waitUntil } = require('./helpers');

async function setup(t, { login } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egg-'));
    const store = new ConfigStore(path.join(dir, 'config.json'));
    const session = new DeviceSession({ historyGapMs: 0 });
    const { app, restart } = createApp({ session, store, login, sessionOverrides: { intervalMs: 50 } });
    await restart();
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
        await session.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const post = (url, body, headers = { 'Content-Type': 'application/json' }) =>
        fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body) });
    return { base, store, session, post };
}

test('isLocalHost only accepts LAN addresses', () => {
    for (const ok of ['192.168.1.50', '10.0.0.7', '172.20.1.1', 'egg-genius.local']) assert.ok(isLocalHost(ok), ok);
    for (const bad of ['8.8.8.8', '172.32.0.1', 'example.com', '', 'http://192.168.1.5', '192.168.1.5/json']) {
        assert.ok(!isLocalHost(bad), bad);
    }
});

test('state + set-temp over HTTP in demo mode', async (t) => {
    const { base, session, post } = await setup(t);
    await waitUntil(() => session.device.pit != null);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.mode, 'demo');
    assert.equal(state.connection.status, 'connected');
    assert.equal(state.settings.cloud.signedIn, false);

    const ok = await post('/api/control/set-temp', { value: 250, unit: 'F' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).confirmed, true);

    const bad = await post('/api/control/set-temp', { value: 2000, unit: 'F' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /outside/);
});

test('POST without JSON content type is rejected', async (t) => {
    const { post } = await setup(t);
    const res = await post('/api/control/set-temp', { value: 250, unit: 'F' }, { 'Content-Type': 'text/plain' });
    assert.equal(res.status, 415);
});

test('settings validation and persistence; PIN never returned', async (t) => {
    const { post, store } = await setup(t);
    let res = await post('/api/settings', { mode: 'lan', lan: { host: '8.8.8.8', pin: '1234' } });
    assert.equal(res.status, 400);
    res = await post('/api/settings', { mode: 'lan', lan: { host: '192.168.1.50', pin: '1234' }, deviceId: '555' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.settings.lan, { host: '192.168.1.50', hasPin: true });
    assert.equal(JSON.stringify(body).includes('1234'), false);
    assert.equal(store.get().lan.pin, '1234');
    assert.equal(store.get().deviceId, 555);
    // Reloading from disk keeps the settings.
    assert.equal(new ConfigStore(store.file).get().lan.host, '192.168.1.50');
});

test('cloud login stores the token, not the password', async (t) => {
    const login = async ({ login: email, password }) => {
        if (password !== 'right') throw new Error('Flame Boss rejected that email/password');
        return { userId: 42, username: email, token: 'tok123' };
    };
    const { post, store } = await setup(t, { login });
    let res = await post('/api/cloud/login', { email: 'me@x.com', password: 'wrong' });
    assert.equal(res.status, 400);
    res = await post('/api/cloud/login', { email: 'me@x.com', password: 'right' });
    const body = await res.json();
    assert.equal(body.settings.cloud.signedIn, true);
    assert.equal(JSON.stringify(body).includes('tok123'), false);
    assert.equal(store.get().cloud.token, 'tok123');
    assert.equal(JSON.stringify(store.get()).includes('right'), false);
});

test('event stream sends a snapshot then live samples', async (t) => {
    const { base, session } = await setup(t);
    await waitUntil(() => session.device.pit != null);
    const ctrl = new AbortController();
    t.after(() => ctrl.abort());
    const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
    const reader = res.body.getReader();
    let text = '';
    await waitUntil(async () => {
        const { value } = await reader.read();
        text += Buffer.from(value).toString();
        return text.includes('event: snapshot') && text.includes('event: sample');
    });
    ctrl.abort();
});
