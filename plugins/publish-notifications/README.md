# Publish notifications

Posts a message to a Slack or Discord channel whenever an entry is published.

1. Create an incoming webhook in Slack or Discord and copy its address.
2. Activate the plugin (it asks to send requests to `hooks.slack.com` and `discord.com` only).
3. In its settings, choose the service, paste the webhook address and adjust the message
   (`{title}` and `{url}` are replaced).

Requests are made by NEXORA on the plugin's behalf, only to the two hosts above; failed deliveries are retried.
The webhook address is stored as a secret and never shown again in the admin.
