# Alliance Grid Wars

This is a browser-playable prototype for the Alliance social strategy game.

## Run it locally

1. Open the project folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the app server:
   ```bash
   npm start
   ```
4. Visit `http://localhost:3000` in a browser.

If you prefer the minimal static approach, you can still run:
```bash
python -m http.server 8000
```

## Notes

- The prototype uses browser-local storage to save the current game state.
- It is designed as a free, static HTML/CSS/JavaScript build for easy hosting.
- The repo now includes a Supabase-ready scaffold for the next step toward true live multiplayer.

## Supabase setup

1. Create a Supabase project at https://supabase.com.
2. Open Project Settings -> API and copy the Project URL and anon key.
3. Copy `.env.example` to `.env` and fill in the values:
   ```bash
   cp .env.example .env
   ```
4. Add the values from Supabase into `.env`:
   ```env
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   PORT=3000
   ```
5. Run the schema in `docs/alliance-supabase.sql` in the Supabase SQL editor.
6. Start the app:
   ```bash
   npm start
   ```
7. Check the config endpoint:
   ```bash
   curl http://localhost:3000/api/supabase/status
   ```

This repo now exposes a readiness check for Supabase, browser-side Realtime subscriptions for lobby/game changes, and the helper files in `src/supabase/` are the starting point for profile and lobby queries.

## Multiplayer design docs

- [docs/alliance-supabase.sql](./docs/alliance-supabase.sql) — PostgreSQL/Supabase schema for profiles, lobbies, games, and actions.
- [docs/multiplayer-api-contract.md](./docs/multiplayer-api-contract.md) — backend API, realtime channels, validation rules, and state model.
