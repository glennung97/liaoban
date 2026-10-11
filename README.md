# 聊伴 Liaoban

A conversation companion for everyday talk: your phone listens, shows a live transcript and marks the key points. Luna (the AI) highlights people, current issues and slang you may not know (tap one to learn what's going on, with a photo for people), keeps a live panel of what's being discussed and suggests what to say next. Past conversations are kept on the phone.

Forked from [Paiban](https://github.com/glennung97/paiban) (on-set transcription for video shoots) as a separate project. It is not meant to be merged back. See [docs/PLAN.md](docs/PLAN.md).

## What it does

- **Live transcript** (ElevenLabs Scribe v2 Realtime). Chinese is shown in Traditional characters.
- **Languages (in ⚙):** automatic detection (default), 中文 · English, 印尼語 Bahasa Indonesia (tuned for casual Jakarta speech) or 荷蘭語 Nederlands.
- **Key points:** only what you'd need to remember (times, prices, requests) gets a faint tint, refreshed at most every 10 s. No tags.
- **Terms to explain:** people, current issues, places, organisations and slang are highlighted wherever they're mentioned (blue = person, orange = current issue, purple = other). Names stay in their original spelling with a small Chinese name under them. Tap one for a popup that stays until closed: a one-line gist, then Luna searches the web for what's happening now, with sources. People get a small Wikipedia photo.
- **Questions answered (green):** when people wonder about something a search can answer ("what's Jason Mraz's new song called?"), Luna highlights it and looks it up straight away; ✓ on the chip means the answer is ready.
- **Live panel:** what's being discussed right now, a short recap, the chips, and three short things to say next (tagged 追問 / 回應 / 換個方向 / 請他解釋), refreshed every 15/30/60/120 s (default 30 s). ↻ refreshes it now. Drag the handle down to shrink it to one line, up (or tap) to open it; it remembers.
- **在聊什麼？／背景知識:** two buttons for a deeper answer on demand: the story of the conversation so far, and the news or culture behind it (with a web search). They open in the same popup.
- **History (☰):** every conversation is saved in this browser; open a past one to read it with its terms and last summary. A conversation used in the last 10 minutes is picked up again after a reload.
- **Settings (⚙):** passcode, language, AI on/off, context, keyterms, refresh interval, model, and 開始新對話.

## Setup

1. **ElevenLabs API key:** https://elevenlabs.io/app/settings/api-keys. If the key can be restricted, allow Speech to Text only.
2. **Vercel:** https://vercel.com/new, import this repo as a **new project** (framework preset: Vite). Under Settings → Environment Variables, add for Production + Preview:
   - `ELEVENLABS_API_KEY`
   - `APP_PASSCODE`: the app asks for it before any paid call. The code is public, so use a long random passcode.
   - `OPENAI_API_KEY`: for the default model, GPT-6 Luna (https://platform.openai.com/api-keys). Optional if you connect your ChatGPT plan (below), but recommended as a fallback.
   - `ANTHROPIC_API_KEY` (optional): enables the Claude Haiku 5.5 option.
   - `LLM_PROVIDER` (optional): `openai` (default) or `anthropic`, used when the phone doesn't pick one.
3. Redeploy after adding the variables (Deployments → ⋯ → Redeploy).

The same API keys as Paiban work; give this project its own `APP_PASSCODE` if you want to keep the two apart.

API keys live only in Vercel env vars or a local `.env.local` (git-ignored). Never commit them.

## Paying with your ChatGPT plan (optional)

OpenAI calls can run on your own ChatGPT Plus/Pro plan ("Sign in with ChatGPT", the self-hosted flow for open-source apps in OpenAI's docs: https://developers.openai.com/siwc/token-sharing-open-source). If the plan fails (usage limit, model not available, expired sign-in), calls fall back to `OPENAI_API_KEY`; ⚙ shows which one paid.

1. In the Vercel project: Storage → add **Upstash Redis** (free plan) and connect it to this project. It adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Redeploy. (Access tokens last 1 hour and every refresh replaces the refresh token, so the server needs somewhere to keep it.)
2. On your computer, in this folder:

   ```bash
   npm run chatgpt-login -- --upload https://liaoban.vercel.app
   ```

   It opens ChatGPT's sign-in in your browser (allow plan usage on the consent screen), lists the models your account can use, picks one (`--model <id>` to choose), and uploads the credentials with your passcode. The local copy is deleted afterwards so only the server refreshes the token.
3. If ⚙ says the refresh was rejected (e.g. after 30 days unused, or you signed out), run step 2 again.

Plan requests are streamed and not stored on OpenAI's side (`store: false`), as the docs require. Web search on the plan depends on your model and account; without it, term explanations come from the model's knowledge and say so.

## Local development

```bash
npm install
npx vercel link        # once, connects this folder to the Vercel project
npx vercel env pull .env.local
npx vercel dev         # serves the Vite app and api/ functions together
```

`npm run dev` (plain Vite) serves the UI only; `/api/*` won't exist there. Two shortcuts for UI work:

- `http://localhost:5173/?demo` loads a staged ride-hailing chat with sample key points, terms, live panel and an open term popup (dev only, no microphone or AI calls; photos still come from Wikipedia).
- `LIAOBAN_API_PROXY=https://<your-deployment>.vercel.app npm run dev` forwards `/api` to the deployed app.

The microphone needs a secure origin: `localhost` works on the laptop. For a phone, use the Vercel URL (HTTPS).

## Checks

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

## Layout

| Path | Purpose |
|---|---|
| `api/scribe-token.ts` | Checks `x-app-passcode`, returns a single-use ElevenLabs realtime token |
| `api/analyze.ts` | Key points as unit ranges, plus terms worth explaining |
| `api/live.ts` | The live panel: title, what's being discussed, recap, things to say |
| `api/explain.ts` | Explains one term, with the model's web search tool (falls back to no search if rejected) |
| `server/llm/` | Prompts (incl. Jakarta slang notes), Zod schemas, `openai.ts` (GPT-6 Luna), `anthropic.ts` (Claude Haiku 5.5) |
| `server/chatgpt/` | Sign in with ChatGPT: OAuth helpers, token store in Upstash Redis with a refresh lock |
| `api/chatgpt-credentials.ts` | Upload / status / disconnect for the ChatGPT plan (passcode; never returns tokens) |
| `scripts/chatgpt-login.ts` | Run locally: sign in to ChatGPT and upload the credentials |
| `server/request.ts` | Shared request body, passcode check and error mapping |
| `src/config.ts` | Language presets and the Jakarta keyterm list |
| `src/lib/scribeSession.ts` | ElevenLabs connection, auto-reconnect |
| `src/lib/analyzer.ts` | Schedulers (key points every 10 s, recap every N s) and API calls |
| `src/lib/annotations.ts` | Key points per unit |
| `src/lib/terms.ts` | Merging terms between analyses, finding their mentions in the text |
| `src/lib/wiki.ts` | Photo lookup on Wikipedia (from the browser) |
| `src/lib/history.ts` | Saved conversations in localStorage |
| `src/components/` | Top bar, settings sheet, transcript, live dock, term popup, history list |
| `tests/` | Tests for `api/` (kept outside `api/` so Vercel doesn't deploy them) |
