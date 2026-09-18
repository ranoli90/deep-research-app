# Mobile Screen and State Specification

These are implementation requirements. They are not screenshots or claims that native validation has occurred.

## Navigation and global behavior

Use Research and Library as the two stable primary destinations. A profile control opens Settings. New research is always available without traversing an agent dashboard. Keep a research conversation's route stable while its job runs. A notification/deep link opens the exact conversation and verifies the signed-in owner before fetching it.

Use a tablet/foldable master-detail layout only when space supports it; do not force a phone into desktop density. On narrow devices, secondary information opens as a sheet or dedicated detail screen. Respect back-navigation conventions on both systems. Android back closes a sheet/keyboard before navigating away. Navigation must never silently cancel a server job.

Preserve drafts, report scroll anchors, collapsed sections, and local display preferences across ordinary navigation. Clear account-specific cached state on logout/account switch. A draft containing potentially sensitive content must follow an explicit local retention policy rather than live forever in unprotected storage.

## 1. First launch and authentication

Screen states: fresh install, signed-out return, expired session, signing in, sign-in failed, email verification/pending, authenticated, and unavailable network. Do not present a paid live research button that will fail because authentication is missing.

Offer a labeled example report without requiring payment. A user can draft before sign-in; make the preservation behavior explicit and test it. Disclose AI processing before the first actual transfer. Declining consent leaves the user able to view the sample and settings, without secretly initiating requests.

Email sign-in/deep-link flows must validate redirects and avoid displaying raw auth tokens. Social sign-in is optional until its complete native and store requirements are implemented. Do not show providers with broken credentials. Recovery, resending, expiry, and account switching need defined behavior.

## 2. Composer

Normal content: a short welcoming prompt, a multiline field, attach action, mode selector, and send. Example prompts must be specific useful tasks, not a grid of generic AI slogans. Show few or none after the user has history.

Handle empty/whitespace input, long pasted text, emoji and Unicode, multiline text, pasted URLs, hardware keyboard, autocorrect, selection, dictation supplied by the operating system, and right-to-left text within a primarily English interface. Enter behavior must not surprise mobile keyboard users; explicit send remains available.

Use a growing composer with a maximum visible height and internal scroll, so a long question does not cover the entire screen. The send button has a stable hit target and prevents accidental duplicate submissions with server-side idempotency, not just a disabled animation.

Attach controls show permissible formats, remaining count, and size limits before upload. A removed file is detached from the brief and queued for appropriate deletion; stale upload completion callbacks must not attach it again.

## 3. Clarification and assumptions

Present at most a compact group of material questions. Each question should be answerable without knowing research jargon. Keep the user's original question visible or recoverable. Suggested options must not silently choose a consequential personal fact.

Provide an “Use these assumptions” or equivalent start path when safe, showing the assumptions briefly. When missing information truly prevents safe execution, explain the specific missing input. Do not create an infinite clarify loop; record previous answers as hard context.

Editing the question before starting invalidates stale clarification suggestions. Submitting repeated answers is idempotent. A lost network request must recover server state rather than start a duplicate run.

## 4. Active research

Primary content: question, short current stage, safe activity summary, elapsed time measured from server state, cancel, and an optional details expansion. Use indeterminate progress unless genuine bounded progress exists. Distinguish queued from actively researching.

Detailed activity is an ordered set of real events: searched a topic, opened a source, found conflicting figures, checked an assumption, drafted a report. Do not fabricate animated team dialogue. Explain a pivot in one sentence anchored to findings, not a stream of private reasoning.

Show useful partial findings only after they exist and label them provisional. Source counts explicitly distinguish found/read/cited where shown. In-app progress can be more detailed than a privacy-safe push notification.

When the user scrolls up, new events must not pull them down. Offer a subtle new-content control. Screen readers should receive bounded meaningful status changes rather than every streamed token.

Cancel first enters “Stopping new work”; it must not falsely claim an already-issued opaque provider request is stopped. Explain retained partial results and allowance outcome once known. Do not force a second confirmation for a harmless routine cancellation, but do not confuse cancel with deletion.

## 5. Connectivity, app lifecycle, and notifications

Offline: retain the readable report/draft that policy allows, show an offline banner, disable network-dependent actions with explanation, and recover automatically. Do not enqueue a paid submission invisibly while offline. On network restoration, ask/confirm according to the original submission state and idempotency record rather than guessing.

Background/terminated: server research continues. On reopen, request a state snapshot plus missed events. Notifications are optional and delivery is not guaranteed. A denied permission leaves the core app functional. An invalid push token is retired; retry notification failures without resending the research job.

