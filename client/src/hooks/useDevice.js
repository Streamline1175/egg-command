import { useEffect, useState } from 'react';

const HISTORY_LIMIT = 12 * 60 * 12;

/**
 * Live controller state from the server's /api/events stream. EventSource
 * reconnects on its own; on reconnect the server sends a fresh snapshot, so
 * nothing is lost if the phone sleeps or Wi-Fi blips.
 */
export function useDevice() {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [linkUp, setLinkUp] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setLinkUp(true);
    es.onerror = () => setLinkUp(false);
    es.addEventListener('snapshot', (e) => {
      const { history: h, ...rest } = JSON.parse(e.data);
      setState(rest);
      setHistory(h || []);
    });
    es.addEventListener('state', (e) => {
      const next = JSON.parse(e.data);
      setState((prev) => ({ ...prev, ...next }));
    });
    es.addEventListener('sample', (e) => {
      const s = JSON.parse(e.data);
      setHistory((prev) => {
        const out = prev.length >= HISTORY_LIMIT ? prev.slice(1 - HISTORY_LIMIT) : prev.slice();
        out.push(s);
        return out;
      });
    });
    return () => es.close();
  }, [generation]);

  // After changing the data source the server starts a fresh session (and
  // history), so re-open the stream to pick up a clean snapshot.
  const reload = () => setGeneration((g) => g + 1);

  return { state, history, linkUp, reload };
}
