import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { configureDevActorHeader, LOCAL_API_TARGET } from "./src/dev-proxy";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: LOCAL_API_TARGET,
          changeOrigin: false,
          configure: (proxy) => {
            configureDevActorHeader(proxy, env.VITE_DEV_ACTOR_ID);
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: true,
    },
  };
});
