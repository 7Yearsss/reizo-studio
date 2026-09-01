# Reizo Conversation Lifecycle

This context defines the language used by the desktop conversation runtime. It keeps provider output, user controls, and renderer state aligned around one explicit turn lifecycle.

## Turn Lifecycle

**Turn**:
A single user submission and the agent work it starts, including tool calls, questions, partial output, and one terminal outcome.
_Avoid_: Message, request, stream (these are parts of a turn).

**Continuation**:
The agent's decision to keep the same turn running after an intermediate event, such as a tool result or user-provided permission/answer.
_Avoid_: Retry (a retry starts a new turn attempt).

**Interruption**:
A turn that stops before its provider work reaches a terminal completion, whether caused by the user, lost transport, process exit, or watchdog.
_Avoid_: Completion, cancellation (cancellation is a user intent; interruption is the observed outcome).

**Completion**:
A turn that received an authoritative provider/session terminal signal and persisted its final assistant result; an empty provider result is classified explicitly and never implies success.
_Avoid_: Stream EOF, idle, no longer loading.

**Resume**:
Reattaching to the same interrupted turn using its turn identity and event cursor, then folding only unseen events.
_Avoid_: Regenerate, retry (those create a new attempt from an existing user message).

**Retry**:
Starting a new turn attempt from the last user input after an interrupted or failed turn; it must not be presented as a transparent continuation.
_Avoid_: Resume.

**Terminal outcome**:
The immutable result of a turn: `completed`, `interrupted`, or `error`. A turn cannot silently transition from running to terminal without an explicit outcome.
_Avoid_: Done ("done" is a transport event, not a user-facing outcome).