A research completion notification defaults to nonsensitive copy such as “Your research is ready.” Account switching unregisters the old account/device binding. Notification navigation must recheck ownership and show a safe unavailable state for deleted reports.

## 6. Report reader

Use stable structured blocks with strong reading hierarchy. Put the actual answer first. Long reports receive a compact outline, section anchors, and source access. Tables scroll horizontally within their boundary or become accessible stacked comparisons; do not shrink text to illegibility.

Support text selection, copy section/report, code block horizontal scroll, external links, citation navigation, and native sharing. Do not render raw generated HTML. Long unbroken URLs or code cannot expand the entire screen width.

The report states its research date and important scope limitations. It distinguishes external evidence, inference, user-supplied facts, and calculation as needed without badges on every sentence. Do not display a numerical truth/confidence score without a validated calibrated meaning.

Writing/streaming states must not repeatedly reflow the whole document. Final publication should be atomic enough that a report cannot look complete while lacking its final citations. Keep the composer accessible below the report without covering content.

## 7. Source sheet

Display title, domain/publisher, relevant dates with unknowns labeled, source type, original link, short supporting passage, locator, and relevant access/extraction limitations. Keep the most useful evidence above low-level metadata.

Buttons: open original and close/back; optionally expand evidence context. Do not show a nonexistent downloaded document or claim a highlighted page exists when only a snippet is available. A deleted or inaccessible source reference returns a truthful error without blanking the report.

Entering/leaving the sheet preserves report scroll position and keyboard focus. VoiceOver/TalkBack receives a descriptive citation label, sheet heading, and appropriate close action.

## 8. Follow-up and report versions

Provide optional relevant actions plus free text, not a wall of chips. “Go deeper” scopes to selected content when selected. “Check this claim” identifies the claim and supporting evidence. “Find contrary evidence” does not manufacture disagreement when the evidence is consistent.

Before a paid continuation, show its allowance effect. The new run references its parent and uses an updated brief. A change summary explains altered findings rather than just saying “updated.” Preserve version history and its source references. Do not overwrite an earlier report while it is being exported.

## 9. Library

States: no reports, sample-only, loading, results, search-empty, offline, error, and deleted item. Use readable titles, brief metadata, and discreet run status. Rename should not change the underlying research content. Archive is reversible; delete is clearly destructive and follows the retention policy.

Paginate long histories. Search must respect ownership and include only permitted content. Avoid creating separate confusing tabs for chats, runs, reports, sources, and projects; those are data relationships, not necessarily navigation destinations.

## 10. Settings, billing, and help

Group Account, Appearance, Research preferences, Notifications, Usage & purchases, Privacy & data, and Help. Hide developer/provider diagnostics from normal users.

Usage shows allowance, pending reservations, settled usage, and any relevant reset/expiry policy with actual time zones. Do not invent time-to-complete or remaining run counts when tasks have variable cost. Restore purchase is available and handles restore-to-wrong-account safely.

Privacy shows actual consent controls and data flows. Delete account explains effects on active research, saved reports, device sessions, data retention exceptions, and any separate subscription cancellation steps. Cancellation of a store subscription and deletion of an app account must not be falsely described as the same operation.

Provide in-app AI-output reporting with category, optional explanation, clear submission state, and permission to include relevant content. Help/errors should offer an actual next action, not a dead “contact support” link.

## Interaction completion checklist

Every visible control needs a defined normal, pressed, disabled, loading, success, error, offline, accessibility, and restoration behavior where applicable. Keep irreversible actions distinct from reversible navigation. Confirm destructive deletion; do not make everyday research require repeated confirmations.

Release checks must use real native screens on both platforms, multiple text sizes, compact/large phones, both themes, and long real/fixture content. Browser screenshots alone cannot satisfy this checklist.


## Revision 2: decision, correction and reading continuity
These requirements refine the earlier states in this same canonical specification. They are not verified UI behavior.

**The first result.** Put the task answer first with its key constraint and any decision-blocking unknown. This is a view of the canonical claim set, not an independently hallucinated summary. Show enough detail to distinguish a feasible option from an unverified one. Exploratory questions need synthesis rather than forced rankings. Preserve long-form reading on demand.

**A natural correction.** The ordinary composer accepts “Actually, the budget is different” or “That document is outdated.” After server acceptance, show a compact acknowledgement of the changed constraint and mark affected sections as being checked. Unaffected sections remain readable. A correction that broadens eligibility reopens discovery, not only reorders old results. Ask before additional spend only when the action materially exceeds the already accepted allowance policy.

**Current versus previous result.** Latest report and last verified report are distinct when an update is running. Do not present an old conclusion with a fresh timestamp. Version comparison highlights changed evidence, changed outcome, newly included/excluded options and remaining uncertainty. Presentation-only changes are labeled as such. Source deletion can remove/redact material in previous versions; immutable history does not override privacy.

