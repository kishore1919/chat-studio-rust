/** Feature flags for UI that has no backend behind it yet. The code stays in
 * the tree rather than being deleted - flipping these back on is meant to be
 * cheap once the backend catches up. */
export const FEATURES = {
  /** Real as of `set_conversation_system_prompt`: picking an agent applies
   * its system prompt (and provider/model, if it specifies one) to the
   * active conversation. */
  agents: true,
  /** Real as of `set_conversation_system_prompt`: running a skill sets it as
   * the conversation's system prompt via `/skill <name>` in Composer. */
  skills: true,
} as const
