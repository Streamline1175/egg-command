// The server speaks Celsius; the UI converts for display.
export const cToF = (c) => c * 9 / 5 + 32;
export const fToC = (f) => (f - 32) * 5 / 9;

export const toUnit = (c, unit) => (c == null ? null : unit === 'F' ? cToF(c) : c);
export const fromUnit = (v, unit) => (unit === 'F' ? fToC(v) : v);

export const fmt = (c, unit) => {
  const v = toUnit(c, unit);
  return v == null ? '--' : `${Math.round(v)}°`;
};
