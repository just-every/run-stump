-- A podcast's guest intake is `guest_intake`, the name the venue tools take
-- (STUMP-VENUE-001, STUMP-PITCH-001.3). Venues and what the venue-list import
-- recorded for them move from the earlier `guest_intake_url` key, value kept.
UPDATE stump_venues
SET details = json_remove(json_set(details, '$.guest_intake', json_extract(details, '$.guest_intake_url')), '$.guest_intake_url')
WHERE json_type(details, '$.guest_intake_url') IS NOT NULL;

UPDATE stump_venue_imports
SET value_json = json_remove(json_set(value_json, '$.details.guest_intake', json_extract(value_json, '$.details.guest_intake_url')), '$.details.guest_intake_url')
WHERE json_type(value_json, '$.details.guest_intake_url') IS NOT NULL;
