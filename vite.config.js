import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Allows any subdomain under vercel.run to access the dev server
    allowedHosts: ['.vercel.run'] 
  }
})
