//! Endpoint model: turn raw captured requests into deduped, path-templated endpoints.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub method: String,
    /// Variable segments collapsed: `/api/users/{id}`.
    pub path_template: String,
    pub query_params: Vec<String>,
    pub status_codes: Vec<u16>,
    pub sample_count: u32,
    pub confidence: Confidence,
    pub auth_signal: Option<String>,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Low,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotPossible {
    SignedRequests,
    FingerprintBound,
    NoApi,
    NonReplayable,
    Drm,
}

#[derive(Default)]
pub struct Model {
    endpoints: HashMap<String, Endpoint>, // key = "METHOD template"
}

impl Model {
    /// Fold one captured request into the model. Returns true if this was a newly-seen endpoint.
    pub fn observe(&mut self, method: &str, url: &str, status: u16) -> bool {
        let (path, query) = split_url(url);
        let template = templatize(&path);
        let key = format!("{method} {template}");
        let is_new = !self.endpoints.contains_key(&key);
        let e = self.endpoints.entry(key).or_insert_with(|| Endpoint {
            method: method.to_string(),
            path_template: template.clone(),
            query_params: vec![],
            status_codes: vec![],
            sample_count: 0,
            confidence: Confidence::High,
            auth_signal: None,
        });
        e.sample_count += 1;
        if status != 0 && !e.status_codes.contains(&status) {
            e.status_codes.push(status);
        }
        for q in query {
            if !q.is_empty() && !e.query_params.contains(&q) {
                e.query_params.push(q);
            }
        }
        // A templated path we've only seen once is a low-confidence guess.
        e.confidence = if e.path_template.contains('{') && e.sample_count < 2 {
            Confidence::Low
        } else {
            Confidence::High
        };
        is_new
    }

    pub fn len(&self) -> usize {
        self.endpoints.len()
    }

    pub fn is_empty(&self) -> bool {
        self.endpoints.is_empty()
    }

    /// Endpoints sorted by path then method, for stable display.
    pub fn endpoints(&self) -> Vec<Endpoint> {
        let mut v: Vec<Endpoint> = self.endpoints.values().cloned().collect();
        v.sort_by(|a, b| {
            a.path_template
                .cmp(&b.path_template)
                .then(a.method.cmp(&b.method))
        });
        v
    }

    /// Analyze captured traffic to decide whether replays can work.
    pub fn convertibility(&self) -> Result<(), NotPossible> {
        // TODO: detect per-request signing / fingerprint binding / ws-only transport.
        if self.is_empty() {
            return Err(NotPossible::NoApi);
        }
        Ok(())
    }
}

/// Collapse variable path segments (numeric ids, uuids, long hashes) to templates.
pub fn templatize(path: &str) -> String {
    let out: Vec<String> = path
        .split('/')
        .map(|seg| {
            if seg.is_empty() {
                String::new()
            } else if seg.chars().all(|c| c.is_ascii_digit()) {
                "{id}".to_string()
            } else if is_uuid(seg) {
                "{uuid}".to_string()
            } else if seg.len() >= 24 && seg.chars().all(|c| c.is_ascii_hexdigit()) {
                "{hash}".to_string()
            } else {
                seg.to_string()
            }
        })
        .collect();
    let joined = out.join("/");
    if joined.is_empty() {
        "/".to_string()
    } else {
        joined
    }
}

fn is_uuid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts[0].len() == 8
        && parts[1].len() == 4
        && parts[2].len() == 4
        && parts[3].len() == 4
        && parts[4].len() == 12
        && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Split a full URL into (path, query-param-names). No `url` crate needed.
pub fn split_url(u: &str) -> (String, Vec<String>) {
    let after_scheme = u.split_once("://").map(|x| x.1).unwrap_or(u);
    let path_and = match after_scheme.find('/') {
        Some(i) => after_scheme[i..].to_string(),
        None => "/".to_string(),
    };
    let (p, q) = match path_and.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (path_and, String::new()),
    };
    let names = q
        .split('&')
        .filter(|x| !x.is_empty())
        .map(|kv| kv.split('=').next().unwrap_or("").to_string())
        .collect();
    (p, names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templatizes_ids_and_uuids() {
        assert_eq!(templatize("/api/users/42"), "/api/users/{id}");
        assert_eq!(templatize("/api/users/me"), "/api/users/me");
        assert_eq!(
            templatize("/v1/teams/3fa85f64-5717-4562-b3fc-2c963f66afa6/members"),
            "/v1/teams/{uuid}/members"
        );
    }

    #[test]
    fn dedups_and_counts() {
        let mut m = Model::default();
        assert!(m.observe("GET", "https://x.com/api/issues?mine=1", 200));
        assert!(!m.observe("GET", "https://x.com/api/issues?team=2", 200)); // same endpoint
        assert!(m.observe("GET", "https://x.com/api/issues/42", 200)); // templated → distinct
        assert!(m.observe("POST", "https://x.com/api/issues", 201)); // method distinct
        assert_eq!(m.len(), 3);
        let eps = m.endpoints();
        let issues = eps
            .iter()
            .find(|e| e.path_template == "/api/issues" && e.method == "GET")
            .unwrap();
        assert_eq!(issues.sample_count, 2);
        assert!(issues.query_params.contains(&"mine".to_string()));
        assert!(issues.query_params.contains(&"team".to_string()));
    }
}
