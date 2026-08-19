import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api-local': {
        target: 'http://127.0.0.1:6881',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-local/, ''),
      },
      '/api-escrow': {
        target: 'http://nrs-order-service.nrs-escrow.ttb.test.ke.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-escrow/, ''),
      },
      '/api': {
        target: 'http://127.0.0.1:6881',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\//, '/'),
      },
    },
  },
});
