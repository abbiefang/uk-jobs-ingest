# UK Jobs Ingest

Scrapes UK job listings from the public, unauthenticated JSON feeds that applicant-tracking systems publish for their customers' career pages, and upserts them into a Supabase store. All fetched endpoints are public job feeds published by the recruitment platforms themselves.

Source-visible for transparency; **all rights reserved, no license granted.**

## What runs

| Workflow | Cadence | What it does |
|---|---|---|
| `ingest.yml` | every 2 hours (`17 */2 * * *`), timeout 60 min | Fetches every active/empty company's board across 7 ATS providers (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Teamtailor), normalizes to one record shape, keeps UK roles only, upserts idempotently (`on_conflict=ats,external_id`), deactivates vanished postings, logs one run row per ATS. |
| `discover.yml` | Sundays 05:37 UTC, timeout 350 min | Rebuilds the company directory: UK sponsor-register CSV × an open-source ATS company directory × slug-variant probing (content-anchored cursor with a per-run budget), marks dead slugs (3+ consecutive failures), deletes inactive rows older than 60 days. |

Both trigger on `schedule`/`workflow_dispatch` only. Log output is aggregate counts only — no company names or slugs appear on stdout.

## Layout

```
src/
  ingest.ts        orchestrator: fetch → normalize → upsert → deactivate → run log
  discover.ts      directory builder + slug probing + health + retention (--seed mode for bootstrap)
  fetchers/        one module per ATS: pure normalize*() + fetch*() pair, unit-tested on real fixtures
  lib/             http (timeout/retry/rate limiter), text (UK filter, salary regex), supabase (PostgREST), store (pure upsert/dedupe helpers), companies (name normalization, slug variants)
  seed-companies.ts  hand-verified bootstrap list (the only company list kept in-repo; the live directory lives in the database)
```

## Running

```bash
npm install
npm test            # vitest
npm run typecheck
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run ingest
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run discover -- --seed   # first-time bootstrap
```

Requires two env vars (set as Actions secrets): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Never commit or echo them.

## Etiquette

≤1 request/second per ATS host, 20 s timeout, one retry, honest User-Agent. Fetch failures never deactivate a company's stored jobs (outage ≠ empty board).
