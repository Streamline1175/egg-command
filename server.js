const express = require('express');
const net = require('net');
const path = require('path');
const { DeviceSession } = require('./lib/flameboss/session');
const { CommandError } = require('./lib/flameboss/protocol');
const { cloudLogin } = require('./lib/flameboss/cloud-login');
const { ConfigStore } = require('./lib/config-store');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// The controller should only ever be on the local network. Refusing public
// addresses keeps this server from being used as a generic network proxy.
function isLocalHost(host) {
    if (typeof host !== 'string' || !host) return false;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(local|lan|home\.arpa)$/i.test(host)) return true;
    if (net.isIPv4(host)) {
        const [a, b] = host.split('.').map(Number);
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    return false;
}

function createApp({ session, store, login = cloudLogin, sessionOverrides } = {}) {
    const app = express();
    app.use(express.json({ limit: '16kb' }));

    // Every mutating call must be JSON. Browsers cannot send cross-site JSON
    // without a CORS preflight (which we never approve), so a random web page
    // cannot drive the grill through a visitor's browser.
    app.use('/api', (req, res, next) => {
        if (req.method === 'POST' && !req.is('application/json')) {
            return res.status(415).json({ error: 'Content-Type must be application/json' });
        }
        next();
    });

    const restart = () => session.start(store.get(), sessionOverrides);

    app.get('/api/state', (req, res) => {
        res.json({ ...session.snapshot(), settings: store.publicView() });
    });

    // Server-sent events: one full snapshot, then incremental updates.
    app.get('/api/events', (req, res) => {
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('snapshot', { ...session.snapshot(), settings: store.publicView() });

        let pending = null;
        const onChange = () => {
            if (pending) return;
            pending = setTimeout(() => {
                pending = null;
                send('state', session.snapshot({ includeHistory: false }));
            }, 100);
        };
        const onSample = (s) => send('sample', s);
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
        session.on('change', onChange);
        session.on('sample', onSample);
        req.on('close', () => {
            clearTimeout(pending);
            clearInterval(heartbeat);
            session.off('change', onChange);
            session.off('sample', onSample);
        });
    });

    app.post('/api/settings', async (req, res) => {
        const { mode, deviceId, lan, cloud } = req.body || {};
        if (!['demo', 'lan', 'cloud'].includes(mode)) return res.status(400).json({ error: 'mode must be demo, lan or cloud' });
        const patch = { mode };
        if (deviceId !== undefined) {
            if (deviceId !== null && deviceId !== '' && !/^\d+$/.test(String(deviceId))) {
                return res.status(400).json({ error: 'Device ID must be a number' });
            }
            patch.deviceId = deviceId ? Number(deviceId) : null;
        }
        if (lan) {
            const host = String(lan.host || '').trim();
            if (host && !isLocalHost(host)) {
                return res.status(400).json({ error: 'Controller address must be a local network IP (e.g. 192.168.1.50)' });
            }
            patch.lan = { host };
            if (lan.pin) {
                if (!/^\d{3,10}$/.test(String(lan.pin))) return res.status(400).json({ error: 'PIN should be the digits shown on the controller' });
                patch.lan.pin = String(lan.pin);
            }
        }
        if (cloud && typeof cloud.tls === 'boolean') patch.cloud = { tls: cloud.tls };
        store.update(patch);
        await restart();
        res.json({ ok: true, settings: store.publicView() });
    });

    app.post('/api/cloud/login', async (req, res) => {
        const { email, password } = req.body || {};
        try {
            const creds = await login({ login: email, password });
            store.update({ cloud: { userId: creds.userId, token: creds.token, username: creds.username } });
            if (store.get().mode === 'cloud') await restart();
            res.json({ ok: true, settings: store.publicView() });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.post('/api/cloud/logout', async (req, res) => {
        store.update({ cloud: { userId: null, token: '', username: null } });
        if (store.get().mode === 'cloud') await session.stop();
        res.json({ ok: true, settings: store.publicView() });
    });

    const control = (fn) => async (req, res) => {
        try {
            res.json(await fn(req.body || {}));
        } catch (err) {
            const status = err instanceof CommandError ? 400 : 502;
            res.status(status).json({ error: err.message });
        }
    };

    app.post('/api/control/set-temp', control((b) => session.setPitTemp({ value: b.value, unit: b.unit })));
    app.post('/api/control/meat-alarm', control((b) => session.setMeatAlarm(b)));
    app.post('/api/control/alarm-ack', control(() => session.ackAlarm()));
    app.post('/api/control/sync', control(() => session.sync()));

    // Last raw messages from the controller, for troubleshooting.
    app.get('/api/debug/raw', (req, res) => res.json(session.rawLog));

    app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

    // --- SERVE REACT APP ---
    // Points to the 'dist' folder created by Vite
    const dist = path.join(__dirname, 'client/dist');
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));

    return { app, restart };
}

if (require.main === module) {
    const store = new ConfigStore();
    const session = new DeviceSession();
    const { app, restart } = createApp({ session, store });
    restart();
    app.listen(PORT, HOST, () => {
        console.log(`\n🥚 Egg Command Active`);
        console.log(`👉 Access: http://localhost:${PORT}`);
        console.log(`   Data source: ${store.get().mode}`);
    });
}

module.exports = { createApp, isLocalHost };
