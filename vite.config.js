import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

const stylexOptions = {
  runtimeInjection: true,
  genConditionalClasses: true,
  treeshakeCompensation: true,
  unstable_moduleResolution: {
    type: 'commonJS',
    rootDir: process.cwd(),
  },
};

export default defineConfig(({command}) => ({
  plugins: [
    react({
      babel: {
        plugins: [
          ['@stylexjs/babel-plugin', {
            ...stylexOptions,
            dev: command === 'serve',
          }],
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
