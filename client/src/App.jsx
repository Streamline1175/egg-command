import React, { useEffect, useRef, useState } from 'react';
import { Settings, Flame, Mic, MicOff, AlertTriangle, BellOff, RefreshCw } from 'lucide-react';
import { Card, Button } from './components/ui';
import PitPanel from './components/PitPanel';
import ProbeCard from './components/ProbeCard';
import TempChart from './components/TempChart';
import SettingsPanel from './components/SettingsPanel';
import { useDevice } from './hooks/useDevice';
import { postJSON } from './lib/api';

/**
 * EGG COMMAND
 * Live dashboard and control for EGG Genius / Flame Boss controllers.
 * The server (server.js) holds the controller connection; this UI renders
 * its state from /api/events and sends commands to /api/control/*.
 */

const readPref = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch { /* private mode */ }
};

const speak = (text) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
};

const ALERT_TEXT = {
  meat_done: (a, device) => `${device.probes[a.sensor - 1]?.label || `Meat probe ${a.sensor}`} is done`,
  pit_out_of_range: () => 'Pit temperature is out of range',
  vent_advice: () => 'Pit has been running hot. Consider closing the top vent',
  probe_overtemp: (a) => `Probe ${a.sensor} is over temperature`,
  device_overtemp: () => 'Controller is overheating',
};

function StatusPill({ state, linkUp }) {
  let tone = 'bg-gray-800 text-gray-400';
  let text = 'Loading';
  if (!linkUp) {
    tone = 'bg-red-900/40 text-red-400';
    text = 'Server offline';
  } else if (state) {
    const { status } = state.connection;
    if (status === 'connected' && state.stale) { tone = 'bg-amber-900/40 text-amber-400'; text = 'No recent data'; }
    else if (status === 'connected') { tone = 'bg-green-900/40 text-green-400'; text = state.mode === 'demo' ? 'Demo' : 'Live'; }
    else if (status === 'connecting') { tone = 'bg-amber-900/40 text-amber-400'; text = 'Connecting'; }
    else if (status === 'error') { tone = 'bg-red-900/40 text-red-400'; text = 'Error'; }
    else text = 'Disconnected';
  }
  return <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${tone}`}>{text}</span>;
}

export default function App() {
  const { state, history, linkUp, reload } = useDevice();
  const [showSettings, setShowSettings] = useState(false);
  const [unit, setUnitState] = useState(() => readPref('egg.unit', 'F'));
  const [voice, setVoiceState] = useState(() => readPref('egg.voice', 'off') === 'on');
  const [settingsOverride, setSettingsOverride] = useState(null);
  const lastAlertAt = useRef(null);

  const setUnit = (u) => { setUnitState(u); writePref('egg.unit', u); };
  const setVoice = (v) => { setVoiceState(v); writePref('egg.voice', v ? 'on' : 'off'); };

  const device = state?.device;
  const settings = settingsOverride || state?.settings;
  const connected = state?.connection.status === 'connected';

  // Announce new device alerts (only ones that arrive after the page loads).
  useEffect(() => {
    const alerts = device?.alerts || [];
    const newest = alerts[alerts.length - 1];
    if (lastAlertAt.current == null) {
      lastAlertAt.current = newest?.at ?? 0;
      return;
    }
    alerts.filter((a) => a.at > lastAlertAt.current).forEach((a) => {
      const text = ALERT_TEXT[a.type]?.(a, device);
      if (text && voice) speak(text);
    });
    if (newest) lastAlertAt.current = Math.max(lastAlertAt.current, newest.at);
  }, [device?.alerts, voice]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSettingsSaved = (next, { reconnect } = {}) => {
    setSettingsOverride(next);
    if (reconnect) {
      reload();
      setShowSettings(false);
    }
  };
  // Once the stream delivers fresh settings, stop overriding.
  useEffect(() => setSettingsOverride(null), [state?.settings]);

  const recentAlerts = (device?.alerts || []).filter((a) => Date.now() - a.at < 10 * 60000);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-10">
      <header className="bg-gray-900/90 border-b border-gray-800 sticky top-0 z-50 backdrop-blur-lg">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-gradient-to-br from-green-500 to-green-700 p-2 rounded-lg shadow-lg shadow-green-900/50">
              <Flame size={20} className="text-white fill-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-lg leading-tight tracking-tight">Egg Command</h1>
              <p className="text-[10px] text-gray-500 font-medium uppercase tracking-widest truncate">
                {device?.deviceId ? `Controller ${device.deviceId}` : 'EGG Genius / Flame Boss'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <StatusPill state={state} linkUp={linkUp} />
            <button
              type="button"
              onClick={() => setVoice(!voice)}
              className={`p-2 rounded-lg transition-colors ${voice ? 'bg-indigo-900/30 text-indigo-400' : 'text-gray-600 hover:bg-gray-800'}`}
              title="Voice announcements"
            >
              {voice ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button type="button" onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-gray-800 rounded-lg transition-colors" title="Settings">
              <Settings size={20} className="text-gray-400" />
            </button>
          </div>
        </div>
      </header>

      {showSettings && settings && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <SettingsPanel settings={settings} unit={unit} setUnit={setUnit} history={history} onSaved={onSettingsSaved} />
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {state?.connection.status === 'error' && (
          <div className="bg-red-900/20 border border-red-900/50 text-red-400 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle size={20} className="shrink-0" />
            <div className="text-sm">
              <span className="font-bold">Can't reach the controller.</span> {state.connection.error}
            </div>
          </div>
        )}
        {state?.stale && (
          <div className="bg-amber-900/20 border border-amber-900/50 text-amber-300 p-4 rounded-xl flex items-center gap-3">
            <AlertTriangle size={20} className="shrink-0" />
            <div className="text-sm flex-1">No readings from the controller for over a minute. Values below may be out of date.</div>
            <Button size="sm" variant="secondary" onClick={() => postJSON('/api/control/sync').catch(() => {})}><RefreshCw size={14} /> Refresh</Button>
          </div>
        )}
        {recentAlerts.length > 0 && (
          <div className="bg-orange-900/20 border border-orange-700/50 text-orange-300 p-4 rounded-xl flex items-center gap-3">
            <AlertTriangle size={20} className="shrink-0" />
            <div className="text-sm flex-1">{ALERT_TEXT[recentAlerts[recentAlerts.length - 1].type]?.(recentAlerts[recentAlerts.length - 1], device)}</div>
            <Button size="sm" variant="secondary" onClick={() => postJSON('/api/control/alarm-ack').catch(() => {})}><BellOff size={14} /> Silence</Button>
          </div>
        )}
        {state?.connection.status === 'connecting' && !device?.lastTempsAt && (
          <Card className="text-sm text-gray-400">Connecting to the controller{state.connection.detail ? ` (${state.connection.detail})` : ''}…</Card>
        )}

        {device && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4">
              <PitPanel device={device} range={state.setPointRange} unit={unit} canControl={connected} />
            </div>
            <div className="lg:col-span-8 flex flex-col gap-6">
              <Card>
                <h2 className="text-gray-300 font-bold mb-2">Temperature History</h2>
                <TempChart history={history} unit={unit} probes={device.probes} />
              </Card>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {device.probes.map((p) => (
                  <ProbeCard key={p.index} probe={p} history={history} unit={unit} canControl={connected} />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
