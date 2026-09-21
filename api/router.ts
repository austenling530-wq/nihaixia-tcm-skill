import { createRouter, publicQuery } from "./middleware";
import { askRouter } from "./ask";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  ask: askRouter,
});

export type AppRouter = typeof appRouter;
