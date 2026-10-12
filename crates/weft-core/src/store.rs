//! SQLite persistence so converted MCPs + their endpoint models survive restarts.
//! Credential VALUES never live here — only metadata (names/flags). Values stay in the OS keychain.

pub struct Store {
    // conn: rusqlite::Connection,
}

impl Store {
    /// Open (and migrate) the DB in the app-data dir.
    pub fn open(_path: &std::path::Path) -> Self {
        // TODO: create tables: mcp(id, name, origin, status, last_refreshed, reason, partial),
        //       endpoint(mcp_id, method, template, query, req_schema, res_schema, samples, confidence),
        //       audit(ts, mcp_id, tool, detail).
        Self {}
    }

    // TODO: upsert_mcp, list_mcps, upsert_endpoint, list_endpoints, append_audit.
}
