import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      ink: '#111743', canvas: '#f6f5f1', panel: '#ffffff', line: '#e5e5df', navy: '#111743', gold: '#f4b41b',
      teal: { 50: '#f5f7fb', 100: '#e9edf7', 500: '#26316f', 600: '#1c255b', 700: '#111743' },
      amber: '#c28a00', danger: '#b33f45',
    },
    boxShadow: { panel: '0 1px 2px rgba(17,23,67,0.04), 0 10px 28px rgba(17,23,67,0.05)', deep: '0 18px 50px rgba(17,23,67,0.16)' },
  } },
  plugins: [],
};
export default config;
