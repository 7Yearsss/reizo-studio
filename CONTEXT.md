# Reizo Conversation Lifecycle

## Product layout

Keep Reizo's original conversation-first workspace: navigation on the far left,
Agent conversation in the main area, and canvas/tools in the resizable right panel.
Preserve its single title bar, panel resize/maximize/close behavior, and existing
visual identity. Competitor research informs individual interactions, not a new
global layout, unless the user explicitly asks to redesign it.

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

## Usage records

Usage lists expose reported counters, model/provider identity, task status when
known, and the originating conversation. A usage report does not prove an entire
task succeeded. Filters and pagination are applied to the full persisted ledger;
overview totals use the same filters, independently of how many rows are loaded.
Keep recorded bills, price-based estimates and unpriced calls distinct. A missing
price or usage report is not a zero charge. Never add different currencies or
overlapping token/observed-output counters. Existing price snapshots and invoice
evidence remain immutable; this view does not automatically synchronize charges.

## Account Wallet

Account login offers browser approval and direct username/email-password login.
Both issue the same revocable desktop grant and use the existing encrypted local
credential store, model bootstrap and wallet authorization. Passwords are submitted
only to the configured account origin and never persisted or echoed in account state.

The signed-in account menu offers **钱包与充值**. Wallet balance and recharge
configuration come from the current Reizo web workspace. Select an amount and
payment method in the desktop, then open the isolated native cashier for payment.
Only the website's confirmed order status means credited; browser return does not.
Retries reuse the same request identity and continuing payment reopens the same
unpaid order. Pin the workspace reviewed by the user, keep desktop credentials in
the main process, and do not apply this balance to manual third-party API keys.
Cashier parameters stay in main and are checked against the original order before
direct HTTPS POST in a sandboxed window with no desktop preload or account cookies.
The local usage ledger remains separate from the cloud wallet. See
`docs/account-wallet.md` for contracts and deployment requirements.

## Creative Assets

### Video link analysis

`analyze_video` reads actual timestamped frames and available HTML subtitle tracks
from a public video page or MP4/WebM link. A bare recognised video/post link starts
this tool before a text response. It uses the same sandboxed Chromium media reader
on Windows and macOS, independently of the Windows-only video editor. A login wall
uses the existing `browser_open` flow and explicit `signedIn:true` retry.

Frame files and metadata are saved separately; provider requests contain actual
images, including on permission resume and later turns. Keep sampled evidence,
page/post text, inferred events and untranscribed audio distinct. No full audio
transcription is currently performed by this tool. See `docs/video-analysis.md`.

Standard image and video requests run in the conversation. Show a loading card
where the request starts, then replace it with an image preview or playable video.
Keep the result visible while the assistant continues replying. Long-running media
uses its persisted job receipt so the card can recover after a reload without
submitting again. A chat result follows that job's saved output, not the canvas
node's newer selected version. Open and focus the canvas only when the user
chooses **带到画布**; explicit canvas workflows and director plans keep their
existing canvas behavior.

An accepted remote video remains in progress until the provider reports a terminal
outcome or the user stops tracking it. Ten minutes of waiting is not failure.
Back off long-running queries and transient transport errors; show elapsed time,
only provider-reported percentages, and a background tracking hint in chat.
Refresh credentials when querying the same saved handle. Hiding a model from new
generation choices must not discard a task already accepted by the gateway.
An explicit **继续查询** on an interrupted video creates a linked query-only receipt
for its original remote handle. Keep the old terminal history immutable, follow
the saved recovery in its original chat card, and never POST another generation
or create another billable usage entry for this recovery.

Before a standard video generation, read the configured video model catalog and
let the user choose the video model through the existing question cards unless
they already specified it. This selection is independent of the chat text model.
Carry both model and provider identity into the saved generation request. Only
offer known supported ratios/durations; do not invent available models or prices.
Keep the signed-in account's video catalog available when the text conversation
uses another configured provider. The conversation picker, canvas picker and
video executor must preserve this independence and the selected media identity.
Image generation and image model pickers share this independence. When a signed-in
account advertises the requested image model (or no image model was selected),
automatic image requests use that account's media credentials, not the active
text provider's key. Honor an explicitly supplied image provider and keep models
exclusive to a manual provider on that provider. Choose image defaults only from
the account's advertised image catalog; do not change the text selection or retry
a failed generation on another provider.

**Asset**:
An existing media result with its own identity and origin, independent of the node currently displaying it.
_Avoid_: Node, generation (these have different lifetimes).

**Selected version**:
The version currently chosen for display and for references that follow a producer's selection.
_Avoid_: Latest generation (the selected version may be older).

**Fixed reference**:
A deliberate reference to one existing asset; later changes to its original producer do not change that reference.
_Avoid_: Current preview, selected version (those may change).

**Asset reuse**:
Making an existing asset available in another creative context while retaining its origin, without generating new media.
_Avoid_: Regenerate, rerun.
