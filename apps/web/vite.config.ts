import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export function resolveApiOrigin(env: Record<string, string | undefined>): string {
  if (env.TUCKMARK_API_ORIGIN) {
    return env.TUCKMARK_API_ORIGIN;
  }

  const serverPort = env.TUCKMARK_SERVER_PORT ?? "5210";
  return `http://127.0.0.1:${serverPort}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      port: Number(env.TUCKMARK_WEB_PORT ?? 5173),
      proxy: {
        "/api": {
          target: resolveApiOrigin(env),
          changeOrigin: true
        }
      }
    }
  };
});
