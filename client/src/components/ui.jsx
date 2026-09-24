import React from 'react';

export const Card = ({ children, className = '' }) => (
  <div className={`bg-gray-800/50 backdrop-blur-md border border-gray-700 rounded-2xl p-4 sm:p-6 ${className}`}>
    {children}
  </div>
);

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

const VARIANTS = {
  primary: 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20',
  secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-200',
  danger: 'bg-red-900/30 text-red-400 border border-red-900/50 hover:bg-red-600/30',
  ghost: 'text-gray-400 hover:text-white hover:bg-gray-800',
};

export const Button = ({ children, variant = 'primary', size = 'md', className = '', ...props }) => (
  <button
    type="button"
    className={`rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    {...props}
  >
    {children}
  </button>
);

export const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="text-xs text-gray-500 uppercase font-bold">{label}</span>
    <div className="mt-1">{children}</div>
    {hint && <span className="block mt-1 text-xs text-gray-500">{hint}</span>}
  </label>
);

export const inputClass = 'w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-600';

export const Segmented = ({ value, options, onChange }) => (
  <div className="flex p-1 bg-gray-950 rounded-lg border border-gray-800">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${value === o.value ? 'bg-green-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);
