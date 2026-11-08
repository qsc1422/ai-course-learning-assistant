import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f5f7fa',
        sheet: '#ffffff',
        ink: '#111827',
        ink2: '#4b5563',
        muted: '#8e99a8',
        line: '#e4e8ef',
        brand: '#2563eb',
        brandDeep: '#1d4ed8',
        brandSoft: '#eef4ff',
        ok: '#0f9f6e',
        okSoft: '#e8f7f1',
        clay: '#e8590c',
        claySoft: '#fff1e8',
        gold: '#b7791f',
      },
    },
  },
  plugins: [],
} satisfies Config
