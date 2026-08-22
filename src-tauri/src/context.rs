use crate::db;
use crate::providers::ChatMessage;

/// Deliberately pessimistic proxy for tokens - no tokenizer is bundled, and
/// shipping BPE tables per model family would cost more than a conservative
/// estimate. Undercounting drops one extra old turn rather than overshooting
/// a provider's real limit.
const CHARS_PER_TOKEN: usize = 3;
/// Reserved out of the budget for the model's own reply.
pub const RESPONSE_RESERVE_TOKENS: u32 = 4096;

pub fn estimate_tokens(s: &str) -> u32 {
    s.chars().count().div_ceil(CHARS_PER_TOKEN) as u32
}

/// Result of assembling a request's message list under a token budget.
pub struct ContextPlan {
    pub messages: Vec<ChatMessage>,
    pub used_tokens: u32,
    pub budget_tokens: u32,
    pub dropped_count: usize,
    /// Rowid of the newest message that was dropped - the boundary a rolling
    /// summary must cover. `None` when nothing was dropped.
    pub newest_dropped_id: Option<i64>,
    /// Tokens spent on system-role content (the conversation system prompt
    /// plus any injected summary). Returned separately so an oversized
    /// prompt is attributable instead of looking like history bloat.
    pub system_tokens: u32,
}

/// Walks history backwards (newest-first, as `get_context_messages` returns
/// it) under a character budget, then reverses back to chronological order.
/// Pinned rows are always kept and don't count against the "drop the
/// oldest" walk - they're selected first, the remaining budget then fills
/// from the newest unpinned row backwards. Excluded rows never reach here -
/// `get_context_messages` filters them out in SQL.
///
/// The system prompt is charged against the same budget: previously it was
/// appended after selection and cost nothing, letting a long agent/skill
/// prompt silently blow past the configured window.
///
/// When rows get dropped and a `summary` is available (the conversation's
/// rolling memory), the summary is injected as a system-role turn right after
/// the system prompt instead of the dropped turns being lost outright.
pub fn plan_context(
    newest_first: &[db::ContextRow],
    system_prompt: Option<&str>,
    summary: Option<&str>,
    context_tokens: u32,
) -> ContextPlan {
    let budget_tokens = context_tokens.saturating_sub(RESPONSE_RESERVE_TOKENS);
    let budget_chars = (budget_tokens as usize).saturating_mul(CHARS_PER_TOKEN);

    let system_cost: usize = system_prompt.map(|s| s.chars().count()).unwrap_or(0);
    let mut used = system_cost;

    let pinned_cost: usize = newest_first
        .iter()
        .filter(|r| r.pinned)
        .map(|r| r.content.chars().count())
        .sum();
    used = used.saturating_add(pinned_cost);

    let mut kept: Vec<&db::ContextRow> = Vec::new();
    let mut dropped_count = 0usize;
    let mut newest_dropped_id = None;
    for (i, row) in newest_first.iter().enumerate() {
        if row.pinned {
            kept.push(row);
            continue;
        }
        let cost = row.content.chars().count();
        // Always keep the most recent turn even if it alone exceeds budget -
        // a request with no question in it is worse than one that's over
        // budget.
        if i == 0 || used.saturating_add(cost) <= budget_chars {
            kept.push(row);
            used = used.saturating_add(cost);
        } else {
            dropped_count += 1;
            // Drops happen from the oldest end, so the first dropped row in
            // this newest-first walk is the newest dropped one.
            newest_dropped_id.get_or_insert(row.id);
        }
    }

    // Restore chronological order: pinned rows were interleaved into `kept`
    // in their original (newest-first) relative order along with selected
    // unpinned rows, so a single reverse puts everything back in order.
    kept.reverse();

    // The summary only replaces dropped turns - with nothing dropped the full
    // history goes anyway and the summary would just be redundant.
    let injected_summary = (dropped_count > 0).then_some(summary).flatten();
    let system_chars = system_cost + injected_summary.map(|s| s.chars().count()).unwrap_or(0);

    let mut messages: Vec<ChatMessage> = Vec::with_capacity(kept.len() + 2);
    if let Some(prompt) = system_prompt {
        messages.push(ChatMessage {
            role: "system".into(),
            content: prompt.to_string(),
        });
    }
    if let Some(summary) = injected_summary {
        used = used.saturating_add(summary.chars().count());
        messages.push(ChatMessage {
            role: "system".into(),
            content: summary.to_string(),
        });
    }
    messages.extend(kept.into_iter().map(|r| ChatMessage {
        role: r.role.clone(),
        content: r.content.clone(),
    }));
    normalize_turns(
        &mut messages,
        system_prompt.is_some() || injected_summary.is_some(),
    );

    ContextPlan {
        messages,
        used_tokens: estimate_tokens(&"a".repeat(used)),
        budget_tokens,
        dropped_count,
        newest_dropped_id,
        system_tokens: estimate_tokens(&"a".repeat(system_chars)),
    }
}

