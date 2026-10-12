/**
 * @weft/protocol — shared types for the extension ↔ core WebSocket channel,
 * the MCP surface, and the desktop UI. Mirror these in Rust (serde) in weft-core.
 */

/* ------------------------------------------------------------------ *
 * MCP lifecycle
 * ------------------------------------------------------------------ */

export type McpStatus =
  | "capturing"     // sampling live traffic right after convert / re-capture
  | "ready"         // API mapped, session valid, served to clients
  | "outdated"      // schema drift detected vs stored model
  | "needs_login"   // session probe returned 401/403
  | "refreshing"    // browser open, re-syncing the session
  | "not_possible"  // replays can't work — see `reason`
  | "paused";       // user disabled it

export type NotPossibleReason =
  | "signed_requests"     // per-call HMAC / nonce / timestamp
  | "fingerprint_bound"   // device/anti-bot binding or JS challenge
  | "no_api"              // server-rendered HTML, no XHR/fetch JSON
  | "non_replayable"      // websocket / grpc-web / sse only
  | "drm";

export interface Mcp {
  id: string;
  name: string;
  origin: string;              // e.g. "https://app.linear.app"
  color: string;              // brand swatch for the avatar (hex)
  initials: string;           // 2-char avatar fallback
  status: McpStatus;
  endpointCount: number;
  lastRefreshed?: string;      // ISO timestamp
  reason?: NotPossibleReason;  // when status === "not_possible"
  drift?: { newEndpoints: number; changed: number }; // when status === "outdated"
  partial?: boolean;           // captured in header-only "light mode"
  pinnedClients?: ClientId[];  // which AI clients it's installed into
}

export type ClientId = "claude-code" | "claude-desktop" | "codex" | "cursor";

/* ------------------------------------------------------------------ *
 * Endpoint model (what the AI ultimately queries)
 * ------------------------------------------------------------------ */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Endpoint {
  id: string;
  method: HttpMethod;
  /** path template with variable segments collapsed: /api/users/{id} */
  pathTemplate: string;
  queryParams: string[];
  requestSchema?: JsonSchema;
  responseSchema?: JsonSchema;
  statusCodes: number[];
  sampleCount: number;
  lastSeen: string;
  /** which auth signal was present (cookie name / header), never the value */
  authSignal?: string;
  confidence: "high" | "low"; // low = ambiguous path templating / sparse samples
}

// Intentionally loose — mirrors a permissive subset of JSON Schema.
export type JsonSchema = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * Extension ↔ core WebSocket messages (loopback, token-authed)
 * ------------------------------------------------------------------ */

export const WEFT_DEFAULT_PORT = 8787;

export type ExtMessage =
  | { t: "hello"; token: string; browser: string; profile: string }
  | { t: "convert"; origin: string }                       // the one button
  | { t: "cookies"; origin: string; cookies: CookieMeta[] }
  | { t: "storage"; origin: string; local: KV[]; session: KV[] }
  | { t: "request"; origin: string; req: CapturedRequest; res: CapturedResponse }
  | { t: "replay_result"; id: string; status: number; headers: KV[]; body?: string }
  | { t: "probe_result"; id: string; ok: boolean; status: number };

export type CoreCommand =
  | { t: "config"; redact: boolean; captureBodies: boolean }
  | { t: "replay"; id: string; origin: string; method: HttpMethod; path: string; query?: KV[]; headers?: KV[]; body?: string }
  | { t: "probe"; id: string; origin: string; path: string }   // lightweight GET to detect 401/403
  | { t: "open"; origin: string }                              // "refresh" — focus/open the tab for re-login
  | { t: "stop"; origin: string };

export interface KV { k: string; v: string }
export interface CookieMeta { name: string; domain: string; secure: boolean; httpOnly: boolean } // never the value over the wire by default
export interface CapturedRequest { method: HttpMethod; url: string; headers: KV[]; body?: string }
export interface CapturedResponse { status: number; headers: KV[]; contentType?: string; size?: number; body?: string }

/* ------------------------------------------------------------------ *
 * Desktop ↔ Tauri commands (invoke names)
 * ------------------------------------------------------------------ */

export interface WeftApi {
  list_mcps(): Promise<Mcp[]>;
  convert_site(origin: string): Promise<Mcp>;
  refresh_mcp(id: string): Promise<Mcp>;    // opens browser → re-syncs session
  recapture_mcp(id: string): Promise<Mcp>;
  pause_mcp(id: string): Promise<Mcp>;
  resume_mcp(id: string): Promise<Mcp>;
  delete_mcp(id: string): Promise<void>;
  install_client(id: string, client: ClientId): Promise<void>;
  get_endpoints(id: string): Promise<Endpoint[]>;
}
