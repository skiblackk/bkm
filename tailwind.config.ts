import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17212b',
        canvas: '#f5f7f7',
        panel: '#ffffff',
        line: '#e1e8e8',
        teal: {
          50: '#eef9f7',
          100: '#d9f1ed',
          500: '#248f82',
          600: '#1b776c',
          700: '#165e56',
        },
        amber: '#b87922',
        danger: '#bd514c',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(23,33,43,0.04), 0 8px 24px rgba(23,33,43,0.035)',
      },
    },
  },
  plugins: [],
};

export default config;
