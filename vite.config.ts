import {
  defineConfig,
  loadEnv,
  Plugin,
  UserConfig,
  UserConfigExport,
} from 'vite';
import {execFileSync} from 'child_process';

import react from '@vitejs/plugin-react';

const readGit = (...args: string[]): string => {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};

const devRevisionPlugin: Plugin = {
  name: 'opensight-dev-revision',
  configureServer(server) {
    server.middlewares.use('/__opensight_dev.json', (_request, response) => {
      const upstream = readGit(
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
      );
      const [behind = '0', ahead = '0'] = upstream
        ? readGit('rev-list', '--left-right', '--count', `${upstream}...HEAD`).split(/\s+/)
        : [];
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        branch: readGit('branch', '--show-current') || 'detached',
        commit: readGit('rev-parse', '--short=12', 'HEAD') || 'unknown',
        dirty: Boolean(readGit('status', '--porcelain')),
        upstream: upstream || null,
        ahead: Number(ahead),
        behind: Number(behind),
      }, null, 2));
    });
  },
};

export default ({ mode }: UserConfig): UserConfigExport => {
  const appMode = mode || 'development';
  process.env = { ...process.env, ...loadEnv(appMode, process.cwd()) };
  const privateProxyEnv = loadEnv(appMode, process.cwd(), 'LLM_CONTROL_PROXY_');
  const base = '/';
  const backendTarget = process.env.VITE_OPENSIGHT_BACKEND_TARGET
    || 'https://127.0.0.1:58600';
  const serviceProxy = {
    target: backendTarget,
    changeOrigin: true,
    secure: false,
  };
  const llmControlAuthToken = process.env.LLM_CONTROL_PROXY_AUTH_TOKEN
    || privateProxyEnv.LLM_CONTROL_PROXY_AUTH_TOKEN;
  // ponytail: local dev proxy only; production should use a server-issued session.
  const llmControlProxy = llmControlAuthToken ? {
    ...serviceProxy,
    headers: { Authorization: `Bearer ${llmControlAuthToken}` },
  } : serviceProxy;
  return defineConfig({
    base,
    // Worktrees share node_modules, but must not overwrite each other's optimized deps.
    cacheDir: '.vite',
    plugins: [react(), devRevisionPlugin],
    define: {
      __OPENSIGHT_HOST_SYSTEM__: JSON.stringify(
        process.env.VITE_OPENSIGHT_HOST_SYSTEM || '',
      ),
      __OPENSIGHT_DEMO__: JSON.stringify(process.env.VITE_OPENSIGHT_DEMO === '1'),
    },
    server: {
      proxy: {
        '/extension_service/extensions/llm-control': llmControlProxy,
        '/core_service': serviceProxy,
        '/extension_service': serviceProxy,
      },
    },
    preview: {
      proxy: {
        '/extension_service/extensions/llm-control': llmControlProxy,
        '/core_service': serviceProxy,
        '/extension_service': serviceProxy,
      },
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
