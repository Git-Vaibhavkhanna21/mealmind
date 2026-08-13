# Supabase + Google Auth setup

Manual steps to apply the schema and enable Google sign-in. Do these once,
in order.

## 1. Apply the schema

Project ref: `dssyufxseilflgmttavt`.

1. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/dssyufxseilflgmttavt/sql/new).
2. Paste the contents of [`migrations/0001_init.sql`](migrations/0001_init.sql)
   and run it. This creates all five tables, enables the `vector` extension,
   adds the `ivfflat` index on `recipes.embedding`, and turns on RLS with
   per-user policies.
3. Confirm in **Table Editor** that all five tables exist and each shows
   "RLS enabled".

(If you'd rather use the CLI: `supabase link --project-ref dssyufxseilflgmttavt`
then `supabase db push`.)

## 2. Create a Google OAuth client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or pick an existing one) for MealMind.
3. Open **APIs & Services → OAuth consent screen**.
   - User type: External (unless you're on a Google Workspace org and want Internal).
   - Fill in app name (`MealMind`), your support email, and developer contact
     email.
   - Add scopes: `.../auth/userinfo.email` and `.../auth/userinfo.profile`
     (these are the defaults Supabase needs).
   - Add yourself as a test user if the app is in "Testing" mode.
4. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `MealMind (Supabase)`.
   - Authorized redirect URIs — add exactly this Supabase callback URL:
     ```
     https://dssyufxseilflgmttavt.supabase.co/auth/v1/callback
     ```
   - Click **Create**. Copy the **Client ID** and **Client Secret** shown —
     you'll paste both into Supabase next.

## 3. Enable the Google provider in Supabase

1. Open [Authentication → Providers](https://supabase.com/dashboard/project/dssyufxseilflgmttavt/auth/providers)
   in the Supabase dashboard.
2. Find **Google** in the list and toggle it on.
3. Paste the **Client ID** and **Client Secret** from step 2.
4. Save. Supabase's own callback URL (`.../auth/v1/callback`) is fixed and
   already matches what you added to Google Cloud Console in step 2 — no
   further changes needed there.

## 4. Configure redirect URLs for the app

Still in the Supabase dashboard, under
[Authentication → URL Configuration](https://supabase.com/dashboard/project/dssyufxseilflgmttavt/auth/url-configuration):

- **Site URL**: your production URL once deployed (e.g. `https://mealmind.app`).
- **Redirect URLs**: add both
  - `http://localhost:3000/auth/callback` (local dev)
  - your production equivalent, e.g. `https://mealmind.app/auth/callback`

The frontend calls `supabase.auth.signInWithOAuth` with
`redirectTo: <origin>/auth/callback`, and `frontend/app/auth/callback/route.ts`
exchanges the code, creates the `users` row on first login, and redirects to
`/onboarding` or `/pantry`.

## 5. Local env vars

Copy `frontend/.env.local.example` to `frontend/.env.local` and fill in the
anon key from
[Project Settings → API](https://supabase.com/dashboard/project/dssyufxseilflgmttavt/settings/api):

```bash
cp frontend/.env.local.example frontend/.env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://dssyufxseilflgmttavt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/public key from Project Settings → API>
```
