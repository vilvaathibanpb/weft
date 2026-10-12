//! Shared core state: the one source of truth the WS server writes to and the Tauri commands read.
//! Short, non-async critical sections only — never hold the lock across `.await`.

use crate::model::{Endpoint, Model};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

const RECENT_CAP: usize = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mcp {
    pub id: String,
    pub name: String,
    pub origin: String,
    pub color: String,
    pub initials: String,
    pub status: String, // mirrors McpStatus in @weft/protocol
    pub endpoint_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_refreshed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointView {
    pub id: String,
    pub method: String,
    pub path_template: String,
    pub sample_count: u32,
    pub confidence: String,
}

/// Session auth surface for an origin — names/keys only, never values.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthContext {
    pub cookie_names: Vec<String>,
    pub local_keys: Vec<String>,
    pub session_keys: Vec<String>,
}

/// One line in the live request feed.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRequest {
    pub origin: String,
    pub method: String,
    pub path: String,
    pub status: u16,
}

#[derive(Default)]
pub struct CoreState {
    pub mcps: Vec<Mcp>,
    pub models: HashMap<String, Model>,     // keyed by origin
    pub auth: HashMap<String, AuthContext>, // keyed by origin
    pub recent: VecDeque<RecentRequest>,
}

pub type Shared = Arc<Mutex<CoreState>>;

impl CoreState {
    /// Ensure an MCP exists for this origin (create it in "capturing" if new). Returns its id.
    pub fn ensure(&mut self, origin: &str) -> String {
        let id = id_for(origin);
        if !self.mcps.iter().any(|m| m.id == id) {
            let host = host_of(origin);
            self.mcps.insert(
                0,
                Mcp {
                    id: id.clone(),
                    name: title_of(&host),
                    origin: origin.to_string(),
                    color: color_for(&host),
                    initials: initials_of(&host),
                    status: "capturing".to_string(),
                    endpoint_count: 0,
                    last_refreshed: None,
                    reason: None,
                },
            );
            self.models.entry(origin.to_string()).or_default();
        }
        id
    }

    /// Fold one captured request into the model and reflect it on the MCP.
    pub fn observe(&mut self, origin: &str, method: &str, url: &str, status: u16) {
        self.ensure(origin);
        let model = self.models.entry(origin.to_string()).or_default();
        model.observe(method, url, status);
        let count = model.len() as u32;
        if let Some(m) = self.mcps.iter_mut().find(|m| m.origin == origin) {
            m.endpoint_count = count;
            if m.status == "capturing" && count >= 1 {
                m.status = "ready".to_string(); // first real endpoint → serveable
            }
        }
        let (path, _) = crate::model::split_url(url);
        self.recent.push_front(RecentRequest {
            origin: origin.to_string(),
            method: method.to_string(),
            path,
            status,
        });
        self.recent.truncate(RECENT_CAP);
    }

    /// Record the session's cookie names for an origin (values are never sent).
    pub fn set_cookies(&mut self, origin: &str, names: Vec<String>) {
        self.auth
            .entry(origin.to_string())
            .or_default()
            .cookie_names = names;
    }

    /// Record local/session storage keys for an origin (values are never sent).
    pub fn set_storage(&mut self, origin: &str, local: Vec<String>, session: Vec<String>) {
        let a = self.auth.entry(origin.to_string()).or_default();
        a.local_keys = local;
        a.session_keys = session;
    }

    pub fn set_status(&mut self, id: &str, status: &str) -> Option<Mcp> {
        let m = self.mcps.iter_mut().find(|m| m.id == id)?;
        m.status = status.to_string();
        Some(m.clone())
    }

    pub fn remove(&mut self, id: &str) {
        if let Some(pos) = self.mcps.iter().position(|m| m.id == id) {
            let origin = self.mcps[pos].origin.clone();
            self.mcps.remove(pos);
            self.models.remove(&origin);
        }
    }

    /// Resolve an MCP by its id or its origin (what MCP tool callers pass as `site`).
    pub fn resolve(&self, key: &str) -> Option<Mcp> {
        self.mcps
            .iter()
            .find(|m| m.id == key || m.origin == key)
            .cloned()
    }

    /// The rich model endpoints for an origin (method, query params, status codes, confidence).
    pub fn model_endpoints(&self, origin: &str) -> Vec<Endpoint> {
        self.models
            .get(origin)
            .map(|m| m.endpoints())
            .unwrap_or_default()
    }

    pub fn auth_of(&self, origin: &str) -> AuthContext {
        self.auth.get(origin).cloned().unwrap_or_default()
    }

    pub fn recent(&self, limit: usize) -> Vec<RecentRequest> {
        self.recent.iter().take(limit).cloned().collect()
    }

