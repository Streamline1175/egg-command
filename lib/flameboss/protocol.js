/**
 * Flame Boss / EGG Genius message protocol.
 *
 * Reference: https://github.com/flameboss/fb-api-doc (fb-api.yml and
 * home-assistant/ARCHITECTURE.md). Every message is a JSON object with a
 * "name" property. Temperatures on the wire are decidegrees Celsius
 * (1072 -> 107.2 C -> 225 F) and -32767 means "probe not plugged in".
 * Blower duty cycle is 0-10000 (hundredths of a percent).
 *
 * This module is pure: it turns wire messages into dashboard state and
 * dashboard intents into wire messages. No I/O happens here.
 */

const NO_PROBE = -32767;

// Hard safety rails for the pit set point, applied even when the device has
// reported its own limits. Kamado cooking rarely needs more than ~700 F.
const HARD_MIN_C = 50;   // 122 F
const HARD_MAX_C = 370;  // ~700 F

const cToF = (c) => c * 9 / 5 + 32;
const fToC = (f) => (f - 32) * 5 / 9;

const decidegToC = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v === NO_PROBE) return null;
    return Math.round(v) / 10;
};

const cToDecideg = (c) => Math.round(c * 10);

const toCelsius = (value, unit) => (unit === 'F' ? fToC(value) : value);

function createInitialState() {
    return {
        deviceId: null,
        cookId: null,
        lastTempsAt: null,     // ms epoch of the last temps uplink
        pit: null,             // C
        setTemp: null,         // C
        blower: null,          // percent 0-100
        probes: [1, 2, 3].map((index) => ({
            index,
            temp: null,        // C, null when unplugged
            label: null,
            alarm: null,       // { action, doneTemp, warmTemp } in C
        })),
        pitLabel: null,
        setTempLimits: null,   // { min, max } in C
        pitAlarm: null,        // { enabled, range } (range in C deltas)
        state: null,           // idle | run | error | production
        sound: null,
        timer: null,
        localAccess: null,
        wifi: null,            // { rssi }
        alerts: [],            // recent alert events from the device
    };
}

function pushAlert(state, type, detail) {
    const alert = { type, at: Date.now(), ...detail };
    return [...state.alerts.slice(-19), alert];
}

/**
 * Apply one uplink message to the dashboard state. Returns a new state
 * object (or the same object if the message was not relevant).
 */
function applyMessage(state, msg, { deviceId } = {}) {
    if (!msg || typeof msg !== 'object' || typeof msg.name !== 'string') return state;
    const next = { ...state };
    if (deviceId != null && next.deviceId == null) next.deviceId = deviceId;

    switch (msg.name) {
        case 'temps': {
            const temps = Array.isArray(msg.temps) ? msg.temps : [];
            next.pit = decidegToC(temps[0]);
            next.probes = state.probes.map((p, i) => ({ ...p, temp: decidegToC(temps[i + 1]) }));
            if (msg.set_temp != null) next.setTemp = decidegToC(msg.set_temp);
            if (typeof msg.blower === 'number') next.blower = Math.max(0, Math.min(100, msg.blower / 100));
            if (msg.cook_id != null) next.cookId = msg.cook_id;
            next.lastTempsAt = Date.now();
            return next;
        }
        case 'set_temp':
            if (msg.value == null) return state;
            next.setTemp = decidegToC(msg.value);
            return next;
        case 'set_temp_limits':
            next.setTempLimits = { min: decidegToC(msg.min), max: decidegToC(msg.max) };
            return next;
        case 'labels': {
            const values = Array.isArray(msg.values) ? msg.values : [];
            next.pitLabel = values[0] || null;
            next.probes = state.probes.map((p, i) => ({ ...p, label: values[i + 1] || null }));
            return next;
        }
        case 'meat_alarm': {
            const idx = Number(msg.sensor) - 1;
            if (!(idx >= 0 && idx < 3)) return state;
            next.probes = state.probes.map((p, i) => (i !== idx ? p : {
                ...p,
                alarm: {
                    action: msg.action,
                    doneTemp: decidegToC(msg.done_temp),
                    warmTemp: decidegToC(msg.warm_temp),
                },
            }));
            return next;
        }
        case 'pit_alarm':
            next.pitAlarm = { enabled: !!msg.enabled, range: typeof msg.range === 'number' ? msg.range / 10 : null };
            return next;
        case 'state':
            next.state = msg.value || msg.type || null;
            return next;
        case 'sound':
            next.sound = { config: msg.config, status: msg.status };
            return next;
        case 'timer':
            next.timer = {
                action: msg.action,
                value: msg.value,
                hold: decidegToC(msg.hold),
                endsAt: msg.ends_at || null,
                status: msg.status,
            };
            return next;
        case 'local_access':
            next.localAccess = msg.value;
            return next;
        case 'wifi_cx':
            next.wifi = { rssi: msg.rssi ?? null, connected: msg.connected ?? true };
            return next;
        case 'id':
            if (msg.device_id != null) next.deviceId = msg.device_id;
            return next;
        case 'meat_alarm_triggered':
            next.alerts = pushAlert(state, 'meat_done', { sensor: msg.sensor });
            return next;
        case 'pit_alarm_triggered':
            next.alerts = pushAlert(state, 'pit_out_of_range', {});
            return next;
        case 'vent_advice':
            next.alerts = pushAlert(state, 'vent_advice', {});
            return next;
        case 'probe_overtemp':
            next.alerts = pushAlert(state, 'probe_overtemp', { sensor: msg.sensor });
            return next;
        case 'device_overtemp':
            next.alerts = pushAlert(state, 'device_overtemp', {});
            return next;
        default:
            return state;
    }
}

