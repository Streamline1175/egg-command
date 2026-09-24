const net = require('net');
const mqtt = require('mqtt');

/** Start an in-process MQTT broker. `users` maps username -> password. */
async function startBroker(users) {
    const aedes = require('aedes');
    const broker = aedes.createBroker ? await aedes.createBroker() : aedes();
    broker.authenticate = (client, username, password, cb) => {
        const ok = users[username] !== undefined && password && password.toString() === users[username];
        if (ok) return cb(null, true);
        const err = new Error('Not authorized');
        err.returnCode = 5;
        return cb(err, false);
    };
    const server = net.createServer(broker.handle);
    await new Promise((r) => server.listen(0, r));
    return {
        port: server.address().port,
        async close() {
            await new Promise((r) => broker.close(r));
            await new Promise((r) => server.close(r));
        },
    };
}

/**
 * A fake controller on the broker: publishes temps and echoes set-point and
 * meat-alarm changes back as uplinks, like the real firmware.
 */
async function startFakeDevice({ port, host = '127.0.0.1', username, password, deviceId, topic = 'data' }) {
    const client = await mqtt.connectAsync({ host, port, username, password, protocolVersion: 4 });
    const received = [];
    let setTemp = 1072;
    const up = (msg) => client.publishAsync(`flameboss/${deviceId}/send/${topic}`, JSON.stringify(msg));
    client.on('message', (t, payload) => {
        const msg = JSON.parse(payload.toString());
        received.push(msg);
        if (msg.name === 'set_temp' && msg.value != null) {
            setTemp = msg.value;
            up({ name: 'set_temp', value: setTemp });
        }
        if (msg.name === 'sync') up({ name: 'labels', values: ['Pit', 'Brisket', '', ''] });
        if (msg.name === 'meat_alarm') up(msg);
    });
    await client.subscribeAsync(`flameboss/${deviceId}/recv`);
    const temps = (pit = 1000) => up({ name: 'temps', cook_id: 7, sec: 1, temps: [pit, 600, -32767, -32767], set_temp: setTemp, blower: 5000 });
    return { client, received, temps, close: () => client.endAsync(true) };
}

const waitUntil = async (fn, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const v = await fn();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('waitUntil timed out');
};

module.exports = { startBroker, startFakeDevice, waitUntil };
