# Alliance multiplayer API contract

This is the browser-to-backend contract for the online multiplayer version of Alliance.

## 1) Core model

- The browser is a client UI, not the source of truth.
- The backend owns all game state.
- All action requests must be validated server-side.
- Realtime subscriptions are used for lobby and match state updates.

## 2) Primary entities

### Profile
A persistent player identity.

Fields:
- id: uuid
- display_name: string
- icon: string
- color: string
- auth_user_id: uuid | null
- created_at: ISO timestamp
- updated_at: ISO timestamp

### Lobby
A queue or match room.

Fields:
- id: uuid
- name: string
- host_profile_id: uuid
- status: queue | active | finished
- share_code: string
- settings: object
- created_at: ISO timestamp
- started_at: ISO timestamp | null
- ended_at: ISO timestamp | null
- winner_profile_id: uuid | null

### LobbyPlayer
Membership in a lobby.

Fields:
- id: uuid
- lobby_id: uuid
- profile_id: uuid
- joined_at: ISO timestamp
- is_host: boolean
- is_ready: boolean
- last_seen_at: ISO timestamp

### Game
A live match session.

Fields:
- id: uuid
- lobby_id: uuid
- grid_size: integer
- status: started | refreshing | finished
- started_at: ISO timestamp
- next_refresh_at: ISO timestamp
- round_number: integer
- refresh_mode: standard | quick
- refresh_time_pst: string
- quick_refresh_minutes: integer
- allow_zone_shrink: boolean
- zone_shrink_interval: integer
- zone_bounds: object
- zone_preview: array of coordinate strings or objects
- danger_zone: array of coordinate strings or objects
- winner_profile_id: uuid | null

### GamePlayer
The per-game state for one player.

Fields:
- id: uuid
- game_id: uuid
- profile_id: uuid
- display_name: string
- icon: string
- color: string
- x: integer
- y: integer
- health: integer
- max_health: integer
- range: integer
- ap: integer
- is_downed: boolean
- alive: boolean
- last_action_at: ISO timestamp | null
- last_refresh_at: ISO timestamp | null
- revived_at: ISO timestamp | null

### GameAction
Audit log for every action.

Fields:
- id: uuid
- game_id: uuid
- actor_profile_id: uuid
- action_type: move | attack | gift_ap | gift_heart | upgrade_range | forfeit | declare_victory | vote | refresh
- target_profile_id: uuid | null
- payload: object
- created_at: ISO timestamp
- validated: boolean
- validation_error: string | null

### JuryVote
A downed player vote.

Fields:
- id: uuid
- game_id: uuid
- juror_profile_id: uuid
- voted_for_profile_id: uuid
- round_number: integer
- created_at: ISO timestamp

## 3) Realtime subscriptions

### Lobby list subscription
Use a channel like:
- `lobbies:all`

Events:
- lobby_created
- lobby_updated
- lobby_deleted

### Lobby room subscription
Use a channel like:
- `lobby:{lobby_id}`

Payload example:
```json
{
  "type": "lobby_state",
  "data": {
    "lobby": { "id": "...", "name": "Friday Night", "status": "queue" },
    "players": [
      { "profile_id": "...", "display_name": "Ava", "is_host": true }
    ]
  }
}
```

### Game subscription
Use a channel like:
- `game:{game_id}`

Payload example:
```json
{
  "type": "game_state",
  "data": {
    "game": {
      "id": "...",
      "grid_size": 12,
      "next_refresh_at": "2026-11-07T20:00:00Z",
      "round_number": 2,
      "zone_bounds": { "minX": 1, "maxX": 10, "minY": 1, "maxY": 10 }
    },
    "players": [
      { "profile_id": "...", "x": 2, "y": 2, "health": 3, "ap": 1, "range": 3 }
    ]
  }
}
```

## 4) API endpoints

### POST /api/profiles
Create or get a local profile.

Request:
```json
{
  "display_name": "Ava",
  "icon": "⚔️",
  "color": "#4a7ae8"
}
```

Response:
```json
{
  "profile": {
    "id": "uuid",
    "display_name": "Ava",
    "icon": "⚔️",
    "color": "#4a7ae8"
  }
}
```

### GET /api/lobbies
Get all visible lobbies.

Response:
```json
{
  "lobbies": [
    {
      "id": "uuid",
      "name": "Friday Night",
      "status": "queue",
      "share_code": "Q7F9",
      "player_count": 3,
      "settings": {
        "grid_size": 12,
        "refresh_mode": "standard",
        "refresh_time_pst": "20:00"
      }
    }
  ]
}
```

### POST /api/lobbies
Create a lobby.

Request:
```json
{
  "name": "Friday Night",
  "host_profile_id": "uuid",
  "settings": {
    "grid_size": 12,
    "refresh_mode": "standard",
    "refresh_time_pst": "20:00",
    "allow_zone_shrink": true,
    "zone_shrink_interval": 2,
    "is_test_lobby": false
  }
}
```

Response:
```json
{
  "lobby": {
    "id": "uuid",
    "name": "Friday Night",
    "share_code": "Q7F9",
    "status": "queue"
  }
}
```

### POST /api/lobbies/:id/join
Join an existing lobby.

Request:
```json
{
  "profile_id": "uuid"
}
```

Response:
```json
{
  "joined": true,
  "lobby_id": "uuid",
  "is_host": false
}
```

### POST /api/lobbies/:id/start
Host starts the game.

Request:
```json
{
  "host_profile_id": "uuid"
}
```

Response:
```json
{
  "game": {
    "id": "uuid",
    "lobby_id": "uuid",
    "grid_size": 12,
    "next_refresh_at": "2026-11-07T20:00:00Z"
  }
}
```

