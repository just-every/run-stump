Bring your Buffer channels, sent posts and schedules into Stump, without anything posting twice.

## What comes across

- Your channels.
- Sent posts with their results, which fill the [ledger](/docs/ledger) as history.
- Posting schedules, which become each account's queue slots.
- Queued posts, which arrive paused.

## How an import runs

1. Upload the export on the import screen. Stump reads it and shows a dry run: how many channels, sent posts and queued posts it found, and every row it refused with the reason. Nothing is written yet.
2. Apply the plan you reviewed.
3. When Buffer no longer holds the queued posts, confirm it, and Stump releases them to their times.

Running the same file again changes nothing. Undo removes what the import created.
