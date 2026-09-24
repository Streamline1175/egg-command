/**
 * Transports move Flame Boss JSON messages between this server and a
 * controller. All three expose the same surface:
 *
 *   start() / stop()
 *   send(message) -> Promise           publish a downlink to the device
 *   events: 'message' (msg, deviceId)  an uplink arrived
 *           'status'  ({ status, error?, detail? })
 *           'device'  (deviceId)       the device id was learned/changed
 *
 * LanTransport   – the controller's internal MQTT broker (port 1883,
 *                  username "fb", password = device PIN). Needs "Local
 *                  Access" enabled in the official app.
 * CloudTransport – myflameboss.com MQTT, username T-<user_id>, password =
 *                  auth token. Follows the device between cloud servers
 *                  using the user/<id>/recv "connected" directory messages.
 * SimTransport   – an in-process fake controller for demo mode and tests.
 */

const { EventEmitter } = require('events');
const mqtt = require('mqtt');

const DEVICE_TOPIC_RE = /^flameboss\/(\d+)\/send\/(data|open)$/;

const clientId = () => `egg-command-${Math.random().toString(16).slice(2, 10)}`;

const parseJson = (buf) => {
    try {
        return JSON.parse(buf.toString());
    } catch {
        return null;
    }
};

const deviceTopics = (id) => [`flameboss/${id}/send/data`, `flameboss/${id}/send/open`];

function describeMqttError(err) {
    if (!err) return 'Unknown error';
    const code = err.code;
    if (code === 4 || code === 5 || /not authorized|bad user name/i.test(err.message)) {
        return 'Authentication rejected – check the PIN / token';
    }
    if (code === 'ECONNREFUSED') return 'Connection refused – is Local Access turned on in the app?';
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Host unreachable – check the IP address';
    if (code === 'ENOTFOUND') return 'Host not found';
    return err.message || String(err);
}

class LanTransport extends EventEmitter {
    constructor({ host, pin, deviceId = null, port = 1883 }) {
        super();
        if (!host) throw new Error('LAN mode needs the controller IP address');
        if (!pin) throw new Error('LAN mode needs the device PIN');
        this.host = host;
        this.port = port;
        this.pin = String(pin);
        this.deviceId = deviceId ? Number(deviceId) : null;
        this.client = null;
    }

    start() {
        this.emit('status', { status: 'connecting', detail: `${this.host}:${this.port}` });
        this.client = mqtt.connect({
            host: this.host,
            port: this.port,
            protocol: 'mqtt',
            protocolVersion: 4,
            username: 'fb',
            password: this.pin,
            clientId: clientId(),
            connectTimeout: 8000,
            reconnectPeriod: 5000,
        });
        this.client.on('connect', () => {
            // Without a known device id, listen on a wildcard and learn it from
            // the first uplink. The controller's own broker only carries its
            // own topics, so this is unambiguous.
            const topics = this.deviceId ? deviceTopics(this.deviceId) : ['flameboss/+/send/data', 'flameboss/+/send/open'];
            this.client.subscribe(topics, (err) => {
                if (err) return this.emit('status', { status: 'error', error: describeMqttError(err) });
                this.emit('status', { status: 'connected', detail: `${this.host}:${this.port}` });
                if (this.deviceId) this.send({ name: 'sync' }).catch(() => {});
            });
        });
        this.client.on('message', (topic, payload) => {
            const m = DEVICE_TOPIC_RE.exec(topic);
            if (!m) return;
            const id = Number(m[1]);
            if (this.deviceId == null) {
                this.deviceId = id;
                this.emit('device', id);
                this.send({ name: 'sync' }).catch(() => {});
            } else if (id !== this.deviceId) {
                return;
            }
            const msg = parseJson(payload);
            if (msg) this.emit('message', msg, id);
        });
        this.client.on('error', (err) => this.emit('status', { status: 'error', error: describeMqttError(err) }));
        this.client.on('reconnect', () => this.emit('status', { status: 'connecting', detail: 'reconnecting' }));
        this.client.on('offline', () => this.emit('status', { status: 'connecting', detail: 'offline, retrying' }));
    }

    send(message) {
        return publish(this.client, this.deviceId, message);
    }

    async stop() {
        if (this.client) await this.client.endAsync(true).catch(() => {});
        this.client = null;
    }
}

