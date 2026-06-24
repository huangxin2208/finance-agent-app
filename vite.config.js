import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Allows any dynamic sandbox URL generated under vercel.run
    allowedHosts: ['.vercel.run'] 
  },
  preview: {
    // Fallback in case the platform builds and serves via Vite preview
    allowedHosts: ['.vercel.run']
  }
})
