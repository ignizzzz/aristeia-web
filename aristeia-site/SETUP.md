# Vercel + Supabase Setup

This project now includes a serverless endpoint at `api/subscribe.js` for waitlist email collection.

## 1) Create Supabase table

Run this SQL in your Supabase SQL editor:

```sql
create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  source text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
```

## 2) Add Vercel environment variables

In Vercel project settings -> Environment Variables, add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TABLE` (optional, defaults to `waitlist`)

Use `.env.example` as reference.

## 3) Deploy

From this folder:

```bash
vercel --prod
```

## 4) Verify

- Open the deployed site.
- Submit an email from the form.
- Confirm the row appears in `public.waitlist` in Supabase.

## Notes

- The endpoint includes a honeypot field (`company`) and basic in-memory rate limiting.
- In-memory rate limiting resets between serverless instances, but still reduces spam.
