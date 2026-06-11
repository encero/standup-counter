import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Baked into the client bundle at build time. Must match the server's
    // APP_VERSION at runtime; a mismatch forces the client to reload.
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
