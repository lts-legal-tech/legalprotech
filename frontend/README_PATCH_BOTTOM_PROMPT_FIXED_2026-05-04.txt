Patch 2026-05-04 - Fix Flow worker clicking top search input instead of bottom prompt

Changed file:
- scripts/windows-flow-worker.mjs

Fixes included:
1. Fixed syntax error caused by an extra closing brace before automateWithPlaywright().
2. clickRealFlowPromptBox() now only accepts bottom composer candidates:
   - rejects search/header/nav/dialog/search popover elements
   - rejects inputs above ~48% page height
   - prefers textarea/contenteditable/role=textbox near bottom
   - falls back to safe bottom composer coordinate instead of top search input
3. Added activeElement verification after click:
   - if focused element looks like search/filter/email/password or is not bottom area, worker saves debug artifacts and fails clearly.
4. detectFlowComposer(), findFlowPromptPoint(), and fillPromptByDom() also reject top/search inputs and require bottom composer region.

Validated:
- node --check scripts/windows-flow-worker.mjs

Run:
1. cd frontend
2. npm install
3. npm run dev
4. In another terminal: npm run flow:worker

Optional emergency override:
- Set FLOW_FORCE_COORDINATES=1 and FLOW_PROMPT_CLICK=x,y in frontend/.env.local if Flow changes UI again.
