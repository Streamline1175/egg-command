const test = require('node:test');
const assert = require('node:assert/strict');
const { DeviceSession } = require('../lib/flameboss/session');
const { startBroker, startFakeDevice, waitUntil } = require('./helpers');

const DEVICE = 123456;

test('LAN mode: learns device id, reads temps, set-point round trip', async (t) => {
    const broker = await startBroker({ fb: '4321' });
    const device = await startFakeDevice({ port: broker.port, username: 'fb', password: '4321', deviceId: DEVICE });
    const session = new DeviceSession({ historyGapMs: 0 });
    t.after(async () => {
        await session.close();
        await device.close();
        await broker.close();
    });

    await session.start({ mode: 'lan', lan: { host: '127.0.0.1', pin: '4321' } }, { port: broker.port });
    await waitUntil(() => session.connection.status === 'connected');
    await device.temps(1000);
    await waitUntil(() => session.device.pit === 100);

    assert.equal(session.device.deviceId, DEVICE);
    assert.equal(session.device.probes[0].temp, 60);
    assert.equal(session.device.probes[1].temp, null);
    assert.equal(session.device.blower, 50);
    assert.equal(session.history.length, 1);
    // Learning the device id triggers a sync request.
    await waitUntil(() => device.received.some((m) => m.name === 'sync'));
    await waitUntil(() => session.device.probes[0].label === 'Brisket');

    const r = await session.setPitTemp({ value: 275, unit: 'F' });
    assert.deepEqual(r.sent, { name: 'set_temp', value: 1350 });
    assert.equal(r.confirmed, true);
    assert.equal(session.device.setTemp, 135);
});

test('LAN mode: wrong PIN surfaces an authentication error', async (t) => {
    const broker = await startBroker({ fb: '4321' });
    const session = new DeviceSession();
    t.after(async () => {
        await session.close();
        await broker.close();
    });
    await session.start({ mode: 'lan', lan: { host: '127.0.0.1', pin: '9999' } }, { port: broker.port });
    await waitUntil(() => session.connection.status === 'error');
    assert.match(session.connection.error, /Authentication rejected/);
});

test('commands are refused while disconnected and when out of range', async (t) => {
    const session = new DeviceSession();
    t.after(() => session.close());
    await assert.rejects(session.setPitTemp({ value: 225, unit: 'F' }), /Not connected/);
    await session.start({ mode: 'demo' }, { intervalMs: 50 });
    await waitUntil(() => session.device.pit != null);
    await assert.rejects(session.setPitTemp({ value: 1200, unit: 'F' }), /outside the allowed range/);
});

test('demo mode: simulated controller honours set point and meat alarms', async (t) => {
    const session = new DeviceSession({ historyGapMs: 0 });
    t.after(() => session.close());
    await session.start({ mode: 'demo' }, { intervalMs: 50 });
    await waitUntil(() => session.device.probes[0].label === 'Pork Butt');
    const r = await session.setPitTemp({ value: 250, unit: 'F' });
    assert.equal(r.confirmed, true);
    const m = await session.setMeatAlarm({ sensor: 2, action: 'keep_warm', doneTemp: 205, unit: 'F' });
    assert.equal(m.confirmed, true);
    assert.equal(session.device.probes[1].alarm.action, 'keep_warm');
    await waitUntil(() => session.history.length >= 3);
});

test('cloud mode: directory announce, follows device to another server, commands reach it', async (t) => {
    // One broker reachable under two host spellings stands in for two Flame
    // Boss servers (same trick as flameboss/fb-api-doc sim_harness.py).
    const broker = await startBroker({ 'T-42': 'tok', dev: 'x' });
    const device = await startFakeDevice({ port: broker.port, username: 'dev', password: 'x', deviceId: DEVICE, topic: 'open' });
    const mqtt = require('mqtt');
    const directory = await mqtt.connectAsync({ host: '127.0.0.1', port: broker.port, username: 'dev', password: 'x' });
    await directory.subscribeAsync('user/42/send');
    directory.on('message', (topic, payload) => {
        if (JSON.parse(payload.toString()).name !== 'connected') return;
        directory.publish('user/42/recv', JSON.stringify({ name: 'connected', server: 'localhost' }));
        directory.publish('user/42/recv', JSON.stringify({ name: 'connected', device_id: DEVICE, server: '127.0.0.1' }));
    });
    const session = new DeviceSession();
    t.after(async () => {
        await session.close();
        await directory.endAsync(true);
        await device.close();
        await broker.close();
    });

    await session.start({ mode: 'cloud', cloud: { userId: 42, token: 'tok', host: 'localhost', tls: false } }, { port: broker.port });
    await waitUntil(() => session.device.deviceId === DEVICE);
    await waitUntil(() => session.transport.dataServer === '127.0.0.1');
    await waitUntil(() => /device 123456/.test(session.connection.detail || ''));
    await device.temps(1200);
    await waitUntil(() => session.device.pit === 120);

    const r = await session.setPitTemp({ value: 110, unit: 'C' });
    assert.equal(r.confirmed, true);
    assert.ok(device.received.some((m) => m.name === 'set_temp' && m.value === 1100));
});

test('cloud mode: bad token surfaces an authentication error', async (t) => {
    const broker = await startBroker({ 'T-42': 'tok' });
    const session = new DeviceSession();
    t.after(async () => {
        await session.close();
        await broker.close();
    });
    await session.start({ mode: 'cloud', cloud: { userId: 42, token: 'nope', host: '127.0.0.1', tls: false } }, { port: broker.port });
    await waitUntil(() => session.connection.status === 'error');
    assert.match(session.connection.error, /Authentication rejected/);
});

test('raw log redacts secrets the controller may send', () => {
    const session = new DeviceSession();
    session.onUplink({ name: 'wifi', ssid: 'home', key: 'hunter2' }, 1);
    session.onUplink({ name: 'id', device_id: 1, pin: 1234 }, 1);
    session.close();
    const text = JSON.stringify(session.rawLog);
    assert.ok(!text.includes('hunter2'));
    assert.ok(!text.includes('1234'));
    assert.ok(text.includes('home'));
});
