//! The append-only event log per session.
//!
//! This module persists and returns *raw* event rows only. Payload-aware
//! projections — concatenating a session's assistant output for a workflow
//! handoff, or detecting an unanswered `AskUserQuestion`/`ExitPlanMode` at the
//! tail of a turn — are NOT the store's job. They parse `AgentEvent` payloads
//! and belong in `agent::transcript`, computed over `list_events`. The old
//! `get_session_assistant_text` / `session_has_pending_question` helpers lived
//! here only because the data did; they move with the interpretation.

use crate::error::Result;
use crate::event::AgentEvent;
use crate::util::{now_rfc3339, uuid};
use crate::EventRecord;

use super::mappers::map_event;
use super::{query_vec_try, with_tx, Store};

impl Store {
    /// Append an event to a session's log, assigning the next sequence number.
    pub fn append_event(&self, session_id: &str, event: &AgentEvent) -> Result<EventRecord> {
        let conn = self.lock();
        let seq: i64 = conn.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        let record = EventRecord {
            id: uuid(),
            session_id: session_id.to_string(),
            seq,
            ts: now_rfc3339(),
            event: event.clone(),
        };
        conn.execute(
            "INSERT INTO events (id, session_id, seq, ts, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                &record.id,
                &record.session_id,
                record.seq,
                &record.ts,
                serde_json::to_string(&record.event)?,
            ),
        )?;
        Ok(record)
    }

    /// Append a line's events and advance the tailer's drained-offset in one
    /// transaction, so a crash-then-replay neither loses nor duplicates events.
    /// The offset update is generation-guarded by `proc_id` like the other
    /// `agent_procs` writes.
    pub fn append_events_with_offset(
        &self,
        session_id: &str,
        proc_id: &str,
        events: &[AgentEvent],
        offset: u64,
    ) -> Result<Vec<EventRecord>> {
        with_tx(&mut self.lock(), |tx| {
            let next_seq: i64 = tx.query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            let mut records = Vec::with_capacity(events.len());
            for (i, event) in events.iter().enumerate() {
                let record = EventRecord {
                    id: uuid(),
                    session_id: session_id.to_string(),
                    seq: next_seq + i as i64,
                    ts: now_rfc3339(),
                    event: event.clone(),
                };
                tx.execute(
                    "INSERT INTO events (id, session_id, seq, ts, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
                    (
                        &record.id,
                        &record.session_id,
                        record.seq,
                        &record.ts,
                        serde_json::to_string(&record.event)?,
                    ),
                )?;
                records.push(record);
            }
            tx.execute(
                "UPDATE agent_procs SET out_offset = ?3 WHERE session_id = ?1 AND proc_id = ?2",
                (session_id, proc_id, offset as i64),
            )?;
            Ok(records)
        })
    }

    pub fn list_events(&self, session_id: &str) -> Result<Vec<EventRecord>> {
        query_vec_try(
            &self.lock(),
            "SELECT id, session_id, seq, ts, payload FROM events
             WHERE session_id = ?1 ORDER BY seq",
            [session_id],
            map_event,
        )
    }
}
