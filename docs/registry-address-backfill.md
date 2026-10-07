# Registry address backfill — 7 October 2026

Owner scope: add Unit Name and Unit No immediately after Address in both the
TRN and Meter registries, with filters, sorting and downloads. Backfill existing
DEV records first, verify on hosted DEV, then follow separate TEST and LIVE
review stages. Form changes are explicitly deferred.

The saved `accessData.premise` on `trns` and `asts` gains five string fields:
`strNo`, `strName`, `strType`, `unitName`, `unitNo`. Existing `id` and
`propertyType` remain unchanged. Saved `address` is rebuilt from the linked
premise's street components. Registry meter rows copy that address and unit fields into
`premiseUnitName` and `premiseUnitNo`. Web pages read these saved values, without
joining against a changing current premise or guessing units from free text.

The one-time reconstruction reads the linked premise's `address.strNo`,
`address.strName`, `address.strType`, `propertyType.name` and
`propertyType.unitNo`. It requires matching municipality and ERF, plus complete
source street components. Owner clarification: the linked premise address must
prevail, replacing differing saved street and unit values. Missing unit details
become `NAv`; missing or mismatched premise references are held. The evidence
identifies this as a backfill from the current premise, not proof of historical
capture. Original capture times, users, meter state, counts, media and links
are preserved.

`functions/scripts/backfillRegistryAddresses.js` is hard restricted to DEV
`ireps2`. It defaults to a dry run with `--key` and `--output`. `--apply` uses
the saved plan and full before-images, checks source/target/registry versions
in each transaction and writes an append-only result journal. Afterwards it
checks every applied record's address and five components, unchanged unrelated content and
registry copy. A fresh dry run must then show no remaining proposed changes
for the applied cohort. Do not overwrite a completed evidence directory.

Deploy `onMeterCreated`, `onMeterUpdated` and `rebuildMeterRegistryRowCallable`
from GitHub main before applying. Address-only changes now trigger registry
refresh; rebuilds preserve the saved unit fields. No indexes are required.
Other transaction/report triggers may observe record updates; their original
capture timestamps remain intact. Recheck derived results and record counts.

Superseded dry run at 12:41 UTC: 560 TRNs and 191 assets proposed, with 191 existing meter
registry rows; 18 TRNs and three assets held for differing street addresses.
29 TRNs have a sourced unit name, 18 a unit number; 17 assets have a name,
11 a number. The owner's subsequent premise-prevails instruction resolves these
address differences; refresh the dry run before applying.
Evidence: `C:/dev/ireps-investigations/trn-address-backfill-20261007/`.

Recovery: retain Firestore `fields` and `updateTime` backups and the apply
journal. Restore only changed address fields after checking the current record
still matches the applied state, then rebuild its registry copy. Do not replace
whole documents over later work. TEST and LIVE need environment-specific dry
runs, backups, owner review and an explicitly adapted migration.
