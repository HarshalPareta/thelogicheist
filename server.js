const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const STATION_COUNT = 5;
const STATION_LIMIT_MS = 12 * 60 * 1000;
const TRANSITION_LIMIT_MS = 2 * 60 * 1000;
const ADMIN_PASSWORD = 'Harshal@148';
const HINT_PENALTY_MS = 60 * 1000;

let teams = {};
let tickTimer = null;
let adminSockets = new Set();

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      teams = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) { teams = {}; }
}
function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(teams, null, 2));
  } catch (e) { console.error('save error', e); }
}

function now() { return Date.now(); }
function stationKey(n) { return 's' + n; }

function makeTeam(name, startStation) {
  const s = {};
  for (let i = 1; i <= STATION_COUNT; i++) s[stationKey(i)] = { start: null, end: null, duration: null, pausedElapsed: 0 };
  return {
    name,
    startStation: startStation,
    currentStation: startStation,
    status: 'idle',
    completedStations: [],
    completed: false,
    hintsUsed: [],
    stationTimes: s,
    stationTimerStart: null,
    transitionStart: null,
    totalTime: 0,
    updatedAt: now()
  };
}

function startTick() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    let changed = false;
    const t = now();
    Object.values(teams).forEach(team => {
      if (team.status === 'active' && team.stationTimerStart) {
        if (t - team.stationTimerStart >= STATION_LIMIT_MS) {
          completeStation(team, t);
          changed = true;
        }
      } else if (team.status === 'transition' && team.transitionStart) {
        if (t - team.transitionStart >= TRANSITION_LIMIT_MS) {
          endTransition(team);
          changed = true;
        }
      }
    });
    if (changed) { saveState(); broadcast(); }
  }, 1000);
}
function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function completeStation(team, endTime) {
  const cs = team.currentStation;
  const existing = team.stationTimes[stationKey(cs)];
  let duration;
  if (existing && existing.duration != null) {
    duration = existing.duration;
  } else if (team.stationTimerStart) {
    duration = endTime - team.stationTimerStart;
  } else {
    duration = STATION_LIMIT_MS;
  }
  team.stationTimes[stationKey(cs)] = { start: existing && existing.start ? existing.start : endTime - duration, end: endTime, duration, pausedElapsed: 0 };
  team.totalTime += duration;
  team.stationTimerStart = null;
  team.completedStations = team.completedStations.filter(s => s !== cs);
  team.status = 'transition';
  team.transitionStart = endTime;
  team.updatedAt = endTime;
}

function endTransition(team) {
  team.transitionStart = null;
  if (team.completedStations.length >= STATION_COUNT) {
    team.status = 'finished';
  } else {
    team.status = 'station_select';
  }
  team.updatedAt = now();
}

function skipTransition(team) {
  if (team.status !== 'transition') return false;
  endTransition(team);
  saveState();
  return true;
}

function startOrResumeTeam(team) {
  if (team.status === 'idle') {
    team.status = 'active';
    team.stationTimerStart = now();
  } else if (team.status === 'paused') {
    team.status = 'active';
    const cs = team.currentStation;
    const elapsed = (team.stationTimes[stationKey(cs)] && team.stationTimes[stationKey(cs)].pausedElapsed) || 0;
    team.stationTimerStart = now() - elapsed;
  } else {
    return false;
  }
  team.updatedAt = now();
  saveState();
  startTick();
  return true;
}

function pauseTeam(team) {
  if (team.status !== 'active') return false;
  const cs = team.currentStation;
  const elapsed = now() - team.stationTimerStart;
  if (!team.stationTimes[stationKey(cs)]) team.stationTimes[stationKey(cs)] = { start: null, end: null, duration: null, pausedElapsed: 0 };
  team.stationTimes[stationKey(cs)].pausedElapsed = (team.stationTimes[stationKey(cs)].pausedElapsed || 0) + elapsed;
  team.status = 'paused';
  team.stationTimerStart = null;
  team.updatedAt = now();
  saveState();
  return true;
}

