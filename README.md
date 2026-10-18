# The Room

Built by **Treena Lynch** · [unconvinced.ai](https://unconvinced.ai)

A local, self-hosted chat room where one human directs two AI collaborators at once: **Claude** (Anthropic) and **Iris** (an OpenAI GPT model). Both work in one shared project conversation with a shared Project Brain (Canon, Files, Decisions, Agents).

> Independent open-source project. Not affiliated with or endorsed by Anthropic or OpenAI. You bring your own API keys and pay your own usage.

## What it does

- **Route each message** to Claude, Iris or both (chips or `@claude`, `@iris`, `@both`). Parallel replies never see each other until the next turn.
- **Cross-review:** one click asks the other AI to review or implement a reply, optionally on its deeper model.
- **Project Brain:** Canon (rules sent on every call), Decisions, pinned files, per-project model choice. An authority order tells both AIs what wins in a conflict.
- **Shared approvals:** the human, Claude and Iris can approve messages, save Decisions and add Canon automatically with plain-text directives. Tags inside fenced, indented or inline Markdown code are removed before parsing. The human can remove anything.
- **Files:** paste, drop or attach text, images, PDFs and video (frames + transcript).
- **Thread or Split view**, resizable/collapsible side panels, search, Markdown export, "Copy latest" for moving a round into another chat.

The UI name "Iris" is display-only; internally the OpenAI agent's id is `chatgpt`.

## Run it

Requires Node 20.9+ (22 LTS recommended).

```bash
npm install
cp .env.example .env.local     # then put your two API keys in .env.local
npm run dev                    # http://127.0.0.1:3000
```

For daily use: `npm run build && npm start`.

**Try it free first:** `MOCK_AGENTS=1 npm run dev` (PowerShell: `$env:MOCK_AGENTS=1; npm run dev`) streams fake replies with no API calls, so routing, Canon, Decisions, files, retry, stop and persistence can be tested without spending credits.

All settings are documented in `.env.example`.

## Models: everyday vs Deep

Every turn uses the cheaper everyday models (`gpt-6.1-sol`, `claude-sonnet-5-5`). The **Deep** chip next to the routing chips switches one message to the deep models (`gpt-6-astra`, `claude-opus-5-5`); the **Deep review** button on any AI message asks the other AI for a review on its deep model. Both pairs are changeable per project in Agents.

## Files the models can see

| Type | What the models get |
|---|---|
| Text (.md, .txt, scripts, .json, .csv…) | Full text (up to ~60k characters each) |
| Images (png, jpg, webp, gif, heic…) | The image itself, downscaled once to 1568 px (WebP) |
| PDFs (≤30 MB) | The PDF itself — both providers read text and page images |
| Video (mp4, mov, webm, mkv…) | 12 evenly spaced frames with timestamps + an audio transcript (OpenAI transcription). Same method as the Watch skill's local engine. FFmpeg ships with the app (`ffmpeg-static`); nothing to install. |

**Two ways to share a file:**

- **Files tab → Upload:** pinned to every call (text, images, PDFs). Videos start unpinned because 12 frames on every call adds up.
- **Paperclip in the message box:** sent with that one message only, and re-sent while it is within the last 6 messages (`MEDIA_WINDOW`). Can be pinned later from the Files tab.

Claude calls use prompt caching on the system prompt and pinned files, so repeated pinned images cost much less after the first call. OpenAI caches long repeated prefixes automatically.

All data lives in `./data` (SQLite `room.db` + `uploads/`). Back up that folder to back up everything.

## How it maps to the spec

| Spec | Where |
|---|---|
| Routing chips, `@Iris` (or `@chatgpt`) / `@Claude` / `@both` in text | `components/Room.tsx` (`parseMentions`) |
| Parallel calls never see each other's new reply | `lib/run.ts` cuts history at the trigger message |
| Review / implement / send to both / continue | message buttons create routed turns (`mode: review`, `handoff`) |
| Layered context A–F | `lib/context.ts` (`buildRequest`) |
| Canon conflict rule + authority order | Layer A room rules in `lib/context.ts` |
| AgentAdapter interface | `lib/types.ts`, `lib/agents/adapters.ts` (OpenAI Responses API, Anthropic Messages API) |
| Streaming | SSE from `/api/projects/[id]/send` and `/api/messages/[id]/retry` |
| Stop / Retry | `/api/messages/[id]/stop`, `/retry` |
| Persistence | SQLite `lib/db.ts`; generation keeps going and saves even if the browser closes |
| Keys server-side only | read from env in server code only; the only `NEXT_PUBLIC_` value is your display name |
| Single-user / auth | binds to 127.0.0.1; optional `APP_PASSWORD` via `proxy.ts` |
| MVP+: promote to Canon/Decision, search, Markdown export, token display, model selector, summaries | included |

Adding Gemini later: write one more `AgentAdapter` and add its id to `AgentId`.

## Known limits of this version

- Video URLs (YouTube etc.) are not fetched; upload the file. Frames are evenly spaced, not scene-detected.
- Video transcription needs `OPENAI_API_KEY`; without it, frames are still sent.
- Token counts are shown; dollar cost is not (prices change, so no hard-coded rates).
- Summaries are manual (Agents tab → "Summarize older messages").
- `APP_PASSWORD` is basic protection for a home network. Put real auth and HTTPS in front before exposing it to the internet.

## Security

Security hardening after the v0.1.0 review:

- Requests must use `127.0.0.1:PORT` or `localhost:PORT` (PORT defaults to 3000). Mutating API requests require a matching `Origin`; JSON endpoints require `application/json`. Uploads use multipart form data. Command-line API clients must also supply the matching Origin header.
- Automatic saving is preserved by the owner's choice. Directive tags inside Markdown code examples are removed before parsing; plain-text directives still execute automatically. This reduces accidental execution of examples but does not prevent a malicious file from inducing a plain-text directive. Full human approval remains an optional follow-up, not an implemented protection.
- Uploaded HTML, SVG, PDFs, text, and original files download as attachments. Only server-decoded WebP image previews render inline. File responses use `nosniff`, a sandbox CSP, and `no-store`.
- Streaming uploads are limited to 32 MiB per file, 64 MiB per request, four files, and one upload/processing job at a time. Upload parsing has a 60-second deadline; each FFmpeg command has a 30-second timeout, video duration is limited to 30 minutes, and image input is limited to 40 megapixels. Failed requests remove their newly created files.
- Project IDs and upload paths are validated before writing; diagnostics no longer disclose key suffixes. Basic-password comparison uses fixed-size digests and constant-time comparison. HTTP Basic remains local-only; this is not an Internet authentication system.

See `SECURITY-REVIEW.md` for scope, regression checks, and remaining limits.

- Runs on `127.0.0.1` only. Your conversations, uploads and keys stay on your machine (`./data`, `.env.local`), both git-ignored.
- Messages and files you send go to Anthropic and OpenAI under your own API accounts.
- Do not expose it to the internet without real auth and HTTPS in front.

## Contributing

Issues and pull requests are welcome. Run `npm run typecheck` before opening a PR, and test with `MOCK_AGENTS=1` so no credits are spent.

## License

[MIT](LICENSE). Dependencies keep their own licenses; `ffmpeg-static` downloads an FFmpeg binary at install time, which is licensed separately (GPL/LGPL).
