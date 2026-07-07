import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Only proxy actual API sub-paths, not the bare /admin or /officer
      // React routes (e.g. navigating to /admin, /officer) stay on Vite
      '/officer/complaints': 'http://localhost:8000',
      '/admin/stats': 'http://localhost:8000',
      '/admin/officers': 'http://localhost:8000',
      '/admin/escalations': 'http://localhost:8000',
      '/admin/complaints': 'http://localhost:8000',
      '/admin/tags': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
    },
  },
})
