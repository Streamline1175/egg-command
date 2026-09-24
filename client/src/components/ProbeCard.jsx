import React, { useMemo, useState } from 'react';
import { Clock, TrendingUp, Pencil, Unplug } from 'lucide-react';
import { Card, Button, inputClass } from './ui';
import { fmt, toUnit } from '../lib/units';
import { predictFinish } from '../lib/predict';
import { postJSON } from '../lib/api';

export const PROBE_COLORS = ['#F59E0B', '#38BDF8', '#E879F9'];

const ACTIONS = [
  { value: 'on', label: 'Alert when done' },
  { value: 'keep_warm', label: 'Alert + keep warm' },
  { value: 'off', label: 'No alert' },
];

function TargetEditor({ probe, unit, onClose }) {
  const alarm = probe.alarm || {};
  const [done, setDone] = useState(alarm.doneTemp != null ? Math.round(toUnit(alarm.doneTemp, unit)) : unit === 'F' ? 203 : 95);
  const [action, setAction] = useState(alarm.action && alarm.action !== 'off' ? alarm.action : 'on');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJSON('/api/control/meat-alarm', { sensor: probe.index, action, doneTemp: done, unit });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-gray-700 pt-3">
      <div className="flex gap-2">
        <input type="number" inputMode="numeric" className={`${inputClass} w-24`} value={done} onChange={(e) => setDone(Number(e.target.value))} />
        <select className={inputClass} value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save ${done}°${unit}`}</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function Estimate({ prediction }) {
  if (!prediction) return null;
  const text = {
    done: 'Done',
    stalled: 'Stalled',
    waiting: 'Gathering data…',
    eta: prediction.eta && prediction.eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  }[prediction.status];
  return (
    <div className="mb-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-2 flex items-center justify-between">
      <span className="text-xs text-indigo-300 font-medium flex items-center gap-1"><Clock size={12} /> Estimated done</span>
      <span className="text-xs font-bold text-indigo-200">{text}</span>
    </div>
  );
}

export default function ProbeCard({ probe, history, unit, canControl }) {
  const [editing, setEditing] = useState(false);
  const color = PROBE_COLORS[probe.index - 1];
  const target = probe.alarm && probe.alarm.action !== 'off' ? probe.alarm.doneTemp : null;
  const prediction = useMemo(
    () => (probe.temp != null && target != null ? predictFinish(history, probe.index - 1, target) : null),
    [history, probe.temp, target, probe.index],
  );
  const name = probe.label || `Meat ${probe.index}`;

  if (probe.temp == null) {
    return (
      <Card className="p-4 flex items-center justify-between text-gray-500">
        <span className="font-medium">{name}</span>
        <span className="text-xs flex items-center gap-1"><Unplug size={14} /> Not plugged in</span>
      </Card>
    );
  }

  const pct = target ? Math.max(0, Math.min(100, (probe.temp / target) * 100)) : 0;

  return (
    <Card className="p-4">
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={16} style={{ color }} />
          <span className="font-bold text-gray-200 truncate">{name}</span>
        </div>
        <span className="text-2xl font-bold text-white tabular-nums">{fmt(probe.temp, unit)}</span>
      </div>
      <Estimate prediction={prediction} />
      <div className="space-y-1">
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>{probe.alarm?.action === 'keep_warm' ? 'Keep warm at target' : 'Target'}</span>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-white disabled:opacity-50 p-1 -m-1"
            onClick={() => setEditing((v) => !v)}
            disabled={!canControl}
          >
            {target != null ? fmt(target, unit) : 'Set target'} <Pencil size={12} />
          </button>
        </div>
        <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
      {editing && <TargetEditor probe={probe} unit={unit} onClose={() => setEditing(false)} />}
    </Card>
  );
}
