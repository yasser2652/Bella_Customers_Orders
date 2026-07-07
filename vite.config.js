import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "REACT_APP_"],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("firebase")) {
            return "firebase";
          }

          if (id.includes("jspdf") || id.includes("html2canvas") || id.includes("dompurify")) {
            return "pdf";
          }

          if (id.includes("lucide-react")) {
            return "icons";
          }

          return undefined;
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  }
});
