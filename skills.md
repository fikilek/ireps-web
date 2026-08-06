# iREPS Web Skills

## Purpose

This file contains binding housekeeping rules for the `iREPS Web` repository.

Before giving or following any instruction involving ZIP creation, ZIP upload, ZIP download, ZIP extraction, or file delivery, read this file first and apply it.

## Mandatory new-chat repository inspection

At the start of every new `iREPS Web` chat:

1. The user sends the current `skills.md` file.
2. Capture the exact current folder/file tree.
3. Capture the current branch, commit, and Git status.
4. Create one unique timestamped ZIP under:

   `C:\dev\ireps-web\zips`

5. The user uploads that ZIP to ChatGPT.
6. Inspect the uploaded repository tree and Git state before touching the ERF validation code or making any repository change.

This new-chat inspection is mandatory. Do not rely on an older repository tree, an older uploaded source snapshot, or assumptions about the current working tree.

## Mandatory Firestore access and streaming policy

1. All Firestore-backed data used by an iREPS user interface must stream in real time by default.

2. React pages and UI components must not import `firebase/firestore`, create Firestore queries, or open Firestore listeners directly. Firestore access must be implemented in the approved Redux/RTK Query API or another explicitly approved data-access module.

3. Direct Firestore access inside a page or component is noncompliant even when it uses `onSnapshot`. The stream must be owned by the approved API/data-access layer and exposed to the UI as normalized live state.

4. Firestore reads that supply UI data must use a live listener such as `onSnapshot`, or an equivalent streaming mechanism that preserves immediate server-to-UI updates.

5. When data changes in Firestore, the updated state must be received through the approved streaming layer and displayed immediately in the UI.

6. Users must not need to:
   - pull down to refresh;
   - reopen a screen;
   - navigate away and return;
   - restart the application;
   - perform a manual refetch;
   - perform any other manual refresh action to see current Firestore data.

7. A one-time request, callable response, cached snapshot, polling flow, or manual refetch must not replace streaming for Firestore-backed iREPS UI data.

8. Firestore writes may use an approved mutation, transaction, callable, or write operation. However, the resulting UI state must still be received through the live Firestore stream and must not depend on a manual refresh.

9. Firestore access may be non-streaming only when there is a specific, technically valid, and documented reason why streaming cannot or should not be used.

10. Before implementing or retaining any non-streaming Firestore access, or any direct Firestore access outside the approved data layer:
    - stop and identify the exact reason;
    - explain why streaming or the approved access layer cannot be used;
    - explain the impact on live UI updates;
    - document the proposed alternative;
    - obtain explicit user approval.

11. Implementation convenience, pagination, caching, server-side enrichment, joins, access control, an existing callable, or legacy code are not by themselves valid reasons to bypass streaming or the approved data-access layer. These requirements must be designed around the streaming policy.

12. The binding default is:

    `Firestore changes → approved API/data layer streams the change → UI updates immediately`

13. The only exception is:

    `A specific, technically justified, documented reason exists → user gives explicit approval before implementation`

## Mandatory ZIP-only file delivery policy

1. Every file ChatGPT sends to the user must be delivered inside a ZIP archive.

2. ChatGPT must never provide a standalone, unzipped file for download. This applies even when the delivery contains only one file.

3. The ZIP-only rule applies to every file type, including:
   - source code;
   - scripts;
   - configuration files;
   - Markdown files;
   - reports;
   - documentation;
   - test files;
   - generated outputs;
   - any other file created or modified for the user.

4. Every delivery ZIP must preserve repository-relative paths so that extracting it into `C:\dev\ireps-web` places each file directly into its correct repository folder.

5. A file must never be placed in an arbitrary folder after extraction. Its path inside the ZIP must match its intended path under `C:\dev\ireps-web`.

6. ChatGPT must provide the ZIP download link, exact ZIP filename, verification details, one complete copy-and-paste PowerShell extraction script, and a suggested Git commit message.

7. The binding default is:

   `No standalone files → every delivered file is inside a correctly structured ZIP`

## ZIPs sent by ChatGPT to the user

1. ChatGPT delivery ZIPs are downloaded into:

   `C:\Users\User\Downloads`

2. Every delivery must include:

   - a download link;
   - the exact ZIP filename;
   - only files actually modified or created for the task;
   - repository-relative paths preserved inside the ZIP;
   - one complete copy-and-paste PowerShell extraction script;
   - extraction into `C:\dev\ireps-web`;
   - post-extraction verification;
   - a suggested Git commit message.

3. The extraction script must:

   - read the ZIP from `C:\Users\User\Downloads`;
   - place every file into its correct path under `C:\dev\ireps-web`;
   - never delete existing files;
   - never overwrite a different existing file without explicit user approval;
   - stop and report when a destination conflict exists;
   - perform no Git action unless separately approved.

## ZIPs sent by the user to ChatGPT

1. ZIPs prepared by the user for upload to ChatGPT must be created inside:

   `C:\dev\ireps-web\zips`

2. ChatGPT must provide one complete copy-and-paste PowerShell creation script.

3. The creation script must:

   - create the ZIP inside `C:\dev\ireps-web\zips`;
   - never place the upload ZIP in the repository root;
   - never place the upload ZIP in `C:\Users\User\Downloads`;
   - include only files actually modified or created for the task;
   - preserve repository-relative paths inside the ZIP;
   - use a unique timestamped filename;
   - never delete or overwrite an existing ZIP;
   - never delete, move, rename, or modify source files;
   - perform no Git action.

4. The user uploads the completed ZIP from:

   `C:\dev\ireps-web\zips`

## Mandatory pre-check

Before preparing any ZIP-related instruction for `iREPS Web`:

1. Read `C:\dev\ireps-web\skills.md`.
2. Confirm whether the ZIP is:
   - a ChatGPT delivery to the user; or
   - a user upload to ChatGPT.
3. Apply the correct direction-specific rules above.
4. Stop rather than guess when the requested operation conflicts with this file.
