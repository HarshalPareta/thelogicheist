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
  const start = team.stationTimerStart || endTime - STATION_LIMIT_MS;
  const end = endTime;
  const duration = end - start;
  team.stationTimes[stationKey(cs)] = { start, end, duration, pausedElapsed: 0 };
  team.totalTime += duration;
  team.stationTimerStart = null;
  team.completedStations.push(cs);
  team.status = 'transition';
  team.transitionStart = end;
  team.updatedAt = end;
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

function assignStation(team, station) {
  station = parseInt(station, 10);
  if (station < 1 || station > STATION_COUNT) return false;
  team.currentStation = station;
  team.stationTimes[stationKey(station)] = { start: null, end: null, duration: null, pausedElapsed: 0 };
  team.completedStations = team.completedStations.filter(s => s !== station);
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
  });

  socket.on('admin:pause', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    pauseTeam(team);
    broadcast();
  });

  socket.on('admin:stop', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    stopStationTimerByAdmin(team);
    broadcast();
  });

  socket.on('admin:skip_transition', ({ name }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    skipTransition(team);
    broadcast();
  });

  socket.on('admin:assign_station', ({ name, station }) => {
    if (!adminSockets.has(socket.id)) return;
    const team = teams[name];
    if (!team) return;
    if (assignStation(team, station)) broadcast();
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
