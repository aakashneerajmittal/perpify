  
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
// import jsconfigPaths from "vite-jsconfig-paths";
import tsconfigPaths from "vite-tsconfig-paths";
import { viteCommonjs } from "@originjs/vite-plugin-commonjs";
import mkcert from "vite-plugin-mkcert";
import EnvironmentPlugin from "vite-plugin-environment";

export default defineConfig({
  esbuild: {
    loader: "tsx"
  },
  // PERPIFY: HTTPS + mkcert made opt-in. Plain http for local/cloud dev (set
  // PERPIFY_HTTPS=1 to restore mkcert + https, e.g. if a wallet lib needs a secure origin).
  server: {
    port: 3000,
    https: !!process.env.PERPIFY_HTTPS
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        ".js": "jsx",
        ".ts": "tsx"
      }
    }
  },
  build: {
    outDir: "./build/", // This will be overrided to `dist` by qwikVite() setting
    sourcemap: false, // https://github.com/vitejs/vite/issues/2433
    rollupOptions: { cache: false }
  },
  plugins: [
    react(),
    svgr(),
    tsconfigPaths(),
    viteCommonjs(),
    ...(process.env.PERPIFY_HTTPS ? [mkcert()] : []),
    EnvironmentPlugin(["VITE_BUILD_TYPE", "REACT_APP_PUBLIC_POSTHOG_KEY", "REACT_APP_PUBLIC_POSTHOG_URL"])
  ]
});
