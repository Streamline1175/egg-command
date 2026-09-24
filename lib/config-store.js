/**
 * Persists connection settings to data/config.json (git-ignored) so the
 * server reconnects to the controller after a restart. Secrets (PIN, token)
 * stay on the server; the browser only ever sees whether they are set.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    mode: 'demo',
    deviceId: null,
    lan: { host: '', pin: '' },
    cloud: { userId: null, token: '', username: null, host: 'myflameboss.com', tls: true },
};

class ConfigStore {
    constructor(file = process.env.EGG_CONFIG || path.join(__dirname, '..', 'data', 'config.json')) {
        this.file = file;
        this.config = this.load();
    }

    load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            return {
                ...DEFAULTS,
                ...raw,
                lan: { ...DEFAULTS.lan, ...raw.lan },
                cloud: { ...DEFAULTS.cloud, ...raw.cloud },
            };
        } catch {
            return structuredClone(DEFAULTS);
        }
    }

    get() {
        return this.config;
    }

    update(patch) {
        const c = this.config;
        this.config = {
            ...c,
            ...patch,
            lan: { ...c.lan, ...(patch.lan || {}) },
            cloud: { ...c.cloud, ...(patch.cloud || {}) },
        };
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.config, null, 2), { mode: 0o600 });
        return this.config;
    }

    /** Settings safe to show in the browser. */
    publicView() {
        const c = this.config;
        return {
            mode: c.mode,
            deviceId: c.deviceId,
            lan: { host: c.lan.host, hasPin: !!c.lan.pin },
            cloud: { userId: c.cloud.userId, username: c.cloud.username, signedIn: !!c.cloud.token, tls: c.cloud.tls },
        };
    }
}

module.exports = { ConfigStore, DEFAULTS };
