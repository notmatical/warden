---
"warden": minor
---

Added a sub-agent overview panel. A collapsible "Sub-agents N/M" bar sits above the composer whenever a session spawns Task/Agent subagents, showing each one's status (running/done/error) and prompt. Clicking a row opens a side sheet that replays that subagent's full activity — its prompt, tool calls (with the new diff/output panels), and final report — without leaving the session.
