import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const bingProxy = Object.fromEntries(['cn', 'www'].map(host => [
  `^/__loci-bing/${host}/(HPImageArchive\\.aspx|th)(\\?|$)`,
  {
    target: `https://${host}.bing.com`,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(`/__loci-bing/${host}`, ''),
    configure: (proxy: import('vite').HttpProxy.Server) => proxy.on('proxyReq', request => {
      request.removeHeader('cookie');
      request.removeHeader('authorization');
      request.removeHeader('referer');
    }),
  },
]));

const imageProxy = { ...bingProxy, '^/__loci-favicon/faviconV2(\\?|$)': {
  target: 'https://t0.gstatic.cn', changeOrigin: true,
  rewrite: (path: string) => path.replace('/__loci-favicon', ''),
  configure: (proxy: import('vite').HttpProxy.Server) => proxy.on('proxyReq', request => {
    request.removeHeader('cookie'); request.removeHeader('authorization'); request.removeHeader('referer');
  }),
} };

export default defineConfig({
  base: './',
  plugins: [react()],
  // Local previews need a proxy; installed extensions use optional host permissions.
  server: { proxy: imageProxy },
  preview: { proxy: imageProxy },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { main: 'index.html' },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
