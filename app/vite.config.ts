import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Qevie",
        short_name: "Qevie",
        description: "Gasless stablecoin payments on QIE",
        theme_color: "#7c3aed",
        background_color: "#0f0f12",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "/favicon.png",
            sizes: "32x32",
            type: "image/png",
          },
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        skipWaiting: true,
        // Reload already-open clients when a new worker activates so returning
        // users are flushed off the previous cached bundle (see sw-reload.js).
        importScripts: ["sw-reload.js"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  define: {
    global: "globalThis",
  },
});
