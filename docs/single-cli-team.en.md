# One CLI / one model, multiple independent members

[中文](single-cli-team.md) | English

**One configured CLI, or one model configured in DSH, is enough to build a team.** You do not need several vendors' CLIs or a separate installation for every member.

For example, all three members below can use the same DeepSeek model:

| Member name | Responsibility in its persona | Model |
| --- | --- | --- |
| Planner | Plan tasks, assign work and summarize results | The same DeepSeek model |
| Builder | Implement assignments and report changes and checks | The same DeepSeek model |
| Reviewer | Check results, identify omissions and report evidence | The same DeepSeek model |

You can also create three Codex members using one installed Codex CLI. Their names, personas and separate conversations distinguish them; different underlying models are optional.

## Choose an entry point

| Your environment | Where to add members | What you need |
| --- | --- | --- |
| DSH with a working DeepSeek model | DSH web → Channels → Add member → DSH model | Three distinct names, selecting the same model; no Discord bots |
| DSH with several Codex / Claude Code / Gemini members | The same dialog, choosing Local CLI | The selected CLI installed and configured on the machine running DSH; it can be selected repeatedly |
| Discord | The bothouse setup wizard, selecting a CLI for each bot | A distinct Discord bot token for each role; the CLI can be the same |
| Self-hosted channel (cloud_web) | The bothouse setup wizard → self-hosted platform | A distinct name for each role; no Discord tokens, and the CLI can be the same |
| Feishu | The bothouse setup wizard → Feishu | The wizard currently supports one role, so it is not the entry point for this multi-member walkthrough |