function publish(client, deviceId, message) {
    return new Promise((resolve, reject) => {
        if (!client || !client.connected) return reject(new Error('Not connected to the controller'));
        if (deviceId == null) return reject(new Error('Device id not known yet – waiting for the first reading'));
        client.publish(`flameboss/${deviceId}/recv`, JSON.stringify(message), { qos: 0, retain: false }, (err) =>
            (err ? reject(err) : resolve()));
    });
}

class CloudTransport extends EventEmitter {
    /**
     * @param {object} opts
     * @param {number|string} opts.userId  numeric Flame Boss user id
     * @param {string} opts.token          MQTT token / auth_token
     * @param {number} [opts.deviceId]     pick one device; default = first announced
     * @param {string} [opts.host]         directory broker host
     * @param {boolean} [opts.tls]         mqtts on 8883 (default) or mqtt on 1883
     * @param {number} [opts.port]
     */
    constructor({ userId, token, deviceId = null, host = 'myflameboss.com', tls = true, port }) {
        super();
        if (!userId || !token) throw new Error('Cloud mode needs a Flame Boss user id and token – sign in first');
        this.userId = String(userId);
        this.token = String(token);
        this.deviceId = deviceId ? Number(deviceId) : null;
        this.host = host;
        this.tls = tls !== false;
        this.port = port || (this.tls ? 8883 : 1883);
        this.entry = null;        // directory connection (also a data connection)
        this.entryServer = null;  // FQDN the directory connection landed on
        this.data = null;         // separate data connection when the device lives elsewhere
        this.dataServer = null;
        this.devices = new Map(); // device_id -> server (as announced)
        this.stopped = false;
    }

    connect(host) {
        return mqtt.connect({
            host,
            port: this.port,
            protocol: this.tls ? 'mqtts' : 'mqtt',
            protocolVersion: 4,
            username: `T-${this.userId}`,
            password: this.token,
            clientId: clientId(),
            connectTimeout: 10000,
            reconnectPeriod: 5000,
        });
    }

    start() {
        this.emit('status', { status: 'connecting', detail: this.host });
        const c = this.connect(this.host);
        this.entry = c;
        c.on('connect', () => {
            c.subscribe(`user/${this.userId}/recv`, (err) => {
                if (err) return this.emit('status', { status: 'error', error: describeMqttError(err) });
                c.publish(`user/${this.userId}/send`, JSON.stringify({ name: 'connected' }));
                this.emit('status', { status: 'connected', detail: `${this.host} (waiting for device)` });
            });
            // Re-subscribe device topics after a reconnect of the entry link.
            if (this.deviceId != null && this.dataClient() === c) c.subscribe(deviceTopics(this.deviceId));
        });
        c.on('message', (topic, payload) => this.onMessage(c, topic, payload));
        this.wireErrors(c);
    }

    wireErrors(c) {
        c.on('error', (err) => this.emit('status', { status: 'error', error: describeMqttError(err) }));
        c.on('reconnect', () => this.emit('status', { status: 'connecting', detail: 'reconnecting' }));
    }

    dataClient() {
        return this.data || this.entry;
    }

    onMessage(conn, topic, payload) {
        if (topic === `user/${this.userId}/recv`) return this.onControl(parseJson(payload));
        const m = DEVICE_TOPIC_RE.exec(topic);
        if (!m || Number(m[1]) !== this.deviceId) return;
        const msg = parseJson(payload);
        if (msg) this.emit('message', msg, this.deviceId);
    }

    onControl(msg) {
        if (!msg || msg.name !== 'connected') return;
        if (msg.device_id == null) {
            this.entryServer = msg.server || this.host;
            return;
        }
        const id = Number(msg.device_id);
        this.devices.set(id, msg.server);
        if (this.deviceId == null) {
            this.deviceId = id;
            this.emit('device', id);
        }
        if (id === this.deviceId) this.route(msg.server);
    }

    /** Point the data path at whichever server currently hosts the device. */
    route(server) {
        const onEntry = !server || server === this.entryServer || server === this.host;
        const topics = deviceTopics(this.deviceId);
        if (onEntry) {
            if (this.data) {
                this.data.end(true);
                this.data = null;
                this.dataServer = null;
            }
            this.entry.subscribe(topics, () => this.afterRoute(this.entryServer || this.host));
            return;
        }
        if (this.data && this.dataServer === server) return;
        if (this.data) this.data.end(true);
        this.entry.unsubscribe(topics);
        this.dataServer = server;
        const d = this.connect(server);
        this.data = d;
        d.on('connect', () => d.subscribe(topics, () => this.afterRoute(server)));
        d.on('message', (topic, payload) => this.onMessage(d, topic, payload));
        this.wireErrors(d);
    }