    pub fn endpoints_of(&self, id: &str) -> Vec<EndpointView> {
        let Some(m) = self.mcps.iter().find(|m| m.id == id) else {
            return vec![];
        };
        let Some(model) = self.models.get(&m.origin) else {
            return vec![];
        };
        model
            .endpoints()
            .into_iter()
            .map(|e| EndpointView {
                id: format!("{} {}", e.method, e.path_template),
                method: e.method,
                path_template: e.path_template,
                sample_count: e.sample_count,
                confidence: match e.confidence {
                    crate::model::Confidence::High => "high".to_string(),
                    crate::model::Confidence::Low => "low".to_string(),
                },
            })
            .collect()
    }

    /// Demo content so the app window isn't empty before anything is captured.
    pub fn seeded() -> Self {
        let mk = |id: &str,
                  name: &str,
                  origin: &str,
                  color: &str,
                  initials: &str,
                  status: &str,
                  n: u32| Mcp {
            id: id.into(),
            name: name.into(),
            origin: origin.into(),
            color: color.into(),
            initials: initials.into(),
            status: status.into(),
            endpoint_count: n,
            last_refreshed: None,
            reason: None,
        };
        let mcps = vec![
            mk(
                "linear",
                "Linear",
                "https://app.linear.app",
                "#5e6ad2",
                "Li",
                "ready",
                41,
            ),
            mk(
                "github",
                "GitHub",
                "https://github.com",
                "#24292f",
                "Gh",
                "outdated",
                63,
            ),
            mk(
                "gmail",
                "Gmail",
                "https://mail.google.com",
                "#ea4335",
                "Gm",
                "needs_login",
                29,
            ),
            Mcp {
                reason: Some("signed_requests".into()),
                ..mk(
                    "stripe",
                    "Stripe Dashboard",
                    "https://dashboard.stripe.com",
                    "#635bff",
                    "St",
                    "not_possible",
                    0,
                )
            },
            mk(
                "figma",
                "Figma",
                "https://www.figma.com",
                "#a259ff",
                "Fi",
                "paused",
                27,
            ),
        ];
        CoreState {
            mcps,
            ..Default::default()
        }
    }
}

/* -------------------------- host → display helpers -------------------------- */

fn host_of(origin: &str) -> String {
    origin
        .split_once("://")
        .map(|x| x.1)
        .unwrap_or(origin)
        .split('/')
        .next()
        .unwrap_or(origin)
        .trim_start_matches("www.")
        .to_string()
}

fn id_for(origin: &str) -> String {
    host_of(origin).replace('.', "-")
}

/// The label we name a site after: the first "meaningful" one, skipping common subdomains
/// (so `app.linear.app` → `linear`, `mail.google.com` → `google`) and never the TLD.
fn base_label(host: &str) -> &str {
    const SKIP: &[&str] = &[
        "app",
        "www",
        "dashboard",
        "mail",
        "my",
        "web",
        "console",
        "admin",
        "portal",
        "api",
    ];
    let labels: Vec<&str> = host.split('.').collect();
    let n = labels.len();
    if n <= 1 {
        return host;
    }
    for (i, l) in labels.iter().enumerate() {
        if i + 1 >= n {
            break; // never the TLD
        }
        if !SKIP.contains(l) {
            return l;
        }
    }
    labels[0]
}

fn title_of(host: &str) -> String {
    let base = base_label(host);
    let mut c = base.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => host.to_string(),
    }
}

fn initials_of(host: &str) -> String {
    base_label(host)
        .chars()
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

fn color_for(seed: &str) -> String {
    const PALETTE: [&str; 7] = [
        "#5e6ad2", "#2d7ff9", "#1f9d6b", "#d1495b", "#c7841a", "#a259ff", "#0ea5e9",
    ];
    let mut h: u32 = 0;
    for b in seed.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u32);
    }
    PALETTE[(h as usize) % PALETTE.len()].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_skip_common_subdomains() {
        assert_eq!(title_of("app.linear.app"), "Linear");
        assert_eq!(title_of("mail.google.com"), "Google");
        assert_eq!(title_of("dashboard.stripe.com"), "Stripe");
        assert_eq!(title_of("github.com"), "Github");
        assert_eq!(title_of("localhost"), "Localhost");
        assert_eq!(initials_of("app.linear.app"), "LI");
    }

    #[test]
    fn observe_flips_capturing_to_ready_and_records_recent() {
        let mut s = CoreState::default();
        s.observe("https://x.com", "GET", "https://x.com/api/a", 200);
        let m = s.resolve("x-com").unwrap();
        assert_eq!(m.status, "ready");
        assert_eq!(m.endpoint_count, 1);
        assert_eq!(s.recent(5).len(), 1);
    }
}
