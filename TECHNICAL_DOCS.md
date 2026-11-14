# The Logic Heist — Technical Documentation

**Event:** The Logic Heist (Maths Club Timer Event)  
**Inspiration:** Money Heist  
**Version:** 1.0.0  
**Last Updated:** November 2026

---

## 1. Overview

The Logic Heist is a real-time, multi-device timer system for a competitive maths club event featuring 5 rotating puzzle stations. Teams start at different stations, complete timed puzzles (12-minute limit per station), transition between stations (2-minute window), and are tracked live by an admin panel.

The system supports:
- **20 teams** (4 members each)
- **5 stations** with rotation (1→2→3→4→5→1)
- **Team-controlled station timer start**
- **Admin-controlled stop/pause/resume/station assignment**
- **Excel export** of all team times
- **Real-time sync** across devices via WebSockets

---

## 2. System Architecture

### High-Level Diagram

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────┐
│   TEAMS     │──────│   NODE.JS SERVER │──────│   ADMIN     │
│ (team.html) │  WS  │  (server.js +    │  WS  │ (admin.html)│
│             │      │  Socket.io)      │      │             │
└─────────────┘      └──────────────────┘      └─────────────┘
       │                        │
       │                        ▼
       │              ┌──────────────────┐
       │              │ data.json        │
       │              │ (persistence)    │
       │              └──────────────────┘
       │
       ▼
 ┌─────────────┐
 │  index.html │
 │  (join +    │
 │  mask click │
 │  admin auth)│
 └─────────────┘
```

### Network Topology

- **LAN Mode:** One host device runs `node server.js`. All teams and admin connect via `http://<host-ip>:3000`.
- **Cloud Mode:** Server hosted on Railway. All devices connect via `https://<railway-app>.up.railway.app`.
- No direct peer-to-peer communication. All state flows through the central Node.js server.

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js | Server execution |
| **Web Framework** | Express.js | HTTP routing & static file serving |
| **Real-time** | Socket.io (v4.x) | WebSocket bidirectional communication |
| **Frontend** | Vanilla HTML5, CSS3, JavaScript | No build step, no framework dependency |
| **Styling** | Custom CSS (dark theme, red/black Money Heist palette) | Responsive UI |
| **Excel Export** | SheetJS (xlsx.full.min.js via CDN) | Client-side `.xlsx` generation |
| **Persistence** | JSON file (`data.json`) | File-based state storage (no database) |
| **Icons** | Inline SVG (Dali mask) | Theme branding |
| **Deployment** | Railway (cloud) or LAN (local) | Hosting |

**Why no database?**  
For a single-event, short-duration competition (~3 hours), a full database is overkill. State is held in memory and persisted to `data.json` on disk. This simplifies deployment, removes infrastructure dependencies, and is sufficient for ~20 teams.

---

## 4. File Structure

```
logicHeistWebTimer/
├── server.js              # Node.js + Express + Socket.io server
├── package.json           # Node dependencies & start script
├── data.json              # Auto-generated state persistence (created at runtime)
├── README.md              # QR code documentation
├── public/
│   ├── index.html         # Landing page: team join + admin unlock (mask click)
│   ├── team.html          # Team dashboard: timer, station selection
│   ├── admin.html         # Admin panel: live sheet, controls, export
│   ├── css/
│   │   └── style.css      # Shared styles (dark theme, buttons, table)
│   └── favicon.svg        # Dali mask favicon
```

---

## 5. Backend — `server.js`

### Responsibilities
1. Serve static HTML/CSS/JS files via Express
2. Maintain in-memory state of all teams (`teams` object)
3. Handle WebSocket connections via Socket.io
4. Run a 1-second tick timer to auto-complete stations and transitions
5. Persist state to `data.json` on every change
6. Broadcast state updates to all connected clients

### State Model (per team)

```json
{
  "name": "Phantom Crew",
  "startStation": 2,
  "currentStation": 2,
  "status": "idle | active | paused | transition | station_select | finished",
  "completedStations": [1],
  "stationTimes": {
    "s1": { "start": 1731564000000, "end": 1731564720000, "duration": 720000, "pausedElapsed": 0 },
    "s2": { "start": null, "end": null, "duration": null, "pausedElapsed": 0 }
  },
  "stationTimerStart": null,
  "transitionStart": null,
  "totalTime": 720000,
  "updatedAt": 1731564000000
}
```

### Status Lifecycle

```
idle ──(start)──> active ──(12 min or admin stop)──> transition ──(2 min or skip)──> station_select ──(select)──> idle
                                                                                      │
                                                                                      └─(all 5 done)──> finished
active ──(admin pause)──> paused ──(admin resume/start)──> active
```

### Key Server Functions

| Function | Purpose |
|----------|---------|
| `makeTeam()` | Initialize new team object |
| `startTick()` | Start 1-second interval for auto-completion |
| `completeStation()` | Mark station done, record duration, start transition |
| `endTransition()` | End 2-min window, move to next station or finished |
| `skipTransition()` | Admin ends transition early |
| `startOrResumeTeam()` | Start fresh timer or resume from paused |
| `pauseTeam()` | Freeze active timer, record elapsed time |
| `stopStationTimerByAdmin()` | Force-complete station (admin stop) |
| `assignStation()` | Admin assigns team to any station, clears prior record |
| `selectStation()` | Team selects station during station_select |
| `saveState()` | Write `teams` to `data.json` |
| `broadcast()` | Emit `state:update` to all clients |

---

## 6. Frontend

### Pages