**Source inspection.** One tap opens the exact passage, page/table cell when available, date/access state and the claim it supports. A second action opens the original. A snippet, abstract or failed page is visibly labeled. Model-checked does not mean proven true. Preserve reading position when returning.

**Persistent reading anchor.** Store reportVersion, blockId and a local offset. Restore on close/reopen. Map to a new version only when the block identity remains valid; otherwise explain that the section changed. Do not silently reset to the first paragraph. Test with large text, rotated/folded layouts, source sheets, long tables and offline cached reports. Authorization and deletion rules still apply to local caches.

**Failures and partial answers.** State what happened, what is preserved and the next viable action. Distinguish service capacity, expired session, no accessible evidence, partial extraction, unknown provider outcome, user cancellation and exhausted allowance. Do not call a task “failed” simply because a client stream disconnected while the server report exists. Do not promise the user will not incur cost when provider accounting is unknown.

**Input acquisition.** Launch supports explicit share/import of links and supported files through native user action. Never read the clipboard or share-sheet content silently. Unsupported data formats need an understandable rejection. File removal during processing must invalidate late completion and derived report access.

**Plans and controls.** Show a lightweight editable plan when it helps; do not require confirmation for every clear request. No agent/model/token dashboard. Only expose pause if the actual executor can pause safely; cancel is required. Progress is event-based, not fabricated. Notifications are optional, private by default, and never replace reopen synchronization.

## Revision 3 notification/lifecycle clarification
P0 needs usable, labeled, keyboard-safe native composer/reader controls and close/reopen synchronization, not the complete P3 navigation/settings/purchase polish. Basic accessibility is built into those controls; broader device/accessibility validation remains explicit per platform.

Use the logical completion identity and account/device-binding epoch contract in `ENGINE_CONTRACTS.md` §10. Suppress duplicate in-app completions and reauthorize every incoming report link. Clear prior-account local cache and controllable displayed/pending alerts on logout. An already-issued generic remote push may still arrive; it must contain no private question/title/report data and must not open another account's report. Do not claim that app-side deduplication guarantees exactly one OS alert. Live push remains optional and does not block P0 research/reopen proof.


## V6 local session boundary (W03/F17, implemented; native proof pending)
Credentials use Expo SecureStore 15.0.8 with no plaintext fallback. Content remains app-private AsyncStorage, bound to the server account and configured backend; this is not an encrypted-content claim. Legacy unscoped caches/tokens are discarded and require sign-in. Logout, expiry and deletion clear private drafts, reports, source panels and queued persistence. Account/run/source generations discard obsolete responses even if transport cancellation is ignored. A durable denial marker prevents failed credential deletion from silently restoring the old session; failures remain visible. A fresh installation discards surviving keychain credentials. Android backup is disabled in configuration; both-platform native verification remains required. Production sign-in/refresh remains an activation gate. These rules supersede historical draft-preserving logout observations.


W06 comparison display: report-changes.v1 summaries show the server’s measured assertion/criterion/version note. Do not append “earlier conclusion kept” to exact inventory equality: the child independently recomputed its claims. No new native execution claim; existing historical diagnostic summaries retain their previous format.


W06/W07 replacement-question UI: the owned run snapshot advertises correctionMode and correctionReserveMicro. Production correction controls require replace_question capability, a displayed brief revision and valid allowance metadata; absent/disabled capability is not silently treated as the legacy route. The complete revised question is sent as the accepted patch, with explicit reuse_snapshot/refresh policy. Edit-current-question assists full replacement; helper text explains snapshot age and uploaded-file byte retention. The previous report remains available. In-flight submission disables editing/repeat taps and checks the captured account/view generation before selecting the child. Errors retain the current input; account/run changes clear local correction fields. Correction-field process-death persistence is not yet implemented; the main draft/report persistence remains unchanged.
The API advertises only configured structured/live/key/cap availability; authoritative account, revision, allowance, consent and route gates still run at admission. This is not a paid availability probe or a promise of completed research. Demo correction admission is denied when fixture routing is disabled. Shared strict patch schema is reused on mobile before network dispatch. Unknown fields cannot inject run/budget authority.
Metro resolves NodeNext .js relative imports within the public contracts source package through its normal extension probing. Other package/native resolution remains unchanged, with no dependency added. The initial failed Android JS export and successful repair are recorded; bundling is not native execution. Native keyboard/radio/large-text/back/process-death checks remain open until a device is available. Rollback disables correction controls while retaining server ownership/route gates and current account/request-generation protections.

