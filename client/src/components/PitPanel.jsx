import React, { useEffect, useState } from 'react';
import { Activity, Fan, Minus, Plus, Check } from 'lucide-react';
import { Card, Button } from './ui';
import { fmt, toUnit, fromUnit } from '../lib/units';
import { postJSON } from '../lib/api';

const TempGauge = ({ current, target, unit }) => {
  const radius = 90;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const max = unit === 'F' ? 700 : 370;
  const cur = toUnit(current, unit);
  const frac = cur == null ? 0 : Math.max(0, Math.min(1, cur / max));
  const offset = circumference - frac * circumference * 0.75;

  const delta = current != null && target != null ? current - target : 0;
  const color = current == null ? 'text-gray-500' : delta > 6 ? 'text-red-500' : delta < -6 ? 'text-blue-500' : 'text-green-500';
  const label = current == null ? 'NO PROBE' : Math.abs(delta) < 3 ? 'LOCKED' : delta < 0 ? 'HEATING' : 'COOLING';

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="rotate-[135deg]">
        <circle stroke="currentColor" fill="transparent" strokeWidth={stroke} strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`} r={normalizedRadius} cx={radius} cy={radius} className="text-gray-800" strokeLinecap="round" />
        <circle stroke="currentColor" fill="transparent" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={offset} r={normalizedRadius} cx={radius} cy={radius} className={`${color} transition-all duration-1000 ease-out`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">{label}</span>
        <span className={`text-3xl md:text-4xl font-bold ${color} tabular-nums leading-none`}>{fmt(current, unit)}</span>
        <span className="text-gray-500 text-sm mt-1 flex items-center gap-1"><Activity size={12} /> Set: {fmt(target, unit)}</span>
      </div>
    </div>
  );
};

const FanMeter = ({ speed }) => {
  const pct = speed == null ? 0 : Math.round(speed);
  return (
    <div className="flex items-center gap-4 w-full">
      <div className={`p-3 rounded-full ${pct > 0 ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
        <Fan size={24} className={pct > 0 ? 'animate-spin' : ''} style={{ animationDuration: `${Math.max(400, 3000 - pct * 25)}ms` }} />
      </div>
      <div className="flex-1">
        <div className="flex justify-between mb-1">
          <span className="text-sm font-medium text-gray-400">Fan Output</span>
          <span className="text-sm font-bold text-white">{speed == null ? '--' : `${pct}%`}</span>
        </div>
        <div className="h-3 w-full bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-600 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
};

// Changes bigger than this ask for confirmation first.
const CONFIRM_DELTA_F = 50;

function SetPointControl({ setTemp, range, unit, canControl }) {
  const current = setTemp == null ? null : Math.round(toUnit(setTemp, unit));
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // Follow the controller when nothing is being edited.
  useEffect(() => {
    if (!busy) setDraft(current);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const min = Math.ceil(toUnit(range.min, unit));
  const max = Math.floor(toUnit(range.max, unit));
  const step = 5;
  const dirty = draft != null && draft !== current;
  const bump = (d) => setDraft((v) => Math.max(min, Math.min(max, Math.round(((v ?? current ?? min) + d) / step) * step)));

  const apply = async () => {
    const deltaF = unit === 'F' ? Math.abs(draft - current) : Math.abs(draft - current) * 1.8;
    if (current != null && deltaF > CONFIRM_DELTA_F
      && !window.confirm(`Change pit set point from ${current}°${unit} to ${draft}°${unit}?`)) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await postJSON('/api/control/set-temp', { value: draft, unit });
      setResult(r.confirmed ? { ok: true, text: 'Controller confirmed' } : { ok: true, text: 'Sent – waiting for controller' });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="text-xs text-gray-500 uppercase font-bold mb-2">Pit set point</div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="lg" className="px-4" onClick={() => bump(-step)} disabled={!canControl || busy} aria-label="Lower set point"><Minus size={18} /></Button>
        <div className="flex-1 flex items-center justify-center bg-gray-950 border border-gray-800 rounded-xl h-12">
          <input
            type="number"
            inputMode="numeric"
            className="w-20 bg-transparent text-center text-2xl font-bold tabular-nums focus:outline-none"
            value={draft ?? ''}
            min={min}
            max={max}
            disabled={!canControl || busy}
            onChange={(e) => setDraft(e.target.value === '' ? null : Number(e.target.value))}
          />
          <span className="text-gray-500">°{unit}</span>
        </div>
        <Button variant="secondary" size="lg" className="px-4" onClick={() => bump(step)} disabled={!canControl || busy} aria-label="Raise set point"><Plus size={18} /></Button>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <Button className="flex-1" onClick={apply} disabled={!canControl || busy || !dirty || draft < min || draft > max}>
          <Check size={16} /> {busy ? 'Sending…' : dirty ? `Set ${draft}°${unit}` : 'Set point'}
        </Button>
        {dirty && !busy && <Button variant="ghost" onClick={() => setDraft(current)}>Cancel</Button>}
      </div>
      <div className="text-xs mt-2 min-h-[1rem]">
        {result
          ? <span className={result.ok ? 'text-green-400' : 'text-red-400'}>{result.text}</span>
          : <span className="text-gray-600">Allowed {min}–{max}°{unit}</span>}
      </div>
    </div>
  );
}

export default function PitPanel({ device, range, unit, canControl }) {
  const delta = device.pit != null && device.setTemp != null ? Math.abs(device.pit - device.setTemp) : null;
  return (
    <Card className="flex flex-col items-center relative overflow-hidden h-full">
      <div className={`absolute top-0 w-full h-1 bg-gradient-to-r from-transparent to-transparent opacity-75 ${delta != null && delta < 6 ? 'via-green-500' : 'via-red-500'}`} />
      <div className="w-full flex justify-between items-center mb-4">
        <span className="font-bold text-gray-400 text-sm tracking-wider">{(device.pitLabel || 'Pit').toUpperCase()}</span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${device.blower > 0 ? 'bg-green-900 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
          {device.blower > 0 ? 'FAN ACTIVE' : 'FAN IDLE'}
        </span>
      </div>
      <TempGauge current={device.pit} target={device.setTemp} unit={unit} />
      <div className="w-full mt-4 space-y-6">
        <FanMeter speed={device.blower} />
        <SetPointControl setTemp={device.setTemp} range={range} unit={unit} canControl={canControl} />
      </div>
    </Card>
  );
}