function stopStationTimerByAdmin(team) {
  if (team.status !== 'active') return false;
  completeStation(team, now());
  saveState();
  return true;
}

function markStationCompleteByAdmin(team, stationNumber) {
  stationNumber = parseInt(stationNumber, 10);
  if (stationNumber < 1 || stationNumber > STATION_COUNT) return false;

  const key = stationKey(stationNumber);
  const isCompleted = team.completedStations.includes(stationNumber);

  if (isCompleted) {
    // Unmark: remove completed status but keep the time
    team.completedStations = team.completedStations.filter(s => s !== stationNumber);
    const existing = team.stationTimes[key];
    if (existing) {
      existing.completed = false;
      // Keep duration and end as-is so time is retained
    }
    team.totalTime = 0;
    for (let i = 1; i <= STATION_COUNT; i++) {
      const d = team.stationTimes[stationKey(i)];
      if (d && d.duration != null) team.totalTime += d.duration;
    }
    if (team.status === 'finished') team.status = 'idle';
    team.updatedAt = now();
    saveState();
    return true;
  }

  // Mark as completed - admin can mark any station at any time
  const endTime = now();
  const existing = team.stationTimes[key];
  let duration = 0;

  if (existing && existing.duration != null) {
    duration = existing.duration;
  } else if (team.status === 'active' && team.currentStation === stationNumber && team.stationTimerStart) {
    duration = endTime - team.stationTimerStart;
  } else if (team.status === 'paused' && team.currentStation === stationNumber) {
    duration = (existing && existing.pausedElapsed) || 0;
  }

  team.stationTimes[key] = {
    start: existing && existing.start ? existing.start : endTime - duration,
    end: endTime,
    duration: duration,
    pausedElapsed: 0,
    completed: true
  };

  if (!team.completedStations.includes(stationNumber)) {
    team.completedStations.push(stationNumber);
  }

  team.totalTime = 0;
  for (let i = 1; i <= STATION_COUNT; i++) {
    const d = team.stationTimes[stationKey(i)];
    if (d && d.duration != null) team.totalTime += d.duration;
  }

  if (team.completedStations.length >= STATION_COUNT) {
    team.status = 'finished';
  }

  team.updatedAt = endTime;
  saveState();
  return true;
}

function applyHintPenalty(team, stationNumber) {
  stationNumber = parseInt(stationNumber, 10);
  if (stationNumber < 1 || stationNumber > STATION_COUNT) return false;

  // Cannot apply penalty twice to the same station
  if (team.hintsUsed.includes(stationNumber)) return false;

  const key = stationKey(stationNumber);
  const endTime = now();

  if (!team.stationTimes[key]) {
    team.stationTimes[key] = { start: null, end: null, duration: null, pausedElapsed: 0, penaltyMs: 0 };
  }
  const existing = team.stationTimes[key];

  if (team.status === 'active' && team.currentStation === stationNumber && team.stationTimerStart) {
    // Adjust stationTimerStart backwards so countdown immediately shows less time
    // Cap at 1 second remaining to avoid immediate auto-completion
    const newStart = team.stationTimerStart - HINT_PENALTY_MS;
    const minStart = endTime - STATION_LIMIT_MS + 1000;
    team.stationTimerStart = Math.max(newStart, minStart);
  } else if (team.status === 'paused' && team.currentStation === stationNumber) {
    existing.pausedElapsed = (existing.pausedElapsed || 0) + HINT_PENALTY_MS;
  } else {
    // Not running - apply 60s penalty as duration
    existing.duration = (existing.duration || 0) + HINT_PENALTY_MS;
    existing.end = endTime;
    if (!existing.start) existing.start = endTime - existing.duration;
  }

  if (!team.hintsUsed.includes(stationNumber)) {
    team.hintsUsed.push(stationNumber);
  }

  team.totalTime = 0;
  for (let i = 1; i <= STATION_COUNT; i++) {
    const d = team.stationTimes[stationKey(i)];
    if (d && d.duration != null) team.totalTime += d.duration;
  }

  team.updatedAt = endTime;
  saveState();
  return true;
}

