import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toUnit } from '../lib/units';
import { PROBE_COLORS } from './ProbeCard';

const HEIGHT = 180;
const PAD = 24;
const MAX_POINTS = 300;

const RANGES = [
  { label: '30m', ms: 30 * 60000 },
  { label: '2h', ms: 2 * 3600000 },
  { label: 'All', ms: Infinity },
];

function downsample(rows, max) {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
  out.push(rows[rows.length - 1]);
  return out;
}

export default function TempChart({ history, unit, probes }) {
  const [rangeMs, setRangeMs] = useState(RANGES[1].ms);
  const [hover, setHover] = useState(null);
  // Draw in real pixels (not a scaled viewBox) so labels stay legible on phones.
  const boxRef = useRef(null);
  const [WIDTH, setWidth] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    if (!history.length) return [];
    const end = history[history.length - 1].t;
    return downsample(history.filter((s) => s.t >= end - rangeMs), MAX_POINTS);
  }, [history, rangeMs]);

  const series = useMemo(() => {
    const s = [{ key: 'pit', color: '#10B981', label: 'Pit', get: (d) => d.pit }];
    probes.forEach((p, i) => {
      if (data.some((d) => d.p[i] != null)) s.push({ key: `p${i}`, color: PROBE_COLORS[i], label: p.label || `Meat ${i + 1}`, get: (d) => d.p[i] });
    });
    return s;
  }, [data, probes]);

  if (data.length < 2) {
    return <div ref={boxRef} key="chart" className="h-44 flex items-center justify-center text-gray-600 text-sm">Waiting for data…</div>;
  }

  const values = data.flatMap((d) => [d.pit, d.set, ...d.p]).filter((v) => v != null).map((v) => toUnit(v, unit));
  const lo = Math.floor((Math.min(...values) - 10) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 10) / 10) * 10;
  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const x = (t) => PAD + ((t - t0) / (t1 - t0 || 1)) * (WIDTH - PAD * 2);
  const y = (c) => HEIGHT - PAD - ((toUnit(c, unit) - lo) / (hi - lo || 1)) * (HEIGHT - PAD * 2);

  const path = (get) => {
    let d = '';
    let pen = false;
    for (const row of data) {
      const v = get(row);
      if (v == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(row.t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  // Pointer events cover mouse, touch and pen, so the tooltip works on phones.
  const onPointer = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const t = t0 + ((sx - PAD) / (WIDTH - PAD * 2)) * (t1 - t0);
    let best = data[0];
    for (const d of data) if (Math.abs(d.t - t) < Math.abs(best.t - t)) best = d;
    setHover({ row: best, left: ((x(best.t) / WIDTH) * 100) });
  };

  return (
    <div ref={boxRef} key="chart">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap gap-3 text-xs">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-gray-300">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
          <span className="flex items-center gap-1 text-gray-400"><span className="w-3 border-t border-dashed border-red-400" /> Set</span>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.label} type="button" onClick={() => setRangeMs(r.ms)} className={`px-2 py-1 text-xs rounded ${rangeMs === r.ms ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block w-full touch-pan-y"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
        >
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD - ((v - lo) / (hi - lo)) * (HEIGHT - PAD * 2)} y2={HEIGHT - PAD - ((v - lo) / (hi - lo)) * (HEIGHT - PAD * 2)} stroke="#374151" strokeWidth="0.5" />
              <text x={2} y={HEIGHT - PAD - ((v - lo) / (hi - lo)) * (HEIGHT - PAD * 2) + 3} fill="#6B7280" fontSize="10">{Math.round(v)}°</text>
            </g>
          ))}
          <path d={path((d) => d.set)} fill="none" stroke="#F87171" strokeWidth="1.5" strokeDasharray="4 4" />
          {series.map((s) => <path key={s.key} d={path(s.get)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}
          {hover && <line x1={x(hover.row.t)} x2={x(hover.row.t)} y1={PAD} y2={HEIGHT - PAD} stroke="#9CA3AF" strokeWidth="1" />}
        </svg>
        {hover && (
          <div
            className="absolute top-0 pointer-events-none bg-black/80 text-white text-xs rounded px-2 py-1 whitespace-nowrap"
            style={{ left: `${hover.left}%`, transform: `translateX(${hover.left > 60 ? '-105%' : '5%'})` }}
          >
            <div className="text-gray-400">{new Date(hover.row.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            {series.map((s) => {
              const v = s.get(hover.row);
              return v == null ? null : <div key={s.key} style={{ color: s.color }}>{s.label}: {Math.round(toUnit(v, unit))}°</div>;
            })}
            {hover.row.fan != null && <div className="text-gray-300">Fan: {Math.round(hover.row.fan)}%</div>}
          </div>
        )}
      </div>
    </div>
  );
}
