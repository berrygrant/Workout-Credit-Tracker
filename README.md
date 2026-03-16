# Workout Credit Tracker

Simple static app for tracking:

- payments made in 4-hour blocks
- half-hour session credits used
- remaining balance in both time and credits
- optional secure sync with Supabase

## How it works

- `1` purchased block = `4` hours = `8` half-hour credits
- each session usually consumes `1` credit
- without Supabase, data is stored in browser `localStorage`

That means the app works immediately on GitHub Pages, but the browser-only mode is just a demo/local mode. For real protection against credit tampering, use the Supabase setup below so the ledger lives in a database and changes require login.

## Files

- `index.html`: app structure
- `styles.css`: visual design and responsive layout
- `app.js`: tracking logic, auth flow, local demo mode, and Supabase mode
- `config.js`: frontend config for Supabase
- `config.example.js`: config template
- `supabase.sql`: database schema, RLS, and balance-guard trigger

## Run locally

You can just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Secure mode with Supabase

1. Create a Supabase project.
2. In Supabase, open the SQL editor and run [`supabase.sql`](./supabase.sql).
3. Open `Project Settings -> Data API` or `Settings -> API` and copy the project URL and anon key.
4. Put those values into [`config.js`](./config.js).
5. In `Authentication`, use email/password for the easiest setup.
6. Create the trainer user with an email and password.
7. Disable open signups if you want the app locked down to invited users only.

Important:

- the anon key is safe in the frontend
- never put the service role key in `config.js`
- secure mode requires login before credits can be changed
- the sign-in form uses email + password
- the database trigger blocks changes that would make the historical balance go negative

## Deploy to GitHub Pages

1. Push these files to a GitHub repository.
2. In GitHub, open `Settings -> Pages`.
3. Set the source to deploy from your main branch.
4. Use the repository root as the published folder.

GitHub Pages will host the app as a normal static site.

## When to choose Streamlit instead

Choose Streamlit only if you want to keep building toward a Python-based app. For truly shared trainer/client tracking across multiple devices, the next step would be adding a small backend or shared store such as:

- Google Sheets
- Supabase
- Airtable

Without that, Streamlit would still need an extra persistence layer for reliable shared updates.
