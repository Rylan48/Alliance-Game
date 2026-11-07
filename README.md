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
- For true live multiplayer across different devices, the next step would be adding a small backend (Supabase, Firebase, or a lightweight Node server).

## Multiplayer design docs

- [docs/alliance-supabase.sql](./docs/alliance-supabase.sql) — PostgreSQL/Supabase schema for profiles, lobbies, games, and actions.
- [docs/multiplayer-api-contract.md](./docs/multiplayer-api-contract.md) — backend API, realtime channels, validation rules, and state model.
