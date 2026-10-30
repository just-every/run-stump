Already keep a list of venues? Import it from Markdown or CSV, as a dry run first.

## Formats

- **Markdown**, in the venue-list format: entries with their platform, status, priority, post type, whether human-written text is required, post and community URLs, rules URLs, audience, why it matters, how to post and requirements; venue records with their rules and shared limit; and excluded venues with their reason and alternative.
- **CSV**, with a header row naming the same keys.

## How an import runs

1. Upload the file. The dry run reports how many venues, entries and exclusions it found, and every row it refused with the reason. Nothing is written.
2. Apply it. Each venue is created once. "Human-written required" becomes the venue's AI text rule, and excluded venues arrive excluded with their reason and alternative.

Running the same file again changes nothing. Undo removes what the import created and lists the edits made since, which it keeps.

Text in an imported file never changes a rule or a route on its own.