### GET /api/games/:id/state
Get full state snapshot.

Response:
```json
{
  "game": {
    "id": "uuid",
    "grid_size": 12,
    "next_refresh_at": "2026-11-07T20:00:00Z",
    "round_number": 1,
    "zone_bounds": { "minX": 0, "maxX": 11, "minY": 0, "maxY": 11 },
    "zone_preview": []
  },
  "players": [
    {
      "profile_id": "uuid",
      "display_name": "Ava",
      "x": 2,
      "y": 3,
      "health": 3,
      "ap": 1,
      "range": 3,
      "is_downed": false,
      "alive": true,
      "icon": "⚔️",
      "color": "#4a7ae8"
    }
  ],
  "logs": [
    "Ava spawned at B4",
    "Refresh happened. Everyone gained +1 AP."
  ]
}
```

### POST /api/games/:id/actions
Submit a game action.

Request:
```json
{
  "profile_id": "uuid",
  "action_type": "move",
  "payload": {
    "x": 3,
    "y": 2
  }
}
```

Possible action types and payloads:

#### move
```json
{
  "action_type": "move",
  "payload": { "x": 3, "y": 2 }
}
```

#### attack
```json
{
  "action_type": "attack",
  "payload": { "target_profile_id": "uuid" }
}
```

#### gift_ap
```json
{
  "action_type": "gift_ap",
  "payload": { "target_profile_id": "uuid" }
}
```

#### gift_heart
```json
{
  "action_type": "gift_heart",
  "payload": { "target_profile_id": "uuid" }
}
```

#### upgrade_range
```json
{
  "action_type": "upgrade_range",
  "payload": {}
}
```

#### vote
```json
{
  "action_type": "vote",
  "payload": { "target_profile_id": "uuid" }
}
```

Response:
```json
{
  "ok": true,
  "action_id": "uuid",
  "game_state": {
    "updated_at": "2026-11-07T01:40:00Z"
  }
}
```

Validation error example:
```json
{
  "ok": false,
  "error": "target out of range",
  "code": "INVALID_TARGET"
}
```

## 5) Validation rules the backend must enforce

### Game start
- Randomly assign starting positions
- Ensure no location overlap
- Each player starts with:
  - health = 3
  - ap = 1
  - range = 3

### Move
- Only adjacent, non-diagonal cells
- Destination cannot be occupied
- Actor must have AP >= 1
- Actor cannot be downed

### Attack
- Target must be within range
- Attack cost = 1 AP
- Decrement target health by 1
- If target health reaches 0, mark as downed
- If target is downed, they lose AP permanently

### Gift AP
- Target must be in range
- Gift only if sender has AP > 0
- Sender AP decreased by 1
- Target AP increased by 1

### Gift heart
- Target must be in range
- Sender must have health > 1 or have heart to give
- If target is downed, revival occurs with 1 heart and 0 AP
- Target is revived as alive and health = 1

### Upgrade range
- Cost is 2 AP
- Range increases by 1
- The exact range pattern from the earlier rules must be encoded on server

### Refresh
- On refresh, all living players gain +1 AP
- If game is in quick mode, use fixed interval from config
- If standard mode, use PST-based target time
- If selected, clear jury vote state for the round

### Zone shrink
- Never change the board dimensions
- Always calculate preview danger zone before actual shrink
- Show preview on the round before actual shrink
- Move danger cells into active bad zone on next refresh
- Damage players still inside the bad zone at refresh time
- If inside dangerous zone again on refresh, take another heart

### Jury vote
- Only downed players may vote
- Vote must be cast once per round
- Highest vote count wins only if unique
- If tied, no AP bonus is granted
- Winner gets +1 AP

## 6) Recommended frontend state shape

```js
{
  profile: {
    id: 'uuid',
    display_name: 'Ava',
    icon: '⚔️',
    color: '#4a7ae8'
  },
  lobby: {
    id: 'uuid',
    name: 'Friday Night',
    status: 'queue'
  },
  game: {
    id: 'uuid',
    grid_size: 12,
    round_number: 2,
    next_refresh_at: '2026-11-07T20:00:00Z',
    zone_bounds: { minX: 1, maxX: 10, minY: 1, maxY: 10 },
    zone_preview: []
  },
  currentPlayer: {
    profile_id: 'uuid',
    x: 2,
    y: 3,
    health: 3,
    ap: 1,
    range: 3
  },
  players: [
    { profile_id: 'uuid', x: 2, y: 3, health: 3, alive: true }
  ]
}
```

## 7) Suggested minimum MVP features

- create lobby
- join lobby by share code or public list
- player profile persistence
- start match
- move action
- attack action
- gift AP
- gift heart
- range upgrade
- live board render
- refresh AP logic
- zone preview + danger logic
- winner detection

## 8) Suggested stretch features

- private share link with invite code
- host-managed lobby settings panel
- silent/hidden enemy info in normal mode
- test lobby mode with fake AI players
- action log
- last seen / disconnected handling
- soft reconnection
- player leave handling
- rules panel in lobby screen

## 9) Recommended implementation order

1. Profiles + lobby creation
2. Lobby membership + visibility
3. Start match + spawn players
4. Board render + actions
5. Refresh logic + AP gain
6. Zone preview + danger zone
7. Jury voting + AP bonus
8. Downed/revival system
9. Victory detection and polish

## 10) Recommended hosting setup

Frontend:
- Vercel or Netlify

Backend:
- Supabase Postgres + Realtime + Edge Functions

This is the lightest-weight setup that still supports real multiplayer and is free to prototype.