    afterRoute(server) {
        this.emit('status', { status: 'connected', detail: `${server} · device ${this.deviceId}` });
        this.send({ name: 'sync' }).catch(() => {});
    }

    send(message) {
        return publish(this.dataClient(), this.deviceId, message);
    }

    async stop() {
        this.stopped = true;
        await Promise.all([this.entry, this.data].filter(Boolean).map((c) => c.endAsync(true).catch(() => {})));
        this.entry = null;
        this.data = null;
    }
}

/**
 * Fake controller. Speaks the same wire format as real hardware (decidegrees
 * C, -32767 for unplugged probes) so demo mode exercises the full pipeline,
 * including set-point changes and meat alarms.
 */
class SimTransport extends EventEmitter {
    constructor({ intervalMs = 2000, deviceId = 100001 } = {}) {
        super();
        this.intervalMs = intervalMs;
        this.deviceId = deviceId;
        this.timer = null;
        this.sim = {
            pit: 800,           // decideg C
            setTemp: 1072,      // 225 F
            meat: [650, 380, null],
            blower: 3000,
            labels: ['Pit', 'Pork Butt', 'Brisket', ''],
            alarms: [
                { sensor: 1, action: 'on', done_temp: 908, warm_temp: 656 },   // 195 F / 150 F
                { sensor: 2, action: 'on', done_temp: 950, warm_temp: 656 },   // 203 F
                { sensor: 3, action: 'off', done_temp: 900, warm_temp: 656 },
            ],
        };
    }

    start() {
        this.emit('status', { status: 'connected', detail: 'simulated controller' });
        this.emit('device', this.deviceId);
        setImmediate(() => this.sync());
        this.timer = setInterval(() => this.tick(), this.intervalMs);
    }

    up(msg) {
        this.emit('message', msg, this.deviceId);
    }

    sync() {
        const s = this.sim;
        this.up({ name: 'id', hw_id: 5, device_id: this.deviceId, uid: 'U0lNVUxBVE9S' });
        this.up({ name: 'labels', values: s.labels });
        this.up({ name: 'set_temp_limits', min: 656, max: 3433 });
        s.alarms.forEach((a) => this.up({ name: 'meat_alarm', ...a }));
        this.up({ name: 'state', value: 'run' });
        this.up({ name: 'set_temp', value: s.setTemp });
        this.tick();
        this.up({ name: 'synced' });
    }

    tick() {
        const s = this.sim;
        const err = s.setTemp - s.pit;
        s.blower = Math.max(0, Math.min(10000, Math.round(s.blower + err * 8)));
        s.pit += Math.round(err * 0.12 + (s.blower / 10000) * 6 - 3 + (Math.random() - 0.5) * 8);
        s.meat = s.meat.map((t, i) => {
            if (t == null) return null;
            const alarm = s.alarms[i];
            const hold = alarm.action === 'keep_warm' && t >= alarm.done_temp;
            const rise = hold ? 0 : Math.max(0, (s.pit - t) * 0.004 + Math.random() * 0.6);
            return Math.round(t + rise);
        });
        this.up({
            name: 'temps',
            cook_id: 1,
            sec: Math.floor(Date.now() / 1000),
            temps: [s.pit, ...s.meat.map((t) => (t == null ? -32767 : t))],
            set_temp: s.setTemp,
            blower: s.blower,
        });
    }

    async send(message) {
        const s = this.sim;
        setTimeout(() => {
            switch (message.name) {
                case 'sync': return this.sync();
                case 'set_temp':
                    if (message.value != null) s.setTemp = message.value;
                    return this.up({ name: 'set_temp', value: s.setTemp });
                case 'meat_alarm': {
                    const i = message.sensor - 1;
                    s.alarms[i] = { ...s.alarms[i], ...message };
                    delete s.alarms[i].name;
                    return this.up({ name: 'meat_alarm', ...s.alarms[i] });
                }
                case 'labels':
                    s.labels = message.values;
                    return this.up({ name: 'labels', values: s.labels });
                case 'alarm_ack':
                    return this.up({ name: 'sound', config: 'alarms', status: 'off' });
                default:
                    return undefined;
            }
        }, 150);
    }

    async stop() {
        clearInterval(this.timer);
        this.timer = null;
    }
}

module.exports = { LanTransport, CloudTransport, SimTransport, describeMqttError };
