# Plan: 聊伴 Liaoban, an everyday conversation companion

> Owner: Glenn (Taiwan). Replies to the owner in English or Traditional Chinese (繁體中文), never Simplified.

## Origin
Forked on 2026-10-11 from `glennung97/paiban` at commit `67c7281` (on-set transcription for video shoots). **A separate project**: its own repo and its own Vercel project and URL, never merged back. Git history up to the fork is kept for reference. For the transcription facts measured in Paiban (ElevenLabs word timings, OpenCC conversion, GPT-6 Luna pricing and caching), see Paiban's `docs/PLAN.md` §3.

## What changed from Paiban (owner's request, 2026-10-11)
- **Removed:** manual strike-through, AI retake detection, SRT export, the Google Docs/Slides prep-document import and its brief/keyterm generation, the analysis-mode setting.
- **Kept:** live transcription, Traditional Chinese conversion, key-point highlights, passcode gate, OpenAI/Anthropic switch, keyterms, TXT/JSON export.
- **Added:**
  - **Running recap (目前重點):** 1–3 short lines, every 30 s by default (15/60/120 s selectable), only when there is new speech. The first one comes one interval after Record.
  - **Ask buttons:** 在聊什麼？ / 背景知識 / 幫我問. 幫我問 suggests three things to say in the speakers' language and register, each with a Traditional Chinese meaning.
  - **Indonesian:** a language preset `id` (primary `id`, secondary `en`, `jv`) that also sends about 30 Jakarta slang keyterms (Hokkien money slang like gocap/cepek/ceban, gaul words, a few Javanese words) after the user's own terms. The prompts explain casual Jakarta speech (Betawi/gaul, Jaksel English mixing, Javanese and Hokkien loanwords) so Luna can read misspelt slang and explain it under 背景知識.
  - **Context field (情境):** who the user is and what the conversation is, sent with every call.

## Second round (owner's request, 2026-10-11)
The owner chatted with a ride-hailing driver who kept talking about diplomas (*ijazah*) and only learnt later that it was about a politician's diploma controversy. So background knowledge comes first:
- **Terms:** `/api/analyze` also returns terms (person, topic, place, org, slang) from the newest ~40 units, with the exact words used (`mentions`) so they can be highlighted, a one-line gist, and a Wikipedia title for people. A topic is named as the underlying issue ("Jokowi 假學歷爭議"), with the word said ("ijazah") as a mention. The client merges terms across calls (`src/lib/terms.ts`).
- **Popup:** tapping a term opens a card that stays until closed; it calls `/api/explain`, which uses the provider's web search tool (OpenAI `web_search`, Anthropic `web_search_20250305`), localised to Indonesia or Taiwan by the language preset. If the tool is rejected (400), it answers from the model's knowledge and the card says so. People get a Wikipedia thumbnail looked up from the browser.
- **Live panel:** the recap and the old 在聊什麼／背景知識／幫我問 buttons are now one panel refreshed every 30 s: what's being discussed now, recap lines, background chips, and three suggestions tagged by angle (追問, 回應, 換個方向, 請他解釋), so the user sees when to change direction.
- **Simpler header:** name, timer, history, settings and Record only. Passcode and everything else moved to the settings sheet. TXT/JSON export removed.
- **History:** conversations saved in localStorage (word timings dropped; oldest deleted if storage is full); read-only view of past ones. Not synced between devices.

