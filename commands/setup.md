---
description: Bootstrap notion-agent-cli on this machine. Installs runtime dependencies if needed, prompts securely for the Notion token, validates it, and stores it in the plugin directory.
allowed-tools: [Bash]
---

Run the plugin setup script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs
```

If the script prompts for a Notion token, ask the user to paste it into the terminal prompt.
Do not tell the user to put the token directly into a shell command unless they explicitly request a non-interactive setup flow.
