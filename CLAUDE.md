# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Submit Agent is a Chrome browser extension that automates submitting AI products to launch directories and backlink sites. The user fills in their product info once; the AI agent opens each submission site and fills the form automatically using DOM analysis — no screenshots, no backend server.

The repo has two main parts:
- **`extension/`** — the browser extension (the product)
- **`page-agent-main/`** — vendored source of the `@page-agent/*` npm packages used as the AI engine (Alibaba PageAgent). The extension consumes the published npm packages, not this directory directly.
- **`sites.json`** — master list of submission sites (DR, traffic, link type, pricing, submit URL), used at runtime by the extension

## Commands

All commands run from `extension/`:

```bash
cd extension
npm install       # also runs wxt prepare
npm run dev       # dev mode with HMR, launches Chrome with persistent profile
npm run build     # production build → .output/chrome-mv3/
npm run zip       # package as submit-agent-{version}-chrome.zip
```

To load in Chrome: build, then load `extension/.output/chrome-mv3/` as an unpacked extension.

## Architecture

### Extension entrypoints

| File | Role |
|---|---|
| `entrypoints/background.ts` | Service worker. Routes `TAB_CONTROL`, `PAGE_CONTROL`, `SUBMIT_CONTROL` messages. Opens submission tabs on demand. |
| `entrypoints/content.ts` | Injected into every page. Initialises `RemotePageController` so the background/sidepanel can drive DOM actions. |
| `entrypoints/sidepanel/` | Main UI — React app that is the side panel. |
| `entrypoints/options/` | Full-page product profile manager (`ProductForm`). |

### Side panel view flow

`sidepanel/App.tsx` is a flat view state machine:
```
dashboard → site-detail (SubmitFlow) → agent running
         ↘ settings
         ↘ quick-create (first-run, no product yet)
```

### Agent layer (`extension/src/agent/`)

- **`SubmitAgent.ts`** — extends `PageAgentCore` from `@page-agent/core`. Builds a `RemotePageController` + `TabsController`, injects product data into the system prompt (`submit-prompt.md`), and runs the ReAct loop (observe → think → act) to fill forms.
- **`RemotePageController`** — bridges the side panel to the content script via `chrome.runtime.sendMessage` (`PAGE_CONTROL`), so the agent can click, type, and read DOM state on the active tab.
- **`TabsController`** — manages opening/focusing/closing tabs via `chrome.runtime.sendMessage` (`TAB_CONTROL`).
- **`tools.ts` / `tabTools.ts`** — custom tools exposed to the LLM (e.g. `mark_submitted`, tab navigation).

### Data flow

```
SidePanel (useSubmitAgent)
  → new SubmitAgent({ baseURL, model, apiKey, product })
  → agent.execute(task)
      → ReAct loop: observe page state via RemotePageController
                    → LLM call (OpenAI-compatible API, configured by user)
                    → act: DOM interactions via content script
  → fires statuschange / historychange / activity events → React state
  → user reviews filled form, clicks submit manually
```

### Storage

- **IndexedDB** (`lib/db.ts`) — `ProductProfile` records and `SubmissionRecord` per site
- **`chrome.storage.local`** — `LLMSettings` (baseUrl, model, apiKey) and `ExtSettings` (language, autoRewriteDesc)
- **`sites.json`** — fetched at runtime from the extension bundle via `lib/sites.ts`

### LLM configuration

The extension uses any OpenAI-compatible API. The user sets `baseUrl`, `model`, and optionally `apiKey` in Settings. There is no bundled API key — the user must bring their own.

### Build system

[WXT](https://wxt.dev/) framework with `@wxt-dev/module-react`. Vite + Tailwind CSS v4 (`@tailwindcss/vite`). TypeScript strict mode with path alias `@/` → `src/`.
