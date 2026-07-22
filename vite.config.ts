import {
  defineConfig,
  loadEnv,
  UserConfig,
  UserConfigExport,
} from 'vite';

import react from '@vitejs/plugin-react';

export default ({ mode }: UserConfig): UserConfigExport => {
  process.env = { ...process.env, ...loadEnv(mode || 'development', process.cwd()) };
  const base = '/';
  return defineConfig({
    base,
    plugins: [react()],
    define: {
      __OPENSIGHT_HOST_SYSTEM__: JSON.stringify(
        process.env.VITE_OPENSIGHT_HOST_SYSTEM || '',
      ),
    },
    build: {
      minify: 'terser',
      sourcemap: mode === 'development',
      chunkSizeWarningLimit: 1024 * 1024,
      rollupOptions: {
        treeshake: true,
        maxParallelFileReads: 4,
        output: {
          manualChunks: {
            lodash: ['lodash'],
            classnames: ['classnames'],
            runtime: ['react'],
            'runtime-dom': ['react-dom'],
            ui: ['@mui/material', '@mui/system'],
          },
        },
      },
    },
    esbuild: {
      logOverride: { 'this-is-undefined-in-esm': 'silent' }
    },
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin'],
        },
      },
      modules: {
        generateScopedName: mode === 'development' ? '[name]__[local]___[hash:base64:5]' : '[hash:base64:8]',
        scopeBehaviour: 'local',
        localsConvention: 'camelCase',
      },
      postcss: {
        plugins: [
          {
            postcssPlugin: 'internal:charset-removal',
            AtRule: {
              charset: (atRule) => {
                if (atRule.name === 'charset') {
                  atRule.remove();
                }
              },
            },
          },
        ],
      },
    },
  });
};
