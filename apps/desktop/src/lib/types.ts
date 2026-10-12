// Mirrors @weft/protocol (kept local so the Vite app runs without cross-package resolution).

export type McpStatus =
  | "capturing" | "ready" | "outdated" | "needs_login" | "refreshing" | "not_possible" | "paused";

export type NotPossibleReason =
  | "signed_requests" | "fingerprint_bound" | "no_api" | "non_replayable" | "drm";

export type ClientId = "claude-code" | "claude-desktop" | "codex" | "cursor";

export interface Mcp {
  id: string;
  name: string;
  origin: string;
  color: string;
  initials: string;
  status: McpStatus;
  endpointCount: number;
  lastRefreshed?: string;
  reason?: NotPossibleReason;
  drift?: { newEndpoints: number; changed: number };
  partial?: boolean;
  pinnedClients?: ClientId[];
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Endpoint {
  id: string;
  method: HttpMethod;
  pathTemplate: string;
  sampleCount: number;
  confidence: "high" | "low";
}

export const STATUS_LABEL: Record<McpStatus, string> = {
  capturing: "Capturing",
  ready: "Ready",
  outdated: "Outdated",
  needs_login: "Needs login",
  refreshing: "Refreshing",
  not_possible: "Not possible",
  paused: "Paused",
};

export const REASON_TEXT: Record<NotPossibleReason, string> = {
  signed_requests: "Requests are signed per-call (HMAC / nonce / timestamp), so a replayed request is rejected.",
  fingerprint_bound: "Requests are bound to a device fingerprint or a JS challenge that can't be reproduced out of context.",
  no_api: "The site is server-rendered HTML with no XHR/fetch JSON API to expose as tools.",
  non_replayable: "Data arrives only over WebSocket / gRPC-web / SSE — there are no replayable request/response pairs.",
  drm: "The content is DRM-protected or heavily obfuscated.",
};