For the DSH plugin, start with [DSH setup](GETTING_STARTED.md#dsh-频道实验) (Chinese). For Discord and the self-hosted platform, see the [connection guide](connect-discord-feishu.md) (Chinese). DSH model members use the model configured in DSH; “DeepSeek” here is the model, not a requirement to install a CLI named DeepSeek.

## Create three members in DSH

1. Open **Channels** in DSH web and select a chat channel. Configure a working DeepSeek model in DSH first if it is not available in the model picker.
2. Click **Add member** in the member panel. Name it `Planner`, choose **DSH model**, explicitly select a working DeepSeek model, and enter “Plan tasks, assign work and summarize results” as its persona. Save.
3. Add `Builder` and `Reviewer` with **the same provider and model**, giving them implementation and review responsibilities. Names must be distinct and contain no spaces; models may be reused.
4. Select `Planner` as the **Primary role** and choose **Full team** under the channel's **Dispatch mode**. Members using the same model can still use this mode.
5. @ each member to confirm it can reply, then ask Planner to involve the others:

   ```text
   @Planner Work with Builder and Reviewer on a plan for a to-do list page. Have Builder outline the page and interactions, Reviewer check for omissions, and summarize their results. Discuss the plan only; do not modify files yet.
   ```

Member settings persist across a page refresh. Members exchange channel messages; choosing the same model does not merge their conversations.

With **Follow DSH default model**, a member resolves the default before its first request and then retains its session's selection. Existing sessions do not continuously track changes to the global default. Explicitly select the same provider and model if you want all three to use it.

### Use several Codex members instead

In **Add member**, choose **Local CLI → Codex** for each member and give each a name and persona. The CLI uses its host-side model and login configuration; this form does not select a DSH model for CLI members. The same approach applies to Claude Code and Gemini.

Detection only confirms that the program was found, not that login, model access or ACP adapter startup works. Confirm one real reply before adding more members. Install the CLI once; the runtime creates instances per member and maintains sessions per member and channel.

### Discord and the self-hosted platform

In the Discord wizard, add another bot for each role, using a distinct bot token. Select the same local CLI for all roles, then assign personas and a primary role. Entering one token three times does not create three independent members.

In the self-hosted platform wizard, add roles with different names and select the same CLI for each. Configuring an existing name on the same platform updates that role; use a new name to add a member. Save, restart as instructed by the wizard, and @ each role to verify it responds.

## How this differs from “Single model, multiple processes”

**Dispatch mode** decides who receives work, not whether members may use identical models:

| Mode | Where work goes | When to use it |
| --- | --- | --- |
| Single model, multiple processes (solo) | The current role's own subtasks, where supported by its backend | Not for delegating among three resident members |
| Full team (team) | Other members in the channel | Three members collaborating, even on the same model |
| Mixed (mixed, the default) | Channel members or the current role's subtasks | When both forms of delegation are useful |

Adding a member creates a resident role. Subtasks are created during execution; selecting solo does not automatically add two more members to the panel.

## What is separate and what is shared

| Content | Current behavior |
| --- | --- |
| Identity and persona | Each member has its own ID, name and persona. Reusing a model or CLI does not merge members |
| Conversation context | DSH-native and local CLI members bind a separate session to each member/channel pair. Two members in one channel have different sessions; one member in two channels also has separate sessions |
| Public channel messages | A triggered member receives relevant history from that channel. Another member's public answer can become its input, enabling collaboration |
| Private conversation content | Using the same model does not copy one member's full conversation into another. A non-channel turn started directly in a session is not automatically published as a channel job's answer, but a member can still refer to information it knows in a later public answer |
| Wiki / long-term memory | Sessions and memory are distinct. Configured ingestion, retrieval or shared wiki pages can make information available to other roles. The bridge wizard may also configure a role's own wiki; inspect the actual settings |
| Files and permissions | DSH channel members currently share the configured working directory. Separate sessions are not separate files, OS permissions or private-channel access controls. Coordinate concurrent edits and arrange separate checkouts / worktrees where needed |
| Account and usage | Calls through the same account or API configuration share its billing, concurrency and rate limits. Adding members does not add account quota; additional model calls consume additional usage |

**This is not a strict confidentiality boundary.** Not @-mentioning another member does not protect sensitive information, especially after it has been posted in the public channel.

DSH-native member sessions are managed internally by the plugin and do not appear in the ordinary DSH conversation list. This guide does not promise a separate clickable private-chat window for each member, private member directories or completed private-channel permissions.

## Reset, recovery and a small verification task

Send `@Builder /new` in a DSH channel to start a fresh session for Builder in **that channel**, reading on from the command. Other members' sessions are not reset. The command does not delete old channel messages or wiki pages. Renaming a member or editing its persona does not clear its history.

Recovery depends on the backend. DSH-native members try to resume their bound sessions. Local CLI members resume through ACP; unsupported or failed restoration is reported as context loss and starts a new session. Context preservation is not unconditional.

For an initial check, use a small task without sensitive information:

1. @ each of the three members and ask it to state its responsibility. Check that each identity replies.
2. Ask the primary role to coordinate the planning task above. Look for handoffs and a summary; three names alone do not establish collaboration.
3. In a test channel, send `/new` to one member. Check that the new-session notice names that member and the others can continue their existing tasks.
4. To verify session separation, inspect the member/channel-to-session bindings in local storage instead of judging whether a model guesses a phrase correctly. There is no need to publish complete conversation logs.

This checklist describes how to verify the setup; live-model handoffs need to be checked in the actual installation. Developers can inspect the [DSH member runtime](../dsh/collab/dsh-member.mjs), [CLI sessions](../dsh/collab/cli-member.mjs), [member validation](../dsh/collab/roster.mjs) and [existing regression tests](../dsh/collab/collab.test.mjs).

## Common questions

- **Can a model only be selected once?** No. Names and member IDs must be unique; models and CLIs can be reused.
- **Where is the member's private-chat window?** Separate context exists, but the ordinary DSH conversation list is not a private-chat entry point for channel members. Address them in the channel.
- **Why is work not handed off?** Check the primary role, dispatch mode and @ names. Solo does not delegate to other members. When the relay limit is reached, follow the channel prompt and @ a member as the human; agents do not converse indefinitely.
- **Why is it slower or out of quota after adding members?** Check the shared backend's quota, concurrency limits and errors. Creating more members will not fix those limits.
- **Can I start with one member?** Yes. Confirm one works, then add a second and third. You do not need a complete team on day one.
