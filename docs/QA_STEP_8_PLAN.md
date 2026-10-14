# QA step 8: amendments and return for correction

Owner go: 14 October 2026. Reconciled source baseline: web main `e96b6ed`, mobile main
`9aa9bb9`; rules `504ac83`; schemas `3f8f89e`. The first office-review milestone
is on DEV. No TEST or LIVE promotion has been approved.

The agreed twelve-step plan is retained in this task's 13 October implementation
response. Step 8 covers the field worker's returned-work list, reopening the saved
form, permanent before/after versions, Draft-to-Draft and Fail-to-Updated amendments,
MNC-SPV takeover when the submitter has left, protection of newer meter findings,
and in-app/email notifications with safe retry handling.

Implementation sequence:

1. Record the amendment/notification contract in QA-R001 and the QA schema.
2. Build scoped context/list and atomic amendment operations with provenance checks.
3. Extend review history and no-self-review to amendment authors; add durable notices.
4. Reuse mobile forms with an amendment save path and separate persistent queue.
5. Verify transitions, concurrent saves, retries, protected evidence, takeover,
   stale meter findings, reporting credit and existing field submission/ITO flows.
6. Commit and reconcile branches with current main, merge and push main, then deliver
   GitHub main to hosted DEV and the matching DEV mobile channel. Verify deployed
   artifacts and record the handover for owner testing.

Step 9 remains separate: controlled meter-number correction and continuing notes.
Step 10 proves the completed module on DEV; steps 11 and 12 require the owner's
separate TEST and LIVE approvals.

## Implementation and owner review

The phone's TRNs page links to **QA · returned work and notifications**. Its list
includes every eligible own Draft/Fail, without an age cutoff. Authorised MNC
supervisors can select takeover work. Open the original saved form, correct the
recorded fields, enter an explanation and send. **Save on phone** preserves an
unsent local draft; it does not claim office receipt. An uncertain send freezes
the request for exact retry. A definite refusal keeps the draft for correction.
An old phone draft cannot silently replace a newer office version.

The original eight forms are reused. No Access uses the shared No Access form.
Original IDs, capture times, baseline readings and appointments are preserved.
Ordinary correction cannot change the meter number, property identity, access
outcome or visit's physical result. Those require their separate procedure or
new work. A meter conflict requires explicit acknowledgement before preserving
the newer meter facts and amending only the historical transaction.

The web QA modal shows every correction's before/after versions, author, time,
explanation, takeover reason and retained meter facts. Corrected rows show the
amendment author and time. The original field worker keeps the work credit;
corrections do not increase transaction counts. Updated At remains the registry's
descending default and Created At remains absent from its UI.

QA Fail creates an in-app notice and private email job atomically. Updated work
notifies the previous eligible reviewer or eligible workbase reviewers. Email is
minimal and uses the existing report SMTP secret; an absent verified recipient
email does not block QA. Known delivery refusals retry with bounded attempts.
Ambiguous SMTP delivery is retained as unconfirmed without an automatic resend.
Client-visible notices show delivery failures; outbox details remain server-only.

DEV checks: use Meter Discovery first, confirm Fail → correction → Updated →
independent Pass; inspect both preserved versions. Also verify Draft → Draft,
supervisor takeover of a disabled submitter, an explicit newer-meter conflict,
an interrupted upload/send, and terminal Pass. Continue transaction-specific
acceptance through the remaining form types. Automated verification is not owner
approval. Exact deployed revisions and artifact hashes belong in the workspace
release ledger after verification.