| File | URL | Purpose |
|------|-----|---------|
| `index.html` | `/` | Team join form + admin mask-click unlock |
| `team.html` | `/team` | Team dashboard with timer & station selection |
| `admin.html` | `/admin` | Admin live sheet & controls |

### Shared CSS (`public/css/style.css`)

- **Theme:** Money Heist inspired — black (`#0a0a0a`), red (`#b22222`), dark panels (`#121212`)
- **Dali Mask:** Inline SVG icon in header (top-left), click 5× to unlock admin
- **Admin Buttons:**
  - Start/Resume — Green (`#2ecc71`)
  - Pause — Orange (`#e67e22`)
  - Stop — Red (`#e74c3c`)
  - Skip Transition — Blue (`#3498db`)
  - Assign Station — Purple (`#8e44ad`)

### Frontend Logic

Each page connects via `io()` to the server and listens for:
- `state:init` — initial full state on connect
- `state:update` — incremental state changes

Team pages identify themselves via `team:identify` to join a room. Admin authenticates via `admin:auth` with password `Harshal@148`.

---

## 7. Socket.io Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `team:join` | `{ name, startStation }` | Team joins event |
| `team:identify` | `{ name }` | Team identifies for room |
| `team:start` | `{ name }` | Team starts station timer |
| `team:select_station` | `{ name, station }` | Team selects next station |
| `admin:auth` | `{ password }` | Admin login |
| `admin:start` | `{ name }` | Admin starts/resumes team timer |
| `admin:pause` | `{ name }` | Admin pauses team timer |
| `admin:stop` | `{ name }` | Admin stops team timer (completes station) |
| `admin:skip_transition` | `{ name }` | Admin skips 2-min transition |
| `admin:assign_station` | `{ name, station }` | Admin assigns team to station |
| `admin:clear` | none | Admin wipes all data |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `state:init` | `teams` object | Full state on connect |
| `state:update` | `teams` object | State change broadcast |
| `admin:authed` | `true/false` | Login result |

---

## 8. Persistence & Database

### Storage Method: JSON File

- **File:** `data.json` (created automatically in project root)
- **Format:** JSON serialization of the `teams` object
- **Write trigger:** Every state change calls `saveState()`
- **Read trigger:** `loadState()` on server startup

### Advantages
- Zero database infrastructure
- Works on Railway, LAN, or local machine
- Human-readable for debugging

### Limitations
- Data lost on container redeploy (Railway free tier ephemeral filesystem)
- No concurrent write safety (single Node process, fine for this scale)
- Not suitable for multi-instance deployment without Redis adapter

---

## 9. Deployment Options

### Option A: LAN Hosting (Recommended for Venue)

**Requirements:** One device (laptop) stays on and on the same Wi-Fi as all participants.

```
Host device:     node server.js
Team devices:    http://<host-ip>:3000
Admin device:    http://<host-ip>:3000/admin
```

**Pros:** No internet needed, no cold start, zero cost, full control  
**Cons:** Host device must remain on; university Wi-Fi client isolation may block (use phone hotspot as backup)

### Option B: Railway (Cloud)

**Deploy:** Connect GitHub repo to Railway  
**URL:** `https://thelogicheist-production.up.railway.app`  
**Port:** Railway sets `process.env.PORT` automatically (e.g., 8080)

**Pros:** Accessible from internet, no host device needed  
**Cons:** Free tier may sleep (state lost on wake), redeploy wipes data

### Custom Domain

To use `thelogicheist.com`:
1. Add domain in Railway Networking
2. Configure DNS (CNAME for `www`, A/ALIAS for root) at registrar
3. Railway provisions SSL automatically

---

## 10. Security Model

| Aspect | Implementation |
|--------|---------------|
| **Admin Access** | Mask click 5× → password prompt → `Harshal@148` → Socket.io auth |
| **Team Isolation** | One instance per team name (re-join overwrites old session) |
| **CORS** | `origin: '*'` (configure for production domain) |
| **Password** | Hardcoded in source (`Harshal@148`) — change before production use |
| **Data Validation** | Server validates station numbers (1–5), team names, status transitions |

**Note:** Password is visible in source code. For stronger security, move to environment variable.

---

## 11. Excel Export

- **Trigger:** Admin clicks "Export Excel" button
- **Library:** SheetJS (`xlsx.full.min.js` via CDN)
- **Output:** `logic-heist-times.xlsx`
- **Columns:** Team Name, Start Station, Current Station, Status, St 1–5 durations, Total Time
- **Format:** Time values as `MM:SS` strings; `--:--` for incomplete stations

---

## 12. How to Run (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start

# 3. Open in browser
# Teams:   http://localhost:3000
# Admin:   http://localhost:3000/admin
```

**Admin unlock:** Click the Dali mask icon (top-left) 5 times within 3 seconds, then enter password `Harshal@148`.

---

## 13. Event Day Checklist

- [ ] Test on venue Wi-Fi (check client isolation)
- [ ] Have phone hotspot ready as backup network
- [ ] Freeze code before event (no redeploys during competition)
- [ ] Export Excel before clearing data
- [ ] Test admin mask-click + password on admin device
- [ ] Verify all 5 station rotations work end-to-end

---

## 14. Future Improvements

- Environment variable for admin password
- Redis adapter for multi-instance Socket.io
- Database (SQLite/PostgreSQL) for persistent multi-event history
- Team avatars / member names
- Audio alerts when timer ends
- Printable station labels with QR codes

---

**Built for:** Logic Heist Maths Club Event  
**Theme:** Money Heist (Dali mask, black/red aesthetic)  
**Stack:** Node.js + Express + Socket.io + Vanilla JS + SheetJS
