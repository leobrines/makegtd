/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#0d9488',
          soft: '#ccfbf1',
          dark: '#0f766e',
        },
      },
    },
  },
  plugins: [],
};
