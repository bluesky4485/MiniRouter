import { serve } from "@hono/node-server";
import { PROXY_PORT } from "../config.js";
import { createApp } from "./app.js";

const app = createApp();

serve(
  {
    fetch: app.fetch,
    port: PROXY_PORT,
  },
  (info) => {
    console.log(`[MiniRouter] listening on http://localhost:${info.port}`);
    console.log(`[MiniRouter] dashboard: http://localhost:${info.port}/models/dashboard`);
  },
);
