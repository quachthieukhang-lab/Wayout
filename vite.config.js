import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: true, // listen on 127.0.0.1, localhost (IPv4 + IPv6) and LAN
    port: 5173,
    open: true,
  },
  plugins: [
    // Installable app that also works offline: the service worker precaches the build, including the two models.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Way Out',
        short_name: 'Way Out',
        description: 'A first-person horror game by Quách Thiếu Khang.',
        theme_color: '#0a0707',
        background_color: '#000000',
        display: 'fullscreen',
        orientation: 'landscape',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,glb}'],
        // The crash-report SDK loads only for players who have reports on, and only online anyway.
        globIgnores: ['**/sentry-sdk-*.js'],
      },
    }),
  ],
});
