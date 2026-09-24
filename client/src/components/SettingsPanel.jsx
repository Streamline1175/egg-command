import React, { useState } from 'react';
import { Download, LogOut, Bug } from 'lucide-react';
import { Card, Button, Field, Segmented, inputClass } from './ui';
import { postJSON } from '../lib/api';
import { toUnit } from '../lib/units';

const SOURCES = [
  { value: 'demo', label: 'Demo' },
  { value: 'lan', label: 'Local network' },
  { value: 'cloud', label: 'Flame Boss cloud' },
];

function CloudSignIn({ settings, onSaved }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (settings.cloud.signedIn) {
    return (
      <div className="flex items-center justify-between p-3 bg-gray-950 rounded-lg border border-gray-800">
        <div className="text-sm">
          <div className="text-gray-300">Signed in{settings.cloud.username ? ` as ${settings.cloud.username}` : ''}</div>
          <div className="text-xs text-gray-500">MQTT user T-{settings.cloud.userId}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={async () => onSaved((await postJSON('/api/cloud/logout')).settings)}>
          <LogOut size={14} /> Sign out
        </Button>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJSON('/api/cloud/login', { email, password });
      setPassword('');
      onSaved(r.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Flame Boss / EGG Genius email">
        <input className={inputClass} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" hint="Sent once to myflameboss.com to get an access token. The password itself is not stored.">
        <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}

export default function SettingsPanel({ settings, unit, setUnit, history, onSaved }) {
  const [mode, setMode] = useState(settings.mode);
  const [host, setHost] = useState(settings.lan.host || '');
  const [pin, setPin] = useState('');
  const [deviceId, setDeviceId] = useState(settings.deviceId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { mode, deviceId: deviceId === '' ? null : deviceId };
      if (mode === 'lan') body.lan = { host: host.trim(), ...(pin ? { pin } : {}) };
      const r = await postJSON('/api/settings', body);
      setPin('');
      onSaved(r.settings, { reconnect: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () => {
    const head = `Timestamp,Pit (°${unit}),Set (°${unit}),Fan %,Meat 1 (°${unit}),Meat 2 (°${unit}),Meat 3 (°${unit})\n`;
    const v = (c) => (c == null ? '' : toUnit(c, unit).toFixed(1));
    const rows = history.map((s) => [new Date(s.t).toISOString(), v(s.pit), v(s.set), s.fan == null ? '' : s.fan.toFixed(0), ...s.p.map(v)].join(','));
    const url = URL.createObjectURL(new Blob([head, rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cook_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <h3 className="text-lg font-bold mb-4">Settings</h3>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="Data source">
            <Segmented value={mode} options={SOURCES} onChange={setMode} />
          </Field>

          {mode === 'lan' && (
            <>
              <Field label="Controller IP address" hint="Turn on Local Access in the EGG Genius / Flame Boss app first.">
                <input className={`${inputClass} font-mono`} inputMode="decimal" placeholder="192.168.1.50" value={host} onChange={(e) => setHost(e.target.value)} />
              </Field>
              <Field label="Device PIN" hint={settings.lan.hasPin ? 'A PIN is saved. Leave blank to keep it.' : 'Shown on the controller / in the app settings.'}>
                <input className={`${inputClass} font-mono`} inputMode="numeric" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
              </Field>
            </>
          )}

          {mode === 'cloud' && <CloudSignIn settings={settings} onSaved={(s) => onSaved(s)} />}

          {mode !== 'demo' && (
            <Field label="Device ID (optional)" hint="Leave blank to use the first controller found.">
              <input className={`${inputClass} font-mono`} inputMode="numeric" value={deviceId} onChange={(e) => setDeviceId(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}

          {error && <div className="text-sm text-red-400">{error}</div>}
          <Button onClick={save} disabled={busy || (mode === 'cloud' && !settings.cloud.signedIn)}>
            {busy ? 'Connecting…' : 'Save & connect'}
          </Button>
        </div>

        <div className="space-y-4">
          <Field label="Units">
            <Segmented value={unit} options={[{ value: 'F', label: '°F' }, { value: 'C', label: '°C' }]} onChange={setUnit} />
          </Field>
          <div className="flex justify-between items-center p-3 bg-gray-950 rounded-lg border border-gray-800">
            <span className="text-sm text-gray-400">Export cook log</span>
            <Button size="sm" variant="secondary" onClick={downloadCsv} disabled={!history.length}><Download size={14} /> CSV</Button>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-950 rounded-lg border border-gray-800">
            <span className="text-sm text-gray-400">Raw controller messages</span>
            <a className="text-xs text-gray-300 flex items-center gap-1 hover:text-white" href="/api/debug/raw" target="_blank" rel="noreferrer"><Bug size={14} /> View</a>
          </div>
        </div>
      </div>
    </Card>
  );
}
