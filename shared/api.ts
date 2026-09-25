import type { state } from "../server/index.ts";
import type { LibraryEntry, Craft } from "./types.ts";
export type AppState = ReturnType<typeof state>;
export type Vehicle = AppState["vehicles"][number];
export type UdpState = Vehicle["udp"];
export interface ApiRoutes {
  "/api/manual-demo": {
    input: { vehicleId: string; action: "start" | "stop" | "heartbeat" | "throttle" | "separate"; throttle?: number };
    output: AppState;
  };
  "/api/editor": { input: { libraryId?: string }; output: AppState };
  "/api/flight": { input: Record<string, never>; output: AppState };
  "/api/launch": { input: Craft; output: AppState };
  "/api/control": {
    input: { vehicleId: string; enabled: boolean };
    output: AppState;
  };
  "/api/time-scale": { input: { scale: number }; output: AppState };
  "/api/craft": {
    input: Craft & { libraryId: string | null };
    output: { ok: boolean; libraryId: string; library: LibraryEntry[] };
  };
}
