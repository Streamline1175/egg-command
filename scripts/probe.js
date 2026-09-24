#!/usr/bin/env node
/**
 * Connect to a controller and print every raw message it sends, decoded
 * alongside. Handy for checking a new setup before using the dashboard.
 *
 *   npm run probe -- --lan 192.168.1.50 --pin 123456
 *   npm run probe -- --cloud --email you@example.com --password '...'
 *   npm run probe -- --cloud --user-id 12345 --token abc...
 *   add --device 98765 to pick a specific controller
 */

const { LanTransport, CloudTransport } = require('../lib/flameboss/transports');
const { cloudLogin } = require('../lib/flameboss/cloud-login');
const { decidegToC, cToF } = require('../lib/flameboss/protocol');

function args() {
    const out = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = true;
        }
    }
    return out;
}

const f = (v) => {
    const c = decidegToC(v);
    return c == null ? 'unplugged' : `${Math.round(cToF(c))}°F`;
};

async function main() {
    const a = args();
    let transport;
    if (a.lan) {
        transport = new LanTransport({ host: a.lan, pin: a.pin, deviceId: a.device });
    } else if (a.cloud) {
        let { 'user-id': userId, token } = a;
        if (!token) {
            const creds = await cloudLogin({ login: a.email, password: a.password });
            ({ userId, token } = creds);
            console.log(`Signed in: MQTT user T-${userId}`);
        }
        transport = new CloudTransport({ userId, token, deviceId: a.device, tls: a['no-tls'] ? false : true });
    } else {
        console.log('Usage: npm run probe -- --lan <ip> --pin <pin>   |   --cloud --email <e> --password <p>');
        process.exit(1);
    }

    transport.on('status', (s) => console.log(`[${s.status}]`, s.error || s.detail || ''));
    transport.on('device', (id) => console.log(`device id: ${id}`));
    transport.on('message', (msg) => {
        let note = '';
        if (msg.name === 'temps') {
            const [pit, ...meats] = msg.temps || [];
            note = `  → pit ${f(pit)}, set ${f(msg.set_temp)}, meats ${meats.map(f).join(' / ')}, fan ${(msg.blower / 100).toFixed(0)}%`;
        } else if (msg.name === 'set_temp') {
            note = `  → ${f(msg.value)}`;
        }
        console.log(new Date().toLocaleTimeString(), JSON.stringify(msg) + note);
    });
    transport.start();
    process.on('SIGINT', async () => {
        await transport.stop();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
