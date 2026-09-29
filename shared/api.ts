import type { state } from "../server/index.ts";
import type { LibraryEntry, Craft } from "./types.ts";
import type {LaunchOptions,LaunchPreview} from './launch-sites.ts';
export type AppState = ReturnType<typeof state>;
export type Vehicle = AppState["vehicles"][number];
export type UdpState = Vehicle["udp"];
export interface ApiRoutes {
  "/api/part-command": {
    input: { vehicleId: string; command: Record<string, unknown> };
    output: { accepted: boolean; reason: string };
  };
  "/api/editor": { input: { libraryId?: string }; output: AppState };
  "/api/flight": { input: Record<string, never>; output: AppState };
  "/api/launch": { input: Craft & LaunchOptions; output: AppState };
  "/api/launch-preview": { input: Craft & LaunchOptions; output: LaunchPreview };
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
