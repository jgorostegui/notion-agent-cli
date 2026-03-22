---
description: Set up notion-agent-cli authentication.
allowed-tools: [Bash, AskUserQuestion, Read, Edit]
---

Follow these steps:

1. Check if already authenticated:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs --status
```

If it prints "Authenticated", tell the user and stop.

2. Ask the user for their Notion integration token using AskUserQuestion.
   Tell them to create one at https://www.notion.so/profile/integrations
   if they don't have one. The token starts with `ntn_`.

3. Validate the token:

```bash
NOTION_TOKEN="<token>" node ${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs --status
```

If it fails, tell the user the token is invalid and repeat from step 2.

4. Read `~/.claude/settings.json`. Add or update `NOTION_TOKEN`
   inside the `"env"` object. Preserve all other settings.
   Write the file back.

5. Tell the user to start a new session for the token to take
   effect, and to share their Notion pages with the integration
   (page menu > Connections > add it).

Do NOT write to .env files. Do NOT pipe the token through
shell commands. Use Read and Edit to update settings.json.
