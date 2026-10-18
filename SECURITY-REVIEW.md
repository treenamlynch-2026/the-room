# Security fixes - October 18, 2026

Base: public release `f218cca3c7a0b559ef8fe6da2f4824eaeeb6c0c3`.
Status: implemented in an isolated checkout; local checks passed. Submitted on the `security-hardening` review branch. Pending Claude's review before any merge to main. Treena's running installation is unchanged.

## Changes mapped to findings

| Finding | Change |
| --- | --- |
| M1: foreign-origin requests / missing Host validation | `proxy.ts` calls `requestProblem` before authentication or application work. Only loopback hostnames on PORT are accepted. Browser Origin must match the HTTP host. API writes require Origin and endpoint-appropriate content types. |
| M2: active uploads on app origin | Original files download as application/octet-stream attachments with sandbox CSP, nosniff and no-store. Only server-decoded WebP previews render inline. PDFs now download too. |
| M3: model directives writing project authority - PARTIAL HARDENING | Markdown is parsed into a syntax tree; directive tags in fenced, indented and inline code are stripped before execution. Plain-text automatic Canon/Decision/approval behavior is intentionally preserved by Treena's instruction. The original plain-text prompt-injection risk remains open. No click-to-approve step was added. |
| M4: traversal in upload project ID | UUID and project existence checks occur before upload parsing or disk writes. Real resolved directories must stay inside the upload root. Filenames are generated, writes are exclusive, and failures clean newly created files. |
| L5: upload resource limits | Busboy streams files to disk. Limits: 32 MiB/file, 64 MiB/request counted from bytes, four files/request, one concurrent upload/processing job, 60-second receive deadline. FFmpeg commands time out after 30 seconds and accept only local file/pipe protocols and supported container demuxers. Videos over 30 minutes and images over 40 megapixels are rejected. |
| Info: key suffix | Diagnostic tail is null; no credential characters returned. |
| Info: password comparison | Fixed-size SHA-256 digests compared using timingSafeEqual; malformed Basic headers yield 401. |
| Info: public author email | Future commits in this checkout use treenamlynch-2026@users.noreply.github.com. Existing public history is preserved. |

## Verification performed by Iris

- `npm run typecheck`: passed.
- `npm run build`: passed on isolated build data, with MOCK_AGENTS enabled and provider keys blank.
- `npm run test:security`: 15 passing function/handler and streaming regression tests, including automatic plain-text directives and inert code examples.
- `node tests/security-http.cjs`: 14 passing HTTP checks against the isolated production build on 127.0.0.1:3107, with mock providers and scratch data.
- HTTP checks included foreign Host/Origin rejection, encoded traversal rejection, missing-project rejection, safe HTML download, safe image preview, processing of a one-second plain video, two mock replies persisted, and human approval/Canon/Decision controls.
- `npm audit --package-lock-only --ignore-scripts`: zero known npm vulnerabilities after adding busboy, its TypeScript definitions, and a direct dependency on the Markdown parser.
- `git diff --check`: passed.

No paid provider calls, existing project edits, live browser exploits or modifications to Treena's working installation were performed. The media fixture contains only a plain black frame, without characters.

## Remaining boundaries

- This remains a single-user local application. The new Host rules intentionally reject non-loopback deployment. Do not publish it as an Internet service without a separate authentication, HTTPS and deployment review.
- Origin checks are a browser boundary, not protection against malware or another local program that can forge headers. Local OS access remains trusted.
- Existing AI-written Canon/Decisions/approvals are preserved. Review them manually; new protections do not retroactively certify old records.
- M3 remains partially mitigated: a malicious file can still induce an executable directive in plain model output. Code-example filtering is not a complete prompt-injection defense. Treena chose to retain automatic saving; requiring human approval before persistent changes remains an optional follow-up.
- Native decoder vulnerabilities, browser-level exploitability, encrypted storage, and paid-provider integration behavior were not certified. An npm audit does not audit the bundled FFmpeg executable.
- Upload caps bound each request and concurrent processing, not total lifetime disk consumption. Backups and periodic storage cleanup remain the operator's responsibility.
- Other APIs do not yet enforce a comprehensive per-user rate or dollar budget. This change is scoped to the agreed findings, not an Internet production certification.
