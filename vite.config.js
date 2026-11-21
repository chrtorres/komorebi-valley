import { defineConfig } from 'vite';

export default defineConfig({
  envPrefix: [],
  publicDir: false,
  server: {
    host: '127.0.0.1',
    cors: false,
    fs: { deny: ['.env', '.env.*', '*.{crt,key,pem,p12,pfx,jsonl}', '**/.git/**'] },
  },
  preview: { host: '127.0.0.1', cors: false },
});
