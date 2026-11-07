import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  const phoneMode = mode === 'phone';

  return {
  plugins: [react(), ...(phoneMode ? [basicSsl()] : [])],
  server: {
    host: '0.0.0.0',
    port: 5174, // <-- Change this from 5173 to 5174
    strictPort: true,
    allowedHosts: true,
    ...(phoneMode ? { https: true } : {}),
    proxy: { '/api': 'http://localhost:4000' },
  },
  };
});
