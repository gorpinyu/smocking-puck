import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        sessions: resolve(__dirname, 'sessions.html'),
        myBookings: resolve(__dirname, 'my-bookings.html'),
        players: resolve(__dirname, 'players.html'),
        login: resolve(__dirname, 'login.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
