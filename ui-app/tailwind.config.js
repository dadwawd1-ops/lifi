/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#012d1d',
        surface: '#f9f9f8',
        tertiary: '#3b2000',
        'surface-low': '#f3f4f3',
        'surface-high': '#e8e8e7',
        outline: '#c1c8c2',
        muted: '#414844',
        accent: '#c1ecd4',
        warm: '#eebd8e',
        shell: '#eae1da',
      },
      fontFamily: {
        sans: ['"Sora"', '"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 18px 60px rgba(1, 45, 29, 0.08)',
      },
      backgroundImage: {
        hero:
          'radial-gradient(circle at top left, rgba(193,236,212,0.55), transparent 35%), radial-gradient(circle at top right, rgba(238,189,142,0.35), transparent 28%), linear-gradient(180deg, #f9f9f8 0%, #eef2ed 100%)',
      },
    },
  },
  plugins: [],
}
