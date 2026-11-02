# Reading time

Adds the `[reading_time]` shortcode, which shows an estimate such as “4 min read” based on the number of words in
the entry it appears on.

- **Settings:** reading speed (words per minute) and the text (`{minutes}` is replaced by the number).
- **Attributes:** `label` overrides the text for one shortcode, e.g. `[reading_time label="{minutes} minutes"]`.
- **Permissions:** none. The plugin only sees the entry's word count.
