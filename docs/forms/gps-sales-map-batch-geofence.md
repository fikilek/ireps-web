# Form: Draw batch geofence (GPS Sales map)

| | |
| --- | --- |
| Screen | GPS Sales Table → **Show GPS Map** → **Draw batch geofence** (`src/pages/sales/components/use-sales-map-fence.jsx`) |
| Rules | Targeted Batch rules `TB-R055` (1.3.47, 1.3.48), `TB-R039`, `TB-R046`, `TB-R044`; Geofences rules `GF-R001`, `GF-R002` |
| Server | `createGeoFence` (Sales-map check in `functions/targetedBatches/sales-map-fence.js`), `resolveSalesTargetedBatchCallable` |
| Who uses it | Managers (MNG) and main-contractor supervisors (SPV) who plan GPS batches |

## What it is for

Starting a GPS batch straight from the map on the GPS Sales Table. You draw the geofence around the GPS meters you want, and it is saved as the batch's own geofence. Then **Create Target Batch** opens TB Draft with that geofence already in place. The Non-GPS route (streets, then TB Draft) is not affected.

A batch holds **at most 30 meters**, so a geofence drawn here never holds more than 30 meters that can be batched.

## Before you start

- Choose **one Ward** on the map (or in the Ward No column). The button appears for MNG and SPV only.
- The Ward stays fixed while you draw and save: the Ward lists and **Hide map** are locked until you finish or cancel.

## What you fill in

| Field | Default | Rules |
| --- | --- | --- |
| Name | "Gf W<Ward number> " + what you type | The start is fixed by the Ward (GF-R001). The full name must not already be used by an active geofence in the Ward (GF-R002); iREPS says so as you type. Required. |
| Description | empty (saved as "NAv") | Optional text. |
| Shape | none | Click at least 3 points on the map, at most 300. The shape may not cross itself. **Undo** removes the last point, **Restart** clears them. |

## The live count

Under the shape: **Inside: N Sales meters · M can be batched**, updated with every point.

- **N** — the Ward's GPS Sales meters whose GPS pin is inside the shape. For orientation only.
- **M** — the meters that can be batched: CAT (by the newest category month), Not Started, not in a batch, with one ERF, a street address and a town, **whose ERF centre is inside the shape**. M is what the batch gets.
- A pin can sit inside your shape while its ERF centre is outside; that meter is not in M.
- **M above 30:** the shape turns red, the count reads "Too many: M — the limit is 30", and **Save** is disabled.
- **M = 0:** Save is disabled.

## What happens when you press Save

1. **Confirm Geofence** window: the name, the Ward and the count. Press **Confirm Create** to go on.
2. **Progress:** the meters are located (their GPS point and ERF from the Sales record — never Google), the geofence is saved, then the server links the ERFs, premises and meters inside it.
3. **Geofence created** window: the counts, how many meters are ticked, and any counted meter that was **left out**, with the reason.
4. The table then filters to the new geofence and ticks its meters. Untick any you do not want.
5. **Create Target Batch** opens TB Draft for this batch with the geofence. Finish there as usual.

If you stop here, the geofence shows on **Batches & Geofences** as "Batch not created"; **Create its batch** picks it up later.

If Save fails, a **Geofence not saved** window gives the reason. Nothing was saved; your drawing stays on the map to change or cancel.

## Error Register

Errors you can get after pressing Save (the server's refusals). Nothing is saved in any of these cases.

| What you see | What happened | What to do |
| --- | --- | --- |
| "This geofence holds N meters that can be batched. The limit is 30. Draw a smaller geofence." | The server counted more than 30 meters that can be batched inside (someone may have released meters since you counted) | Make the shape smaller and save again |
| "This geofence holds no meter that can be batched." | Nothing inside can be batched (all Completed, In Progress, Normal, already batched, or without an address) | Draw around meters that can be batched |
| "None of the N meters could be made ready for a batch. …" (each meter with its reason) | Every counted meter failed when it was located (for example its ERF or Ward record is incomplete) | Report the meter numbers to the office; draw around other meters |
| "The geofence must contain at least one complete draft meter's ERF centroid" | The meters were ready, but none has its ERF centre inside the shape any more | Redraw so the shape covers the meters' ERFs |
| "The complete geofence must lie strictly inside the Ward, without touching its boundary" | The shape touches or crosses the Ward boundary | Keep the shape inside the Ward |
| "\"Gf W6 …\" already exists. Choose another name." | Someone saved a geofence with the same name meanwhile | Cancel, start again with another name |
| "Only MNG and SPV(MNC) may plan Targeted Batches" | Your role may not plan batches | Ask a manager |
| "Only a main service-provider supervisor may create a batch" | You are a subcontractor supervisor | Ask the main contractor |
| "The batch LM must be your active assigned workbase" | Your active workbase is not this municipality | Switch workbase (Profile), reload, try again |
| "Your user profile is unavailable" / "Sign in to continue" | Your sign-in or profile could not be read | Sign out, sign in, try again |
| "The geofence must use the draft's authoritative Ward" / "Exactly one Ward is required" | The meters' ERFs are not all in this Ward | Draw around meters of one Ward only |
| "Couldn't …" / "Targeted Batch processing failed; retained draft is unchanged" | The server could not be reached, or something unexpected failed | Try again. If it keeps happening, report it |

**Left out** (in the Geofence created window, not an error): a counted meter that could not be made ready, with its reason — for example "ERF 1234 is unavailable" or "COMPLETED — not batchable" (it changed after you counted). The geofence and batch go ahead without it.

## What it does not do

- It does not create the batch. **Create Target Batch** (or Create its batch) does, through TB Draft.
- It does not send any meter to Google.
- It does not change the Geo-Fences page, TB Draft, or Non-GPS batching.