W04/W07 native binary selection (implementation under verification): the system picker accepts a single PDF, .txt or .md document, bounded to8MiB and the existing three-attachment limit. The mobile adapter reads real bytes from the picker cache copy; it never labels pasted notes PDF. Bytes remain in transient account state and are sent as application/octet-stream to the existing authenticated binary API on submission. Neither bytes nor file names/URIs enter persisted device snapshots. The picker copy is removed after success/failure, and its dedicated cache directory is cleared on next launch after a crash. Original user files are untouched. An account generation change prevents late adoption; selection blocks duplicate picker calls and Send until complete. Selected files can be removed before submission. Closing the app requires selecting them again, as explained in the UI. This does not yet implement interrupted-upload resume or source-specific server deletion. Rollback removes the picker control while retaining byte API ownership/validation/deletion.
Impact checklist: pinned expo-document-picker14.0.8 and explicit expo-file-system19.0.24 dependency (already present through Expo54), both MIT with no new JavaScript production transitive dependencies/model assets. Reviewed exact installed package manifests and picker native cache-copy paths, matched local Expo bundledNativeModules. No new service, schema, migration, provider route or paid call. The current installed standalone APK is not upgraded; Expo Go verification is separate. The dependency audit still reports three moderate/four high advisories in existing image-size/postcss/uuid packages; they remain unresolved and are not silently waived.

Source inspection now validates metadata, preserves exact passage text, ordered table-cell headers/spans/scopes, actual page/block and recorded coordinates, publisher/access/coverage/extraction warnings and immutable source version. Missing dates are explicitly unavailable; coordinates are not a rendered PDF/highlight. Only HTTP(S) original links without credentials open on user action. Reading anchors use the invoking block and a signed offset relative to the report card; drag/momentum end records the visible block. Removed-block fallback clears stale offset. Abrupt death mid-drag and screen-reader focus return remain device checks; no native claim follows from unit tests or JS export. Rollback may disable presentation changes but preserves request/account fencing, exact evidence and honest coverage.

W03 protected snapshots (ADR029): credentials and content use distinct SecureStore services. Draft/report snapshots use bounded UTF-8 chunks and atomic active-slot metadata; ordinary AsyncStorage contains no newly saved content. Legacy plaintext migration completes before restoration, or raises a visible storage error without plaintext fallback. Account clearing writes durable content-denial flags and physically deletes allocated slots; failures remain actionable, not successful deletion. Native saves coalesce obsolete snapshots, skip unchanged view-only state, use150ms quiet time and flush queued data on background. Process death before save acknowledgment is not guaranteed to preserve the latest input tail. Research and Library are the only bottom tabs; Settings is profile-accessible. Bulk native injection/reading-position and broader lifecycle acceptance remain separate from storage controls.

W06 correction recovery (ADR030): the protected account snapshot stores one pending correction with its question, snapshot/refresh choice and exact run/revision. A different run hides it; returning restores it. A newer brief leaves saved text visible but blocks submission until the user explicitly reviews and rebases. Successful correction admission clears the draft with the child transition. Invalid local draft metadata is discarded without discarding a valid report. Native Expo Go cold-restart and recovered refresh submission are recorded in verification/v6/correction-draft; process death before acknowledged persistence remains unguaranteed.

W07 admission recovery (ADR031): preserve an immutable protected request journal before upload/admission, with per-file keys and content fingerprints. Retry reconnects and resumes confirmed uploads; unconfirmed files require original bytes after restart. Pending question/route stay fixed. Check or withdraw atomically opens an existing run or withdraws an unused key before editing. Invalid journal prevents ordinary sign-in until explicit cleanup. No upload bytes in saved state. Recovery notices belong in the scrollable conversation, never the horizontal composer. Evidence: verification/v6/admission-retry/.

Reader restoration uses the immutable report ID and protected account envelope. Each mounted reader waits for its card, target block, viewport and content size; it restores once within the legal scroll range. User drag cancels delayed restoration. Returning from a source sheet remounts the report reader; concise-hidden and removed sections explain fallback separately. Stale layout callbacks from another account/report/mount are ignored. Source-sheet internal scroll position is not persisted. ADR034 and reading-position regressions own this behavior.

Source deletion is an explicit two-step source/version-bound action. Confirming clears cached report/source/run/correction/reading content and selected documents through acknowledged protected storage before DELETE; the composer draft remains. A pending source-ID handle survives restart and blocks report reopening, sharing and new research until confirmation; retry never invents success after a lost response. Picker and attachment entry are blocked during deletion. Invalid pending handles fail closed. File cleanup pending is disclosed separately. ADR036 owns privacy-action persistence and rollback.
