//! Synthesize an OpenAPI 3.1 document from observed traffic.
//!
//! This is deliberately conservative: we only assert what we actually saw — paths, methods,
//! query-parameter names, and observed status codes. We do not invent request/response schemas
//! we didn't capture. An AI client gets a spec it can trust rather than a confident fiction.

use crate::model::{Confidence, Endpoint};
use serde_json::{json, Map, Value};

/// Build an OpenAPI 3.1 document for one origin from its endpoints.
pub fn synth(title: &str, origin: &str, endpoints: &[Endpoint]) -> Value {
    let mut paths: Map<String, Value> = Map::new();

    for e in endpoints {
        let item = paths
            .entry(e.path_template.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        let Some(item) = item.as_object_mut() else {
            continue;
        };

        let mut responses = Map::new();
        for code in &e.status_codes {
            responses.insert(
                code.to_string(),
                json!({ "description": reason_phrase(*code) }),
            );
        }
        if responses.is_empty() {
            responses.insert(
                "default".into(),
                json!({ "description": "observed response" }),
            );
        }

        let params: Vec<Value> = e
            .query_params
            .iter()
            .map(|p| {
                json!({
                    "name": p,
                    "in": "query",
                    "required": false,
                    "schema": { "type": "string" }
                })
            })
            .collect();

        let mut op = Map::new();
        op.insert(
            "summary".into(),
            json!(format!("{} {}", e.method, e.path_template)),
        );
        op.insert(
            "operationId".into(),
            json!(operation_id(&e.method, &e.path_template)),
        );
        if !params.is_empty() {
            op.insert("parameters".into(), Value::Array(params));
        }
        op.insert("responses".into(), Value::Object(responses));
        // Flag the ones we're unsure about so the model doesn't over-trust a single sample.
        if e.confidence == Confidence::Low {
            op.insert("x-weft-confidence".into(), json!("low"));
        }
        op.insert("x-weft-samples".into(), json!(e.sample_count));

        item.insert(e.method.to_lowercase(), Value::Object(op));
    }

    json!({
        "openapi": "3.1.0",
        "info": {
            "title": format!("{title} (observed)"),
            "version": "0.0.0",
            "description": format!(
                "Synthesized by Weft from live traffic on {origin}. Only observed paths, methods, \
                 query params and status codes are asserted — schemas are not inferred."
            )
        },
        "servers": [{ "url": origin }],
        "paths": Value::Object(paths)
    })
}

fn operation_id(method: &str, path: &str) -> String {
    let slug: String = path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{}{}", method.to_lowercase(), slug)
}

fn reason_phrase(code: u16) -> &'static str {
    match code {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "observed response",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Model;

    #[test]
    fn synthesizes_paths_and_methods() {
        let mut m = Model::default();
        m.observe("GET", "https://x.com/api/issues?mine=1", 200);
        m.observe("GET", "https://x.com/api/issues/42", 200);
        m.observe("POST", "https://x.com/api/issues", 201);
        let doc = synth("X", "https://x.com", &m.endpoints());

        assert_eq!(doc["openapi"], "3.1.0");
        assert_eq!(doc["servers"][0]["url"], "https://x.com");
        let paths = doc["paths"].as_object().unwrap();
        assert!(paths.contains_key("/api/issues"));
        assert!(paths.contains_key("/api/issues/{id}"));
        assert_eq!(
            doc["paths"]["/api/issues"]["post"]["responses"]["201"]["description"],
            "Created"
        );
        // query param recorded
        let params = doc["paths"]["/api/issues"]["get"]["parameters"]
            .as_array()
            .unwrap();
        assert!(params.iter().any(|p| p["name"] == "mine"));
    }
}
