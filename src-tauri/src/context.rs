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
    s.len().div_ceil(CHARS_PER_TOKEN) as u32
}

/// Result of assembling a request's message list under a token budget.
pub struct ContextPlan {
    pub messages: Vec<ChatMessage>,
    pub used_tokens: u32,
    pub budget_tokens: u32,
    pub dropped_count: usize,
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
pub fn plan_context(
    newest_first: &[db::ContextRow],
    system_prompt: Option<&str>,
    context_tokens: u32,
) -> ContextPlan {
    let budget_tokens = context_tokens.saturating_sub(RESPONSE_RESERVE_TOKENS);
    let budget_chars = (budget_tokens as usize).saturating_mul(CHARS_PER_TOKEN);

    let system_cost = system_prompt.map(|s| s.len()).unwrap_or(0);
    let mut used = system_cost;

    let pinned_cost: usize = newest_first
        .iter()
        .filter(|r| r.pinned)
        .map(|r| r.content.len())
        .sum();
    used = used.saturating_add(pinned_cost);

    let mut kept: Vec<&db::ContextRow> = Vec::new();
    let mut dropped_count = 0usize;
    for (i, row) in newest_first.iter().enumerate() {
        if row.pinned {
            kept.push(row);
            continue;
        }
        let cost = row.content.len();
        // Always keep the most recent turn even if it alone exceeds budget -
        // a request with no question in it is worse than one that's over
        // budget.
        if i == 0 || used.saturating_add(cost) <= budget_chars {
            kept.push(row);
            used = used.saturating_add(cost);
        } else {
            dropped_count += 1;
        }
    }

    // Restore chronological order: pinned rows were interleaved into `kept`
    // in their original (newest-first) relative order along with selected
    // unpinned rows, so a single reverse puts everything back in order.
    kept.reverse();

    let mut messages: Vec<ChatMessage> = Vec::with_capacity(kept.len() + 1);
    if let Some(prompt) = system_prompt {
        messages.push(ChatMessage {
            role: "system".into(),
            content: prompt.to_string(),
        });
    }
    messages.extend(kept.into_iter().map(|r| ChatMessage {
        role: r.role.clone(),
        content: r.content.clone(),
    }));
    normalize_turns(&mut messages, system_prompt.is_some());

    ContextPlan {
        messages,
        used_tokens: estimate_tokens(&"a".repeat(used)),
        budget_tokens,
        dropped_count,
    }
}

/// Drops a leading non-user turn (after the optional system message) so
/// providers that require history to start on a user turn and strictly
/// alternate (Anthropic, Gemini) don't choke when a budget cut or an
/// excluded row leaves a bare `assistant` turn at the front.
fn normalize_turns(messages: &mut Vec<ChatMessage>, has_system: bool) {
    let start = if has_system { 1 } else { 0 };
    while messages.len() > start && messages[start].role != "user" {
        messages.remove(start);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(role: &str, content: &str) -> db::ContextRow {
        db::ContextRow {
            role: role.into(),
            content: content.into(),
            pinned: false,
        }
    }

    fn pinned_row(role: &str, content: &str) -> db::ContextRow {
        db::ContextRow {
            role: role.into(),
            content: content.into(),
            pinned: true,
        }
    }

    #[test]
    fn plan_context_fits_entirely_under_a_generous_budget() {
        let newest_first = vec![
            row("user", "third"),
            row("assistant", "second"),
            row("user", "first"),
        ];
        let plan = plan_context(&newest_first, None, 32768);
        let contents: Vec<_> = plan.messages.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["first", "second", "third"]);
        assert_eq!(plan.dropped_count, 0);
    }

    #[test]
    fn plan_context_drops_oldest_rows_first() {
        let newest_first = vec![
            row("user", &"y".repeat(100)),
            row("assistant", &"x".repeat(100)),
            row("user", &"w".repeat(100)),
        ];
        let plan = plan_context(&newest_first, None, RESPONSE_RESERVE_TOKENS + 10);
        assert_eq!(plan.messages.len(), 1);
        assert_eq!(plan.messages[0].content, "y".repeat(100));
        assert_eq!(plan.dropped_count, 2);
    }

    #[test]
    fn plan_context_always_keeps_the_newest_turn_even_if_oversized() {
        let huge = "z".repeat(1_000_000);
        let newest_first = vec![row("user", &huge)];
        let plan = plan_context(&newest_first, None, 1);
        assert_eq!(plan.messages.len(), 1);
        assert_eq!(plan.messages[0].content, huge);
    }

    #[test]
    fn plan_context_handles_empty_input() {
        let plan = plan_context(&[], None, 32768);
        assert!(plan.messages.is_empty());
        assert_eq!(plan.dropped_count, 0);
    }

    #[test]
    fn plan_context_charges_system_prompt_against_budget() {
        let newest_first = vec![row("user", &"y".repeat(100))];
        let system = "s".repeat(100);
        // Budget just barely covers the system prompt + the always-kept
        // newest turn, but not more.
        let plan = plan_context(&newest_first, Some(&system), RESPONSE_RESERVE_TOKENS + 100);
        assert_eq!(plan.messages[0].role, "system");
        assert_eq!(plan.messages[0].content, system);
        assert_eq!(plan.messages[1].content, "y".repeat(100));
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
        let plan = plan_context(&newest_first, None, RESPONSE_RESERVE_TOKENS + 10);
        let contents: Vec<_> = plan.messages.iter().map(|m| m.content.as_str()).collect();
        assert!(contents.contains(&"important early fact"));
        // Newest turn always kept too.
        assert!(contents.contains(&"y".repeat(100).as_str()));
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
}