function completeTeamByAdmin(team) {
  if (team.status === 'finished') return false;
  team.status = 'finished';
  team.completed = true;
  team.updatedAt = now();
  saveState();
  return true;
}

function assignStation(team, station) {
  station = parseInt(station, 10);
  if (station < 1 || station > STATION_COUNT) return false;
  team.currentStation = station;
  team.stationTimes[stationKey(station)] = { start: null, end: null, duration: null, pausedElapsed: 0 };
  team.completedStations = team.completedStations.filter(s => s !== station);
  team.hintsUsed = team.hintsUsed.filter(s => s !== station);
  team.status = 'idle';
  team.stationTimerStart = null;
  team.transitionStart = null;
  team.updatedAt = now();
  saveState();
  return true;
}

function selectStation(team, station) {
  if (team.status !== 'station_select') return false;
  station = parseInt(station, 10);
  if (station < 1 || station > STATION_COUNT) return false;
  if (team.completedStations.includes(station)) return false;
  const existing = team.stationTimes[stationKey(station)];
  if (existing && existing.start != null) return false;
  team.currentStation = station;
  team.status = 'idle';
  team.updatedAt = now();
  saveState();
  return true;
}

function availableStations(team) {
  return [...Array(STATION_COUNT).keys()].map(i => i + 1).filter(s => !team.completedStations.includes(s));
}

io.on('connection', (socket) => {
  socket.emit('state:init', teams);

  socket.on('team:join', ({ name, startStation }) => {
    if (!name || !startStation) return;
    const st = parseInt(startStation, 10);
    if (st < 1 || st > STATION_COUNT) return;
    teams[name] = makeTeam(name, st);
    saveState();
    startTick();
    broadcast();
  });

  socket.on('team:identify', ({ name }) => {
    socket.join('team:' + name);
  });

  socket.on('team:start', ({ name }) => {
    const team = teams[name];
    if (!team) return;
    startOrResumeTeam(team);
    broadcast();
  });

  socket.on('team:select_station', ({ name, station }) => {
    const team = teams[name];
    if (!team) return;
    if (selectStation(team, station)) broadcast();
  });

  socket.on('admin:auth', ({ password }) => {
    if (password === ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      socket.emit('admin:authed', true);
    } else {
      socket.emit('admin:authed', false);
    }
  });

  socket.on('admin:start', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    startOrResumeTeam(team);
    broadcast();
    io.to('team:' + name).emit('state:update', teams);
  });

  socket.on('admin:pause', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    pauseTeam(team);
    broadcast();
    io.to('team:' + name).emit('state:update', teams);
  });

  socket.on('admin:stop', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    stopStationTimerByAdmin(team);
    broadcast();
    io.to('team:' + name).emit('state:update', teams);
  });

  socket.on('admin:mark_station_complete', ({ name, station }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    markStationCompleteByAdmin(team, station);
    broadcast();
    io.to('team:' + name).emit('state:update', teams);
  });

  socket.on('admin:hint', ({ name, station }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    applyHintPenalty(team, station);
    broadcast();
    io.to('team:' + name).emit('state:update', teams);
  });

  socket.on('admin:complete_team', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    completeTeamByAdmin(team);
    broadcast();
    io.to('team:' + name).emit('state:update', teams);
  });

  socket.on('admin:skip_transition', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    skipTransition(team);
    broadcast();
    io.to('team:' + name).emit('state:update', teams);
  });

  socket.on('admin:assign_station', ({ name, station }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    if (assignStation(team, station)) {
      broadcast();
      io.to('team:' + name).emit('state:update', teams);
    }
  });

  socket.on('admin:clear', () => {
    if (!adminSockets.has(socket.id)) return;
    teams = {};
    saveState();
    stopTick();
    broadcast();
  });

  socket.on('disconnect', () => {
    adminSockets.delete(socket.id);
  });
});

function broadcast() {
  io.emit('state:update', teams);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/team', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'team.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

loadState();
if (Object.keys(teams).length > 0) startTick();

server.listen(PORT, () => {
  console.log(`Logic Heist Timer running on http://localhost:${PORT}`);
});