/// Providers that require history to start on a user turn and strictly
/// alternate (Anthropic, Gemini) choke on a message list that breaks the
/// alternation - which a budget cut, an excluded row, or a retry that left a
/// duplicated user row behind can all produce. Two fixes here: consecutive
/// same-role turns are merged into one (the duplicate user rows conversation
/// 9's retries left behind), and a leading non-user turn (after the optional
/// system message) is dropped. System messages merge too so an injected
/// summary can't surface as a second system message - Anthropic and Gemini
/// only carry one.
fn normalize_turns(messages: &mut Vec<ChatMessage>, has_system: bool) {
    let start = if has_system { 1 } else { 0 };
    // Merge starts at 0, not `start`, so an injected summary (a second system
    // message right after the prompt) folds into the single system message
    // providers actually carry.
    let mut i = 0;
    while i + 1 < messages.len() {
        if messages[i].role == messages[i + 1].role {
            let next = messages.remove(i + 1);
            messages[i].content.push('\n');
            messages[i].content.push_str(&next.content);
        } else {
            i += 1;
        }
    }
    while messages.len() > start && messages[start].role != "user" {
        messages.remove(start);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(role: &str, content: &str) -> db::ContextRow {
        db::ContextRow {
            id: 0,
            role: role.into(),
            content: content.into(),
            pinned: false,
        }
    }

    fn pinned_row(role: &str, content: &str) -> db::ContextRow {
        db::ContextRow {
            id: 0,
            role: role.into(),
            content: content.into(),
            pinned: true,
        }
    }

    fn row_with_id(id: i64, role: &str, content: &str) -> db::ContextRow {
        db::ContextRow {
            id,
            role: role.into(),
            content: content.into(),
            pinned: false,
        }
    }

    #[test]
    fn plan_context_fits_entirely_under_a_generous_budget() {
        let newest_first = vec![
            row("user", "third"),
            row("assistant", "second"),
            row("user", "first"),
        ];
        let plan = plan_context(&newest_first, None, None, 32768);
        let contents: Vec<_> = plan.messages.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["first", "second", "third"]);
        assert_eq!(plan.dropped_count, 0);
        assert_eq!(plan.newest_dropped_id, None);
    }

    #[test]
    fn plan_context_drops_oldest_rows_first() {
        let newest_first = vec![
            row_with_id(5, "user", &"y".repeat(100)),
            row_with_id(4, "assistant", &"x".repeat(100)),
            row_with_id(3, "user", &"w".repeat(100)),
        ];
        let plan = plan_context(&newest_first, None, None, RESPONSE_RESERVE_TOKENS + 10);
        assert_eq!(plan.messages.len(), 1);
        assert_eq!(plan.messages[0].content, "y".repeat(100));
        assert_eq!(plan.dropped_count, 2);
        assert_eq!(plan.newest_dropped_id, Some(4));
    }

    #[test]
    fn plan_context_always_keeps_the_newest_turn_even_if_oversized() {
        let huge = "z".repeat(1_000_000);
        let newest_first = vec![row("user", &huge)];
        let plan = plan_context(&newest_first, None, None, 1);
        assert_eq!(plan.messages.len(), 1);
        assert_eq!(plan.messages[0].content, huge);
    }

    #[test]
    fn plan_context_handles_empty_input() {
        let plan = plan_context(&[], None, None, 32768);
        assert!(plan.messages.is_empty());
        assert_eq!(plan.dropped_count, 0);
        assert_eq!(plan.system_tokens, 0);
    }

    #[test]
    fn plan_context_charges_system_prompt_against_budget() {
        let newest_first = vec![row("user", &"y".repeat(100))];
        let system = "s".repeat(100);
        // Budget just barely covers the system prompt + the always-kept
        // newest turn, but not more.
        let plan = plan_context(
            &newest_first,
            Some(&system),
            None,
            RESPONSE_RESERVE_TOKENS + 100,
        );
        assert_eq!(plan.messages[0].role, "system");
        assert_eq!(plan.messages[0].content, system);
        assert_eq!(plan.messages[1].content, "y".repeat(100));
        assert_eq!(plan.system_tokens, estimate_tokens(&system));
    }

    #[test]
    fn plan_context_pinned_rows_survive_truncation() {
        let newest_first = vec![
            row("user", &"y".repeat(100)),
            row("assistant", &"x".repeat(100)),
            pinned_row("user", "important early fact"),
            row("assistant", &"w".repeat(100)),
            row("user", &"v".repeat(100)),
        ];
        let plan = plan_context(&newest_first, None, None, RESPONSE_RESERVE_TOKENS + 10);
        // With only a 10-token budget the newest turn and the pinned fact
        // survive; same-role merging may fold them into one user message, so
        // assert on the content reaching the request, not message boundaries.
        let full: String = plan
            .messages
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(full.contains("important early fact"));
        assert!(full.contains(&"y".repeat(100)));
    }

    #[test]
    fn plan_context_injects_summary_as_system_turn_when_dropping() {
        let newest_first = vec![
            row_with_id(5, "user", &"y".repeat(100)),
            row_with_id(4, "assistant", &"x".repeat(100)),
            row_with_id(3, "user", &"w".repeat(100)),
        ];
        let plan = plan_context(
            &newest_first,
            None,
            Some("earlier turns summarized"),
            RESPONSE_RESERVE_TOKENS + 10,
        );
        assert_eq!(plan.messages[0].role, "system");
        assert_eq!(plan.messages[0].content, "earlier turns summarized");
        assert_eq!(plan.messages[1].content, "y".repeat(100));
        assert_eq!(plan.dropped_count, 2);
    }

    #[test]
    fn plan_context_injects_summary_after_system_prompt() {
        let newest_first = vec![
            row_with_id(5, "user", &"y".repeat(100)),
            row_with_id(4, "assistant", &"x".repeat(100)),
            row_with_id(3, "user", &"w".repeat(100)),
        ];
        let plan = plan_context(
            &newest_first,
            Some("persona"),
            Some("memory"),
            RESPONSE_RESERVE_TOKENS + 60,
        );
        // normalize_turns merges the two system turns into one, because
        // Anthropic/Gemini only carry a single system message.
        assert_eq!(plan.messages.len(), 2);
        assert_eq!(plan.messages[0].role, "system");
        assert!(plan.messages[0].content.contains("persona"));
        assert!(plan.messages[0].content.contains("memory"));
        assert_eq!(plan.messages[1].role, "user");
    }

    #[test]
    fn plan_context_omits_summary_when_nothing_is_dropped() {
        let newest_first = vec![
            row("user", "third"),
            row("assistant", "second"),
            row("user", "first"),
        ];
        let plan = plan_context(&newest_first, None, Some("memory"), 32768);
        let roles: Vec<_> = plan.messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "user"]);
        assert!(!plan.messages.iter().any(|m| m.content == "memory"));
    }

    #[test]
    fn normalize_turns_drops_leading_non_user_row() {
        let mut messages = vec![
            ChatMessage {
                role: "assistant".into(),
                content: "orphaned reply".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "question".into(),
            },
        ];
        normalize_turns(&mut messages, false);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");
    }

    #[test]
    fn normalize_turns_leaves_system_message_in_place() {
        let mut messages = vec![
            ChatMessage {
                role: "system".into(),
                content: "prompt".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "orphaned reply".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "question".into(),
            },
        ];
        normalize_turns(&mut messages, true);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].role, "user");
    }

    #[test]
    fn normalize_turns_merges_consecutive_same_role_turns() {
        // The duplicated user rows a retry leaves behind - merged so strict
        // user/assistant alternation still holds.
        let mut messages = vec![
            ChatMessage {
                role: "user".into(),
                content: "first".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "second".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "reply one".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "reply two".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "follow up".into(),
            },
        ];
        normalize_turns(&mut messages, false);
        let roles: Vec<_> = messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "user"]);
        assert_eq!(messages[0].content, "first\nsecond");
        assert_eq!(messages[1].content, "reply one\nreply two");
    }

    #[test]
    fn normalize_turns_merges_system_messages_then_strips_leading_non_user() {
        let mut messages = vec![
            ChatMessage {
                role: "system".into(),
                content: "prompt".into(),
            },
            ChatMessage {
                role: "system".into(),
                content: "summary".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "orphan".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "question".into(),
            },
        ];
        normalize_turns(&mut messages, true);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[0].content, "prompt\nsummary");
        assert_eq!(messages[1].role, "user");
    }
}
