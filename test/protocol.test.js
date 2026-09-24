const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../lib/flameboss/protocol');

test('temps uplink: decidegrees C, -32767 = unplugged, blower /100', () => {
    const s = p.applyMessage(p.createInitialState(), {
        name: 'temps', cook_id: 1380, sec: 1784920711,
        temps: [1072, 710, -32767, -32767], set_temp: 1072, blower: 2500,
    });
    assert.equal(s.pit, 107.2);
    assert.equal(Math.round(p.cToF(s.pit)), 225);
    assert.equal(s.setTemp, 107.2);
    assert.equal(s.blower, 25);
    assert.deepEqual(s.probes.map((x) => x.temp), [71, null, null]);
    assert.equal(s.cookId, 1380);
    assert.ok(s.lastTempsAt);
});

test('labels, meat alarm and limits uplinks', () => {
    let s = p.createInitialState();
    s = p.applyMessage(s, { name: 'labels', values: ['Pit', 'Brisket', 'Butt', ''] });
    s = p.applyMessage(s, { name: 'meat_alarm', sensor: 2, action: 'keep_warm', done_temp: 950, warm_temp: 656 });
    s = p.applyMessage(s, { name: 'set_temp_limits', min: 656, max: 3433 });
    assert.equal(s.pitLabel, 'Pit');
    assert.deepEqual(s.probes.map((x) => x.label), ['Brisket', 'Butt', null]);
    assert.deepEqual(s.probes[1].alarm, { action: 'keep_warm', doneTemp: 95, warmTemp: 65.6 });
    assert.deepEqual(s.setTempLimits, { min: 65.6, max: 343.3 });
});

test('irrelevant or malformed messages leave state untouched', () => {
    const s = p.createInitialState();
    assert.equal(p.applyMessage(s, null), s);
    assert.equal(p.applyMessage(s, { nope: 1 }), s);
    assert.equal(p.applyMessage(s, { name: 'dl_progress', percent: 4 }), s);
    assert.equal(p.applyMessage(s, { name: 'meat_alarm', sensor: 9 }), s);
});

test('alerts are recorded and capped', () => {
    let s = p.createInitialState();
    for (let i = 0; i < 30; i++) s = p.applyMessage(s, { name: 'meat_alarm_triggered', sensor: 1 });
    assert.equal(s.alerts.length, 20);
    assert.equal(s.alerts[0].type, 'meat_done');
});

test('buildSetTemp converts F to decidegrees C', () => {
    const s = p.createInitialState();
    assert.deepEqual(p.buildSetTemp(s, { value: 225, unit: 'F' }), { name: 'set_temp', value: 1072 });
    assert.deepEqual(p.buildSetTemp(s, { value: 275, unit: 'F' }), { name: 'set_temp', value: 1350 });
    assert.deepEqual(p.buildSetTemp(s, { value: 120, unit: 'C' }), { name: 'set_temp', value: 1200 });
});

test('buildSetTemp enforces hard rails and device limits', () => {
    const s = p.createInitialState();
    assert.throws(() => p.buildSetTemp(s, { value: 900, unit: 'F' }), p.CommandError);
    assert.throws(() => p.buildSetTemp(s, { value: 50, unit: 'F' }), p.CommandError);
    assert.throws(() => p.buildSetTemp(s, { value: 'abc', unit: 'F' }), /must be a number/);
    assert.throws(() => p.buildSetTemp(s, { value: 225, unit: 'K' }), /unit/);
    const limited = p.applyMessage(s, { name: 'set_temp_limits', min: 656, max: 2000 }); // 150-392 F
    assert.throws(() => p.buildSetTemp(limited, { value: 450, unit: 'F' }), /outside the allowed range/);
    assert.doesNotThrow(() => p.buildSetTemp(limited, { value: 390, unit: 'F' }));
});

test('buildMeatAlarm validates and converts', () => {
    const s = p.createInitialState();
    assert.deepEqual(
        p.buildMeatAlarm(s, { sensor: 1, action: 'on', doneTemp: 203, warmTemp: 150, unit: 'F' }),
        { name: 'meat_alarm', sensor: 1, action: 'on', done_temp: 950, warm_temp: 656 },
    );
    assert.throws(() => p.buildMeatAlarm(s, { sensor: 4, action: 'on', doneTemp: 200, unit: 'F' }), /sensor/);
    assert.throws(() => p.buildMeatAlarm(s, { sensor: 1, action: 'boost', doneTemp: 200, unit: 'F' }), /action/);
    assert.throws(() => p.buildMeatAlarm(s, { sensor: 1, action: 'on', unit: 'F' }), /doneTemp is required/);
    assert.throws(() => p.buildMeatAlarm(s, { sensor: 1, action: 'on', doneTemp: 500, unit: 'F' }), /outside/);
});