## Third round (owner's feedback after a real test, 2026-10-11)
- Key points: the model tinted almost every line with the same ★ tag. Now: a stricter prompt (only what to remember or act on, about one unit in eight at most), back-to-back ranges with the same reason merged, only importance 2–3 tinted, no tags.
- Terms keep their original spelling (`name`) with the Taiwanese Chinese name in a new `zh` field, shown small and light underneath.
- New term kind `question`: something the speakers wonder about that a search can answer (e.g. an artist's new song). It is highlighted in green and explained automatically when it appears.
- The live panel can be dragged down to one line (state remembered); suggestions are shorter and denser.
- 在聊什麼？／背景知識 are back as on-demand buttons (`/api/explain` with `brief: "overview" | "background"`), opening in the same popup as terms, so there's never more than one card.

## ChatGPT plan instead of an API key (2026-10-12)
Owner's request: use their ChatGPT plan through OAuth. OpenAI's docs (https://developers.openai.com/siwc/token-sharing-open-source, read 2026-10-12): self-serve plan usage is for open-source apps and personal projects that run locally; "paid or remotely hosted" apps must join a waitlist. A self-hosted guide covers an open-source app on a remote machine: sign in locally, copy the credentials over, and let the server own the refreshes. So the owner chose to make this repo public (MIT) and use that flow, accepting that Vercel functions are not exactly a VM.
- Flow: authorization code + PKCE, loopback `http://127.0.0.1:<port>/auth/callback`, `client_id=dynamic_agent_client` on first sign-in (the issued `client_id` comes back on the callback), `ext_agent_host_id` per host, scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`. Endpoints `https://auth.openai.com/api/accounts/authorize` and `/api/accounts/oauth/token`.
- Tokens: access 1 hour; refresh 30 days and replaced on every refresh; refreshes must be serialised. Kept in Upstash Redis with a lock (`server/chatgpt/store.ts`).
- Requests: Responses API only, `stream: true`, `store: false`, no `max_output_tokens`/`temperature`/etc. Every OpenAI call now streams; plan calls skip `prompt_cache_key`. Web search depends on model and account.
- Fallback: any plan failure → `OPENAI_API_KEY` (if set), recorded for ⚙.
- A token copied from the ChatGPT website or from Codex is not used: the docs say not to call ChatGPT's backend-api, and the login script gets a token registered to Liaoban instead.
- Unverified until the owner signs in: which models the account lists (GPT-6 Luna?), whether structured outputs (`text.format`) work on plan tokens, whether web search is allowed, and how fast the plan's limits run out with key points every 10 s and the live panel every 30 s.

## Architecture
```
Phone (browser)
  ├─ POST /api/scribe-token → single-use ElevenLabs token
  ├─ mic audio ──WebSocket──▶ ElevenLabs Scribe v2 Realtime (language preset) ──▶ partial + committed text
  ├─ POST /api/analyze  (every ≤10 s after new speech) → key points + terms
  ├─ POST /api/live     (every N s after new speech, or ↻) → now, recap, suggestions
  ├─ POST /api/explain  (tap on a term) → web-searched explanation + sources
  └─ GET  *.wikipedia.org/w/api.php (from the browser) → photo for a person
```
- `/api/analyze` and `/api/live` send the whole transcript (append-only, so prompt prefixes cache) with the task after it. `/api/explain` sends the last 60 segments.
- All calls use effort `low`: in a live conversation speed matters more than depth.
- Luna always answers in Traditional Chinese; only the suggested `say` lines are in the conversation's language.

## Not verified yet (test on a real phone)
- How well Scribe v2 Realtime transcribes casual Jakarta Indonesian, and whether the slang keyterms help or cause false insertions. If they hurt, trim `JAKARTA_KEYTERMS` in `src/config.ts`.
- Whether adding `jv` as a secondary language helps or makes detection jump to Javanese on Indonesian speech.
- Whether ElevenLabs charges extra for keyterms.
- Response times of the live panel and explanations on GPT-6 Luna at effort `low`.
- Whether GPT-6 Luna accepts the `web_search` tool (if not, explanations come from its own knowledge and the popup says "可能不是最新"), and what each search costs.
- Whether term detection is good enough at effort `low`, and whether the Wikipedia top hit is the right person often enough.

## Ideas for later
- Laptop mirror and saving conversations (Paiban's Phase 3–4 plans).
- A free-text "ask Luna" box.
- Syncing history between devices (needs login and a database).
- Reading a suggested question aloud (text-to-speech).