/**
 * Returns the effective [min, max] set-point range in C: the device's own
 * limits when they are plausible, always inside the hard safety rails.
 */
function setPointRange(state) {
    let min = HARD_MIN_C;
    let max = HARD_MAX_C;
    const lim = state && state.setTempLimits;
    if (lim && lim.min != null && lim.max != null && lim.min < lim.max) {
        min = Math.max(min, lim.min);
        max = Math.min(max, lim.max);
    }
    return { min, max };
}

class CommandError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CommandError';
    }
}

function requireNumber(value, what) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n)) throw new CommandError(`${what} must be a number`);
    return n;
}

function requireUnit(unit) {
    if (unit !== 'F' && unit !== 'C') throw new CommandError('unit must be "F" or "C"');
    return unit;
}

/** Build a set_temp downlink. Throws CommandError when out of range. */
function buildSetTemp(state, { value, unit }) {
    const c = toCelsius(requireNumber(value, 'value'), requireUnit(unit));
    const { min, max } = setPointRange(state);
    if (c < min - 0.05 || c > max + 0.05) {
        throw new CommandError(
            `Set point ${Math.round(unit === 'F' ? cToF(c) : c)}°${unit} is outside the allowed range ` +
            `${Math.round(unit === 'F' ? cToF(min) : min)}–${Math.round(unit === 'F' ? cToF(max) : max)}°${unit}`,
        );
    }
    return { name: 'set_temp', value: cToDecideg(c) };
}

const MEAT_ACTIONS = ['off', 'on', 'keep_warm'];

/** Build a meat_alarm downlink for one probe (sensor 1-3). */
function buildMeatAlarm(state, { sensor, action, doneTemp, warmTemp, unit }) {
    const s = Number(sensor);
    if (![1, 2, 3].includes(s)) throw new CommandError('sensor must be 1, 2 or 3');
    if (!MEAT_ACTIONS.includes(action)) throw new CommandError(`action must be one of ${MEAT_ACTIONS.join(', ')}`);
    requireUnit(unit);
    const existing = state?.probes?.[s - 1]?.alarm || {};
    const doneC = doneTemp != null ? toCelsius(requireNumber(doneTemp, 'doneTemp'), unit) : existing.doneTemp;
    const warmC = warmTemp != null ? toCelsius(requireNumber(warmTemp, 'warmTemp'), unit) : existing.warmTemp;
    if (doneC == null) throw new CommandError('doneTemp is required');
    if (doneC < 0 || doneC > 150) throw new CommandError('doneTemp is outside 32–302°F');
    const warm = warmC ?? Math.min(doneC, fToC(150));
    if (warm < 0 || warm > 150) throw new CommandError('warmTemp is outside 32–302°F');
    return {
        name: 'meat_alarm',
        sensor: s,
        action,
        done_temp: cToDecideg(doneC),
        warm_temp: cToDecideg(warm),
    };
}

module.exports = {
    NO_PROBE,
    HARD_MIN_C,
    HARD_MAX_C,
    cToF,
    fToC,
    decidegToC,
    cToDecideg,
    createInitialState,
    applyMessage,
    setPointRange,
    buildSetTemp,
    buildMeatAlarm,
    CommandError,
};
