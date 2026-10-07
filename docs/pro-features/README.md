# Pro features: locked until the plan exists

Five features call the AI service, and every use costs real money. The paid plan that will cover it does not exist yet, so since **v3.61.0** each one is shown where it will live, dimmed, with a lock and the tooltip **"Available to Pro users soon"**, and cannot start a request. Read a picture joined them in **v3.63.0**, built locked.

One switch per feature, in `app/src/lib/proFeatures.ts`. `scripts/check-pro-gate.js` (CI) keeps the dashboard, the phone and the manual in step with those switches.

| Feature | Switch | Where it shows locked | Server function in production | Manual page, kept here |
|---|---|---|---|---|
| Ask SprintBrain | `ask`, and `ASK_AVAILABLE` in `app/public/mobile/index.html` | The answer row in the dashboard search panel (and the ⌘↵ shortcut); the row under the search box on the phone's Snippets, Prompts and Brains pages | `ask-sprintbrain`, deployed | `ask-sprintbrain.mdx` |
| Draft with AI | `draft` | **Draft from text** in the snippet, prompt and Brain item editors (one shared component) | `draft-with-ai`, deployed | `draft-with-ai.mdx` |
| Translate from EN | `translate` | The Translate button in the snippet editor (IT, ES, FR) | `translate-body`, **not deployed** | none (already left out of the manual) |
| Suggest labels | `labels` | The Suggest labels button under the label picker in the snippet editor | `suggest-labels`, **not deployed** | none (already left out of the manual) |
| Read a picture | `picture`, and `PICTURE_AVAILABLE` in `app/public/mobile/index.html` | The **Read a picture** row in the phone's Save to Brain, with the lock and the label in plain sight; under it, a tip to copy a picture's text with Live Text or Google Lens instead | `read-picture`, **not deployed** | `read-picture.mdx`, a section of the phone page rather than a page of its own |

The two features whose function is not deployed need that deploy before their switch can go on. Before any switch goes on, the Anthropic account behind `ANTHROPIC_API_KEY` needs credit: with none, every call fails with "Your credit balance is too low".

## Switching a feature on

1. Set its switch to `true` (and the phone's, for Ask and Read a picture). Put the plan check in `isProFeatureAvailable` when the Pro plan exists, so a free account stays locked; the phone's two switches need the same check on the phone.
2. Move its page from here to `user-docs/<ask|draft>/overview.mdx`, check it against the shipped feature, and add it to the menu in `user-docs/docs.json`. Read a picture is the exception: deploy `read-picture` first, then follow the steps at the top of `read-picture.mdx`, which goes into the phone's page instead.
3. Restore the lines below, taken out of the published manual so that it documents only what works.
4. `node scripts/check-pro-gate.js` fails if a switch is on while its page is unpublished, or the other way round. Update `docs/USER_DOCS.md` (page map and "Left out on purpose").

## Lines taken out of the published manual (restore verbatim)

**`user-docs/review/overview.mdx`**

- In the status table, **AI generated** read: `Written by an AI: saved from [Draft with AI](/draft/overview), or by an AI assistant connected to your Brains. A person has not approved it yet.`
- **Approved** read: `Approved. Ask SprintBrain prefers approved items.`
- After the "Waiting for approval" list: `**Answer feedback** lists what people said about [Ask SprintBrain](/ask/overview) answers.`
- Under Deprecated: `- [Ask SprintBrain](/ask/overview) treats it as out of date and says so.`
- Under Archived: `- Ask SprintBrain ignores archived items.`

**`user-docs/text-snippets/create-and-organize.mdx`**, before "To edit a snippet, click its row.":
`Have an email or a chat that says it already? Click **Draft from text** at the top of a new snippet, paste it, and the editor fills itself in. See [Draft with AI](/draft/overview).`

**`user-docs/prompts/create-prompts.mdx`**, after the first paragraph:
`To start from text you already have, click **Draft from text** at the top of a new prompt and paste it. See [Draft with AI](/draft/overview).`

**`user-docs/brains/overview.mdx`**, at the end of the **Add text** bullet:
` **Draft from text** at the top of the editor names and summarises text you paste. See [Draft with AI](/draft/overview).`

**`user-docs/apps/mobile.mdx`**

- In the description: `read and copy your Brains, ask questions answered from your own content, and save text`
- The section before "Other tabs": `## Ask a question`, then `Type a question in the search box on the Snippets, Prompts or Brains page and tap **Ask SprintBrain** under it. The answer comes only from your own snippets and Brains, with its sources listed: tap one to open it. **Copy answer** copies the text, and **Was this right?** sends your feedback for review. See [Ask SprintBrain](/ask/overview).`

**`docs.json`**: the menu group was named `AI and review` and listed `ask/overview`, `draft/overview` and `review/overview`.
