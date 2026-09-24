/**
 * DeviceSession glues a transport to dashboard state: it folds uplinks into
 * state, keeps a rolling temperature history, confirms commands by reading
 * the result back from the controller, and flags stale data.
 */

const { EventEmitter } = require('events');
const protocol = require('./protocol');
const { LanTransport, CloudTransport, SimTransport } = require('./transports');

const HISTORY_LIMIT = 12 * 60 * 12;   // 12 h at one sample per 5 s
const HISTORY_MIN_GAP_MS = 5000;
const STALE_AFTER_MS = 90 * 1000;
const RAW_LOG_LIMIT = 50;
const CONFIRM_TIMEOUT_MS = 10000;

// Some uplinks carry secrets (wifi -> key, id -> pin in AP mode). Keep them
// out of the raw log, which is served to any browser on the network.
const SECRET_FIELDS = ['key', 'pin', 'password', 'token'];
const redact = (msg) => {
    if (!SECRET_FIELDS.some((f) => f in msg)) return msg;
    const out = { ...msg };
    for (const f of SECRET_FIELDS) if (f in out) out[f] = '[redacted]';
    return out;
};

function createTransport(config, overrides = {}) {
    switch (config.mode) {
        case 'lan':
            return new LanTransport({ host: config.lan.host, pin: config.lan.pin, deviceId: config.deviceId, ...overrides });
        case 'cloud':
            return new CloudTransport({
                userId: config.cloud.userId,
                token: config.cloud.token,
                deviceId: config.deviceId,
                host: config.cloud.host,
                tls: config.cloud.tls,
                ...overrides,
            });
        case 'demo':
        default:
            return new SimTransport(overrides);
    }
}

class DeviceSession extends EventEmitter {
    constructor({ transportFactory = createTransport, historyGapMs = HISTORY_MIN_GAP_MS, staleAfterMs = STALE_AFTER_MS } = {}) {
        super();
        this.transportFactory = transportFactory;
        this.historyGapMs = historyGapMs;
        this.staleAfterMs = staleAfterMs;
        this.transport = null;
        this.mode = null;
        this.connection = { status: 'disconnected', error: null, detail: null };
        this.device = protocol.createInitialState();
        this.history = [];
        this.rawLog = [];
        this.waiters = new Set();
        this.staleTimer = setInterval(() => this.checkStale(), 5000);
        this.staleTimer.unref?.();
        this.stale = false;
    }

    snapshot({ includeHistory = true } = {}) {
        return {
            mode: this.mode,
            connection: this.connection,
            stale: this.stale,
            device: this.device,
            setPointRange: protocol.setPointRange(this.device),
            ...(includeHistory ? { history: this.history } : {}),
        };
    }

    async start(config, overrides) {
        await this.stop();
        this.mode = config.mode || 'demo';
        this.device = protocol.createInitialState();
        this.history = [];
        this.stale = false;
        this.setConnection({ status: 'connecting', error: null, detail: null });
        let transport;
        try {
            transport = this.transportFactory(config, overrides);
        } catch (err) {
            this.setConnection({ status: 'error', error: err.message, detail: null });
            return;
        }
        this.transport = transport;
        transport.on('status', (s) => this.setConnection({ error: null, detail: null, ...s }));
        transport.on('device', (id) => this.update({ ...this.device, deviceId: id }));
        transport.on('message', (msg, id) => this.onUplink(msg, id));
        transport.start();
    }

    async stop() {
        const t = this.transport;
        this.transport = null;
        if (t) {
            t.removeAllListeners();
            await t.stop();
        }
        this.setConnection({ status: 'disconnected', error: null, detail: null });
    }

    async close() {
        clearInterval(this.staleTimer);
        await this.stop();
    }

    setConnection(next) {
        this.connection = { ...this.connection, ...next };
        this.emit('change', { type: 'connection' });
    }

    update(device) {
        this.device = device;
        this.emit('change', { type: 'device' });
    }

    onUplink(msg, deviceId) {
        this.rawLog = [...this.rawLog.slice(-(RAW_LOG_LIMIT - 1)), { at: Date.now(), msg: redact(msg) }];
        const next = protocol.applyMessage(this.device, msg, { deviceId });
        if (next !== this.device) this.update(next);
        if (msg.name === 'temps') this.recordHistory(next);
        if (this.stale) {
            this.stale = false;
            this.emit('change', { type: 'connection' });
        }
        for (const w of this.waiters) w(msg);
    }

    recordHistory(d) {
        const now = Date.now();
        const last = this.history[this.history.length - 1];
        if (last && now - last.t < this.historyGapMs) return;
        const sample = {
            t: now,
            pit: d.pit,
            set: d.setTemp,
            fan: d.blower,
            p: d.probes.map((p) => p.temp),
        };
        this.history.push(sample);
        if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
        this.emit('sample', sample);
    }

    checkStale() {
        const last = this.device.lastTempsAt;
        const stale = this.connection.status === 'connected' && last != null && Date.now() - last > this.staleAfterMs;
        if (stale !== this.stale) {
            this.stale = stale;
            this.emit('change', { type: 'connection' });
        }
    }

    /** Resolves true when predicate(msg) matches an uplink before the timeout. */
    waitFor(predicate, timeoutMs = CONFIRM_TIMEOUT_MS) {
        return new Promise((resolve) => {
            const done = (ok) => {
                clearTimeout(timer);
                this.waiters.delete(waiter);
                resolve(ok);
            };
            const waiter = (msg) => { if (predicate(msg)) done(true); };
            const timer = setTimeout(() => done(false), timeoutMs);
            this.waiters.add(waiter);
        });
    }

    async send(message, confirm) {
        if (!this.transport) throw new protocol.CommandError('Not connected – pick a data source in Settings');
        if (this.connection.status !== 'connected') throw new protocol.CommandError(`Controller is ${this.connection.status}`);
        const confirmed = confirm ? this.waitFor(confirm) : Promise.resolve(null);
        await this.transport.send(message);
        return { sent: message, confirmed: await confirmed };
    }

    async setPitTemp({ value, unit }) {
        const msg = protocol.buildSetTemp(this.device, { value, unit });
        // Confirmed once the controller reports the new set point back.
        return this.send(msg, (m) => (m.name === 'set_temp' && m.value === msg.value)
            || (m.name === 'temps' && m.set_temp === msg.value));
    }

    async setMeatAlarm(args) {
        const msg = protocol.buildMeatAlarm(this.device, args);
        return this.send(msg, (m) => m.name === 'meat_alarm' && m.sensor === msg.sensor && m.done_temp === msg.done_temp);
    }

    async ackAlarm() {
        return this.send({ name: 'alarm_ack' });
    }

    async sync() {
        return this.send({ name: 'sync' });
    }
}

module.exports = { DeviceSession, createTransport };
