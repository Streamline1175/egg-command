import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Settings, Thermometer, Fan, Wifi, WifiOff, Activity, Flame, 
  Clock, RefreshCw, Power, Mic, MicOff, Download, TrendingUp, AlertTriangle 
} from 'lucide-react';

/**
 * BIG GREEN DASHBOARD V2
 * Enhanced with Predictive Algorithms, Voice Alerts, and Data Export
 */

// --- Utility: Linear Regression for Prediction ---
const predictFinishTime = (history, currentTemp, targetTemp, options = {}) => {
  // Robust predictor with simple smoothing and guardrails
  // options: { minPoints, smoothWindow }
  const minPoints = options.minPoints || 8;
  const smoothWindow = options.smoothWindow || 3;

  if (!history || history.length < minPoints) return null;
  if (currentTemp >= targetTemp) return "Done";

  // Use recent subset but ensure we have enough
  const recent = history.slice(-Math.max(minPoints, 12));

  // Compute moving average to smooth noise
  const smooth = recent.map((d, i, arr) => {
    const start = Math.max(0, i - (smoothWindow - 1));
    const window = arr.slice(start, i + 1).map(x => x.meat1);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    return { timestamp: d.timestamp, val: avg };
  });

  const startTime = smooth[0].timestamp.getTime();

  // Linear regression on smoothed points
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  const n = smooth.length;
  smooth.forEach(d => {
    const x = (d.timestamp.getTime() - startTime) / 1000;
    const y = d.val;
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  });

  const denom = (n * sumXX - sumX * sumX);
  if (!denom) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;

  // Guard against non-positive slope or extremely small slopes that lead to absurd estimates
  if (!isFinite(slope) || slope <= 0.0005) return "Stalled";

  const degreesNeeded = targetTemp - currentTemp;
  const secondsRemaining = degreesNeeded / slope;

  // Clamp to a reasonable upper bound to avoid crazy dates (e.g., if slope tiny)
  const maxHours = 48; // don't estimate more than 2 days for a cook
  const clampedSeconds = Math.min(secondsRemaining, maxHours * 3600);

  const finishDate = new Date(Date.now() + clampedSeconds * 1000);
  return finishDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// --- Utility: Voice Engine ---
const speak = (text, enabled) => {
  if (!enabled || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utterance);
};

// --- Visual Components ---

const Card = ({ children, className = "" }) => (
  <div className={`bg-gray-800/50 backdrop-blur-md border border-gray-700 rounded-2xl p-6 ${className}`}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = "primary", className = "", disabled = false, size = "md" }) => {
  const baseStyle = "rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = {
    sm: "px-3 py-1 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base"
  };
  const variants = {
    primary: "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20",
    secondary: "bg-gray-700 hover:bg-gray-600 text-gray-200",
    danger: "bg-red-900/30 text-red-400 border border-red-900/50 hover:bg-red-600/30",
    ghost: "text-gray-400 hover:text-white hover:bg-gray-800"
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const TempGauge = ({ current, target, label, max = 500 }) => {
  const radius = 80;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const offset = circumference - (current / max) * circumference * 0.75;
  
  const isHot = current > target + 10;
  const isCold = current < target - 10;
  const color = isHot ? "text-red-500" : isCold ? "text-blue-500" : "text-green-500";

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="rotate-[135deg]">
        <circle stroke="currentColor" fill="transparent" strokeWidth={stroke} strokeDasharray={circumference * 0.75 + " " + circumference * 0.25} r={normalizedRadius} cx={radius} cy={radius} className="text-gray-800" strokeLinecap="round" />
        <circle stroke="currentColor" fill="transparent" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={offset} r={normalizedRadius} cx={radius} cy={radius} className={`${color} transition-all duration-1000 ease-out`} strokeLinecap="round" />
      </svg>
      {/*
        Center overlay: reduce font-size and remove the upward margin so the number
        sits cleanly inside the gauge without overlapping the outer ring. Use a
        responsive size so larger screens can use a slightly bigger font but still
        fit.
      */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">{label}</span>
        <span className={`text-3xl sm:text-4xl md:text-5xl font-bold ${color} tabular-nums leading-none`}>{Math.round(current)}°</span>
        <span className="text-gray-500 text-sm mt-1 flex items-center gap-1"><Activity size={12} /> Set: {target}°</span>
      </div>
    </div>
  );
};

const FanMeter = ({ speed }) => (
  <div className="flex items-center gap-4 w-full">
    <div className={`p-3 rounded-full ${speed > 0 ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
      <Fan size={24} className={speed > 0 ? 'animate-spin-slow' : ''} style={{ animationDuration: `${3000 / (speed || 1)}ms` }} />
    </div>
    <div className="flex-1">
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium text-gray-400">Fan Output</span>
        <span className="text-sm font-bold text-white">{speed}%</span>
      </div>
      <div className="h-3 w-full bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-green-600 to-emerald-400 transition-all duration-500" style={{ width: `${speed}%` }} />
      </div>
    </div>
  </div>
);

const TempChart = ({ data }) => {
  if (!data || data.length < 2) return <div className="h-40 flex items-center justify-center text-gray-600">Waiting for data...</div>;

  const height = 160;
  const width = 600;
  const padding = 20;

  const allTemps = data.flatMap(d => [d.pit, d.meat1]);
  const maxTemp = Math.max(...allTemps) + 20;
  const minTemp = Math.min(...allTemps) - 20;
  const range = maxTemp - minTemp || 100;

  const getX = (index) => (index / (data.length - 1)) * (width - padding * 2) + padding;
  const getY = (temp) => height - padding - ((temp - minTemp) / range) * (height - padding * 2);

  const makePath = (key, color) => {
    const points = data.map((d, i) => `${getX(i)},${getY(d[key])}`).join(" ");
    return <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />;
  };

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40">
        <line x1={padding} y1={getY(225)} x2={width-padding} y2={getY(225)} stroke="#374151" strokeDasharray="4 4" />
        {makePath('meat1', '#F59E0B')} 
        {makePath('pit', '#10B981')}   
      </svg>
    </div>
  );
};

// --- Main Application ---

export default function EggGeniusDashboard() {
  const [config, setConfig] = useState({
    mode: 'demo',
    ipAddress: '192.168.1.50',
    refreshRate: 3000,
    voiceEnabled: false
  });

  const [status, setStatus] = useState({
    connected: false,
    lastUpdate: null,
    pitTemp: 0,
    pitSet: 225,
    fanSpeed: 0,
    probes: [
      { id: 1, name: 'Pork Shoulder', temp: 0, target: 195 },
      { id: 2, name: 'Ambient', temp: 0, target: 0 },
    ]
  });

  const [history, setHistory] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [alerts, setAlerts] = useState([]);

  // Mock Data & Simulation
  useEffect(() => {
    if (config.mode !== 'demo') return;

    let currentPit = 215;
    let currentMeat = 150;
    let currentFan = 20;

    const interval = setInterval(() => {
      // Simulation Logic
      const diff = 225 - currentPit;
      currentPit += (diff * 0.1) + (Math.random() - 0.5) * 1.5;
      currentMeat += 0.05 + (Math.random() * 0.05); // Slow rise
      if (currentPit < 225) currentFan = Math.min(100, currentFan + 2);
      else currentFan = Math.max(0, currentFan - 2);

      const now = new Date();
      const newData = { pit: currentPit, meat1: currentMeat, timestamp: now };
      
      setHistory(prev => {
          const newHist = [...prev.slice(-99), newData]; // Keep 100 pts
          // Use the probe 0 target from current state (fallback to 195)
          const probeTarget = (prev && prev.length ? null : null); // noop - we only use status below
          // prefer reading the configured probe target from the current status state
          const target = status?.probes?.[0]?.target ?? 195;
          setPrediction(predictFinishTime(newHist, currentMeat, target, {minPoints: 8, smoothWindow: 3}));
          return newHist;
        });

      setStatus({
        connected: true,
        lastUpdate: now,
        pitTemp: currentPit,
        pitSet: 225,
        fanSpeed: Math.round(currentFan),
        probes: [
          { id: 1, name: 'Pork Shoulder', temp: currentMeat, target: 195 },
          { id: 2, name: 'Ambient', temp: currentPit - 15, target: 0 },
        ]
      });
      
      // Voice Check
      if (Math.random() > 0.95 && config.voiceEnabled) {
         // Random voice event for demo
         // speak(`Pit temperature is ${Math.round(currentPit)} degrees`, true);
      }

    }, 2000);
    return () => clearInterval(interval);
  }, [config.mode, config.voiceEnabled]);

  // Handle Export
  const downloadData = () => {
    const headers = ["Timestamp,Pit Temp,Meat 1 Temp,Fan Speed\n"];
    const rows = history.map(h => 
      `${h.timestamp.toISOString()},${h.pit.toFixed(1)},${h.meat1.toFixed(1)},${status.fanSpeed}`
    );
    const blob = new Blob([...headers, ...rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cook_log_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-20">
      
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50 backdrop-blur-lg bg-opacity-90">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-green-500 to-green-700 p-2 rounded-lg shadow-lg shadow-green-900/50">
              <Flame size={20} className="text-white fill-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Egg Command</h1>
              <p className="text-[10px] text-gray-500 font-medium uppercase tracking-widest">Enhanced Monitor v2.0</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
             {/* Voice Toggle */}
            <button 
              onClick={() => setConfig(prev => ({...prev, voiceEnabled: !prev.voiceEnabled}))}
              className={`p-2 rounded-lg transition-colors ${config.voiceEnabled ? 'bg-indigo-900/30 text-indigo-400' : 'text-gray-600 hover:bg-gray-800'}`}
              title="Voice Announcements"
            >
              {config.voiceEnabled ? <Mic size={20} /> : <MicOff size={20} />}
            </button>

            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <Settings size={20} className="text-gray-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="max-w-5xl mx-auto px-4 py-4 animate-in slide-in-from-top-4">
          <Card className="bg-gray-900 border-gray-800">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">Configuration</h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase font-bold">Data Source</label>
                  <div className="flex p-1 bg-gray-950 rounded-lg mt-1 border border-gray-800">
                    <button onClick={() => setConfig({...config, mode: 'demo'})} className={`flex-1 py-2 text-sm font-medium rounded-md ${config.mode === 'demo' ? 'bg-gray-800 text-white' : 'text-gray-500'}`}>Demo</button>
                    <button onClick={() => setConfig({...config, mode: 'live'})} className={`flex-1 py-2 text-sm font-medium rounded-md ${config.mode === 'live' ? 'bg-green-700 text-white' : 'text-gray-500'}`}>Live Device</button>
                  </div>
                </div>
                {config.mode === 'live' && (
                  <input type="text" value={config.ipAddress} onChange={(e) => setConfig({...config, ipAddress: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2 font-mono text-sm" />
                )}
              </div>
              <div className="space-y-4">
                 <div className="flex justify-between items-center p-3 bg-gray-950 rounded-lg border border-gray-800">
                    <span className="text-sm text-gray-400">Export Cook Log</span>
                    <Button size="sm" variant="secondary" onClick={downloadData}><Download size={14} /> CSV</Button>
                 </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Main Grid */}
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        
        {/* Connection Status Banner (if offline) */}
        {!status.connected && config.mode === 'live' && (
          <div className="bg-red-900/20 border border-red-900/50 text-red-400 p-4 rounded-xl flex items-center gap-3">
            <AlertTriangle size={20} />
            <div className="text-sm">
              <span className="font-bold">Connection Failed.</span> Ensure your device is on the same network and you are using a CORS extension or proxy.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Gauges (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="flex flex-col items-center relative overflow-hidden h-full min-h-[300px]">
              <div className={`absolute top-0 w-full h-1 bg-gradient-to-r from-transparent via-${Math.abs(status.pitTemp - status.pitSet) < 10 ? 'green' : 'red'}-500 to-transparent opacity-75`} />
              
              <div className="w-full flex justify-between items-center mb-6">
                <span className="font-bold text-gray-400 text-sm tracking-wider">PIT CONTROL</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${status.fanSpeed > 0 ? 'bg-green-900 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                  {status.fanSpeed > 0 ? 'ACTIVE' : 'IDLE'}
                </span>
              </div>

              <TempGauge current={status.pitTemp} target={status.pitSet} label={Math.abs(status.pitTemp - status.pitSet) < 5 ? "LOCKED" : "ADJUSTING"} />
              
              <div className="w-full mt-auto pt-6">
                <FanMeter speed={status.fanSpeed} />
              </div>
            </Card>
          </div>

          {/* Right Column: Data & Probes (8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Main Graph Card */}
            <Card className="h-64 flex flex-col justify-between">
              <div className="flex justify-between items-start mb-2">
                 <div>
                   <h2 className="text-gray-300 font-bold">Temperature History</h2>
                   <p className="text-xs text-gray-500">Real-time sampling (3s interval)</p>
                 </div>
                 <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-green-400"><div className="w-2 h-2 rounded-full bg-green-500"/> Pit</span>
                    <span className="flex items-center gap-1 text-amber-400"><div className="w-2 h-2 rounded-full bg-amber-500"/> Meat</span>
                 </div>
              </div>
              <TempChart data={history} />
            </Card>

            {/* Probes Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Meat Probe 1 */}
              <Card className="p-4 relative group hover:border-amber-500/50 transition-colors">
                 <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                       <TrendingUp size={16} className="text-amber-500" />
                       <span className="font-bold text-gray-200">{status.probes[0].name}</span>
                    </div>
                    <span className="text-2xl font-bold text-white tabular-nums">{Math.round(status.probes[0].temp)}°</span>
                 </div>
                 
                 {/* AI Prediction Badge */}
                 {prediction && (
                   <div className="mb-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-2 flex items-center justify-between">
                      <span className="text-xs text-indigo-300 font-medium flex items-center gap-1">
                        <Clock size={12} /> AI Estimate
                      </span>
                      <span className="text-xs font-bold text-indigo-200">{prediction}</span>
                   </div>
                 )}

                 <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500">
                       <span>Current</span>
                       <span>Target: {status.probes[0].target}°</span>
                    </div>
                    <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${(status.probes[0].temp / status.probes[0].target) * 100}%` }} />
                    </div>
                 </div>
              </Card>

              {/* Ambient Probe */}
              <Card className="p-4 flex flex-col justify-center">
                 <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-gray-400 text-sm">Ambient Temp</span>
                    <span className="text-xl font-bold text-gray-300">{Math.round(status.probes[1].temp)}°</span>
                 </div>
                 <div className="text-xs text-gray-500">
                   External sensor monitoring
                 </div>
              </Card>
            </div>
          </div>
        </div>

        {/* Floating Action Bar */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-xl border border-gray-700 shadow-2xl rounded-2xl p-1.5 flex gap-1 z-40">
           <Button variant="ghost" size="sm" onClick={() => speak("System checks nominal", true)}>Test Audio</Button>
           <div className="w-px bg-gray-700 mx-1"></div>
           <Button variant="secondary" size="sm">Keep Warm</Button>
           <Button variant="primary" size="sm">Boost Fan</Button>
        </div>

      </main>
    </div>
  );
}

          
