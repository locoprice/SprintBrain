SprintBrain is a lightweight tool designed to:
- Expand dynamic snippets instantly
- Inject variables in real-time (e.g. `{{name}}`, `{{date}}`)
- Improve productivity with structured, repeatable text workflows

Inspired by fast input → structured output systems.

---

## ⚙️ Core Features

- ⚡ Dynamic snippet expansion
- 🧠 Variable parsing system (CSP-safe, no eval)
- 🔄 Bidirectional sync with Notion
- 📱 Mobile web app support
- 🧩 Chrome extension architecture
- 🎛 Popup UI for quick interactions

---

## 🏗 Project Structure


/ (root)
├── CLAUDE.md # AI context entry point
├── /docs
│ ├── context.md # System logic & architecture
│ ├── tasks.md # Current tasks & priorities
│ └── workflow.md # Internal workflow (optional)
│
├── manifest.json # Chrome extension config
├── background.js # Background processes (sync, alarms)
├── content.js # Page interaction logic
├── popup.html # UI structure
├── popup.js # UI logic
├── overlay.css # Styles
├── notion-sync.js # Notion integration
│
├── /mobile # Mobile web app version
│
└── /assets (icons)


---

## 🧠 How It Works

1. User triggers a snippet
2. System parses variables (e.g. `{{variable}}`)
3. Modal (planned/improving) collects input
4. Output is generated in real-time
5. Optional sync with Notion

---

## 🔥 Current Focus

See: `/docs/tasks.md`

Main priorities:
- Improve DynamicSnippetModal UX
- Enhance variable parsing
- Optimize performance (popup + mobile)

---

## ⚠️ Constraints

- Keep system lightweight
- No heavy external dependencies
- Ensure fast execution (low latency)
- Maintain clean and minimal UI

---

## 🧩 Tech Stack

- JavaScript (Vanilla)
- Chrome Extension APIs
- Notion API
- Mobile Web App (progressive)

---

## 🚀 Development Workflow

1. Read `CLAUDE.md` before starting
2. Check `/docs/tasks.md` for priorities
3. Keep changes minimal and modular
4. Commit frequently with clear messages

---

## 🧠 AI Integration (Claude Code)

Claude uses:
- `CLAUDE.md` → entry context
- `/docs/context.md` → system understanding
- `/docs/tasks.md` → execution priorities

---

## 📌 Notes

- Codebase is optimized for speed and simplicity
- Avoid overengineering
- Follow Pareto principle (focus on high-impact features)

---

## ✅ Status

Active development  
Core system working, UX and advanced features in progress

---

## 👤 Author

Alessandro Verdicchio – SprintBrain Project // Valentina Pirrone Senior Project manager
