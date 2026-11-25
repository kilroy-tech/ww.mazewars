import { createMaze, DIR_VECTORS, MAP_LIST } from "./maze.js";
import { MazeRenderer, THEMES } from "./renderer.js";
import { audio } from "./audio.js";
import { BotManager } from "./bots.js";

// ==================== CONSTANTS & PROTOCOL ====================
const COMMAND_PREFIX = "/ww.mazewars.";
const PREFIX_STATE = `${COMMAND_PREFIX}state `;
const PREFIX_SHOT = `${COMMAND_PREFIX}shot `;
const PREFIX_HIT = `${COMMAND_PREFIX}hit `;
const PREFIX_DEATH = `${COMMAND_PREFIX}death `;
const PREFIX_LEAVE = `${COMMAND_PREFIX}leave `;

const MESSAGE_FILTERS = [
    "^/ww\\.mazewars\\.(state|shot|hit|death|leave) "
];

const MAX_NAME_LEN = 16;
const HEARTBEAT_MS = 3500;
const PEER_TIMEOUT_MS = 9000;
const SHOT_COOLDOWN_MS = 340;
const SHOT_STEP_INTERVAL = 0.055; // ~18 cells/sec
const RESPAWN_SECONDS = 2.4;
const TELEPORT_COOLDOWN_MS = 1400;

// ==================== DOM ELEMENTS ====================
const connectionBadge = document.getElementById("connection-badge");
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const joinForm = document.getElementById("join-form");
const usernameInput = document.getElementById("username-input");
const mapSelect = document.getElementById("map-select");
const botSelect = document.getElementById("bot-select");
const themeSelect = document.getElementById("theme-select");
const joinBtn = document.getElementById("join-btn");
const soloBtn = document.getElementById("solo-btn");
const lobbyStatus = document.getElementById("lobby-status");
const lobbyError = document.getElementById("lobby-error");

const hudName = document.getElementById("hud-name");
const hudKills = document.getElementById("hud-kills");
const hudDeaths = document.getElementById("hud-deaths");
const hudBest = document.getElementById("hud-best");
const radarBtn = document.getElementById("radar-btn");
const soundBtn = document.getElementById("sound-btn");
const themeBtn = document.getElementById("theme-btn");
const leaveBtn = document.getElementById("leave-btn");
const mapLabel = document.getElementById("map-label");
const playerCountEl = document.getElementById("player-count");
const scoreboardList = document.getElementById("scoreboard-list");
const killFeedEl = document.getElementById("kill-feed");
const fpsCanvas = document.getElementById("fps-canvas");
const mapCanvas = document.getElementById("map-canvas");

// Populate map options
for (const m of MAP_LIST) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    mapSelect.append(opt);
}

// ==================== RUNTIME & SDK STATE ====================
const urlParams = new URLSearchParams(window.location.search);
const hasKilroyParams = Boolean((urlParams.get("alias") || "").trim() && (urlParams.get("group_name") || "").trim());
const instanceId = (() => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID().slice(0, 12);
    }
    return "mw_" + Math.random().toString(36).slice(2, 10);
})();

let sdk = null;
let connected = false;
let initialized = false;
let filtersReady = false;
let closed = false;
const subscriptions = [];

// ==================== GAME STATE ====================
const renderer = new MazeRenderer(fpsCanvas, mapCanvas);
const botManager = new BotManager();

const game = {
    inGame: false,
    soloMode: false,
    maze: createMaze("classic"),
    theme: "classic",
    showAllRadar: true,
    muted: false,
    bestKills: 0,

    player: {
        id: instanceId,
        name: "Eyeball",
        x: 1,
        y: 1,
        dir: 1,
        alive: true,
        kills: 0,
        deaths: 0,
        respawnTimer: 0,
        killedBy: "",
        lastTeleportAt: 0
    },

    camera: {
        x: 1,
        y: 1,
        angle: Math.PI / 2,
        targetAngle: Math.PI / 2,
        peeking: 0 // -1 left, 0 none, +1 right
    },

    effects: {
        muzzleFlash: 0,
        hitFlash: 0,
        teleportFlash: 0,
        hitConfirm: 0,
        dead: false,
        killedBy: ""
    },

    remotePeers: new Map(), // peerId -> peer state
    shots: [],
    seenShotIds: new Set(),
    seenDeathIds: new Set(),
    lastShotAt: 0,
    lastStateSentAt: 0,
    lastLoopTime: 0,
    warnedSendError: false,
    rafId: null
};

// ==================== HELPERS ====================
function messagingReady() {
    return Boolean(sdk) && initialized && connected && filtersReady && !closed && !game.soloMode;
}

function showError(msg) {
    lobbyError.textContent = String(msg).slice(0, 400);
    lobbyError.hidden = false;
}

function clearError() {
    lobbyError.textContent = "";
    lobbyError.hidden = true;
}

function updateConnectionUI() {
    const canJoinSwarm = Boolean(sdk) && initialized && connected && filtersReady && !closed;
    joinBtn.disabled = !canJoinSwarm || !usernameInput.value.trim();

    if (closed) {
        connectionBadge.textContent = "Closed";
        connectionBadge.className = "status-pill";
        return;
    }
    if (game.inGame && game.soloMode) {
        connectionBadge.textContent = "Solo (Bots)";
        connectionBadge.className = "status-pill";
        return;
    }
    if (canJoinSwarm) {
        connectionBadge.textContent = "Swarm Ready";
        connectionBadge.className = "status-pill ok";
        lobbyStatus.textContent = "Connected to Kilroy swarm. Enter a callsign to join multiplayer.";
    } else if (!hasKilroyParams && !sdk) {
        connectionBadge.textContent = "Offline / Solo";
        connectionBadge.className = "status-pill";
        lobbyStatus.textContent = "No Kilroy bootstrap params — Play Solo (Bots) is available.";
    } else if (initialized && !connected) {
        connectionBadge.textContent = "Disconnected";
        connectionBadge.className = "status-pill err";
        lobbyStatus.textContent = "Disconnected from Kilroy swarm.";
    } else {
        connectionBadge.textContent = "Connecting...";
        connectionBadge.className = "status-pill";
    }
}

function applyTheme(themeKey) {
    const key = THEMES[themeKey] ? themeKey : "classic";
    game.theme = key;
    document.body.dataset.theme = key;
    themeSelect.value = key;
    renderer.setTheme(key);
}

function addKillFeed(text) {
    const item = document.createElement("div");
    item.className = "kill-feed-item";
    item.textContent = String(text).slice(0, 80);
    killFeedEl.append(item);
    while (killFeedEl.children.length > 4) {
        killFeedEl.firstElementChild.remove();
    }
    setTimeout(() => {
        if (item.parentNode === killFeedEl) item.remove();
    }, 4500);
}

function isFiniteInt(n, min, max) {
    return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
}

function wrapAngleDelta(current, target) {
    let diff = (target - current) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
}

function resizeCanvases() {
    const fpsRect = fpsCanvas.parentElement.getBoundingClientRect();
    if (fpsRect.width > 0 && fpsRect.height > 0) {
        fpsCanvas.width = Math.max(320, Math.floor(fpsRect.width));
        fpsCanvas.height = Math.max(220, Math.floor(fpsRect.height));
    }
    const mapRect = mapCanvas.getBoundingClientRect();
    if (mapRect.width > 0) {
        const size = Math.max(160, Math.floor(mapRect.width));
        mapCanvas.width = size;
        mapCanvas.height = size;
    }
}

function allOpponents() {
    return [...game.remotePeers.values(), ...botManager.bots];
}

function updateHUD() {
    hudName.textContent = game.player.name;
    hudKills.textContent = String(game.player.kills);
    hudDeaths.textContent = String(game.player.deaths);
    hudBest.textContent = String(game.bestKills);

    const rows = [
        {
            name: game.player.name,
            kills: game.player.kills,
            deaths: game.player.deaths,
            alive: game.player.alive,
            self: true,
            isBot: false
        },
        ...Array.from(game.remotePeers.values()).map((p) => ({
            name: p.name,
            kills: p.kills,
            deaths: p.deaths,
            alive: p.alive,
            self: false,
            isBot: false
        })),
        ...botManager.bots.map((b) => ({
            name: `${b.name} [BOT]`,
            kills: b.kills,
            deaths: b.deaths,
            alive: b.alive,
            self: false,
            isBot: true
        }))
    ];

    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    playerCountEl.textContent = `${rows.length} active`;

    scoreboardList.textContent = "";
    for (const row of rows) {
        const li = document.createElement("li");
        li.className = "score-row" + (row.self ? " self" : "") + (!row.alive ? " dead" : "");
        const nameSpan = document.createElement("span");
        nameSpan.textContent = row.name;
        const scoreSpan = document.createElement("span");
        scoreSpan.textContent = `${row.kills} / ${row.deaths}`;
        li.append(nameSpan, scoreSpan);
        scoreboardList.append(li);
    }
}

function persistPrefs() {
    if (!sdk || !initialized || closed) return;
    sdk.setKV("mazewars_prefs", {
        name: game.player.name,
        theme: game.theme,
        bestKills: game.bestKills
    }).catch(() => {});
}

// ==================== SWARM MESSAGING ====================
function sendSwarm(prefix, payload) {
    if (!messagingReady()) return;
    const text = prefix + JSON.stringify(payload);
    sdk.sendMessage(text, {
        username: game.player.name,
        type: "text/plain"
    }).then((result) => {
        const resp = result && result.response;
        if (resp && (resp.success === false || resp.errors || (resp.args && resp.args.success === false))) {
            const errMsg = resp.errors || (resp.args && resp.args.error) || "Swarm webhook error";
            if (!game.warnedSendError) {
                game.warnedSendError = true;
                addKillFeed(`Swarm error: ${errMsg}`);
            }
        }
    }).catch((err) => {
        console.warn("[mazewars] send failed:", err);
    });
}

function broadcastState(force = false) {
    if (!game.inGame || game.soloMode || !messagingReady()) return;
    const now = performance.now();
    if (!force && now - game.lastStateSentAt < HEARTBEAT_MS) return;
    game.lastStateSentAt = now;
    sendSwarm(PREFIX_STATE, {
        id: game.player.id,
        name: game.player.name,
        map: game.maze.id,
        x: game.player.x,
        y: game.player.y,
        dir: game.player.dir,
        alive: game.player.alive,
        kills: game.player.kills,
        deaths: game.player.deaths
    });
}

function handleIncomingMessage(event) {
    if (closed || !game.inGame || game.soloMode || !messagingReady()) return;
    if (typeof event.message !== "string") return;

    const msg = event.message;
    if (msg.length > 4096) return;

    if (msg.startsWith(PREFIX_STATE)) {
        let data;
        try { data = JSON.parse(msg.slice(PREFIX_STATE.length)); } catch { return; }
        if (!data || typeof data !== "object" || data.id === game.player.id) return;
        if (typeof data.id !== "string" || !data.id.trim() || typeof data.name !== "string") return;
        if (!isFiniteInt(data.x, 0, game.maze.width - 1) || !isFiniteInt(data.y, 0, game.maze.height - 1)) return;
        if (!isFiniteInt(data.dir, 0, 3)) return;

        const existing = game.remotePeers.get(data.id);
        const name = data.name.trim().slice(0, MAX_NAME_LEN) || "Peer";
        if (existing) {
            existing.name = name;
            existing.x = data.x;
            existing.y = data.y;
            existing.dir = data.dir;
            existing.alive = data.alive !== false;
            existing.kills = Number.isInteger(data.kills) && data.kills >= 0 ? data.kills : existing.kills;
            existing.deaths = Number.isInteger(data.deaths) && data.deaths >= 0 ? data.deaths : existing.deaths;
            existing.lastSeen = Date.now();
        } else {
            game.remotePeers.set(data.id, {
                id: data.id,
                name,
                isBot: false,
                x: data.x,
                y: data.y,
                renderX: data.x,
                renderY: data.y,
                dir: data.dir,
                alive: data.alive !== false,
                kills: Number.isInteger(data.kills) && data.kills >= 0 ? data.kills : 0,
                deaths: Number.isInteger(data.deaths) && data.deaths >= 0 ? data.deaths : 0,
                seed: Math.random() * 6,
                lastSeen: Date.now()
            });
            addKillFeed(`${name} entered the maze`);
        }
        updateHUD();
        return;
    }

    if (msg.startsWith(PREFIX_SHOT)) {
        let data;
        try { data = JSON.parse(msg.slice(PREFIX_SHOT.length)); } catch { return; }
        if (!data || typeof data !== "object" || data.id === game.player.id) return;
        if (typeof data.shotId !== "string" || game.seenShotIds.has(data.shotId)) return;
        if (!isFiniteInt(data.x, 0, game.maze.width - 1) || !isFiniteInt(data.y, 0, game.maze.height - 1)) return;
        if (!isFiniteInt(data.dir, 0, 3)) return;
        rememberShotId(data.shotId);
        spawnShot(data.shotId, data.id, typeof data.name === "string" ? data.name.slice(0, MAX_NAME_LEN) : "Peer", data.x, data.y, data.dir, false);
        return;
    }

    if (msg.startsWith(PREFIX_HIT)) {
        let data;
        try { data = JSON.parse(msg.slice(PREFIX_HIT.length)); } catch { return; }
        if (!data || typeof data !== "object") return;
        if (data.targetId !== game.player.id || !game.player.alive) return;
        if (typeof data.shotId !== "string" || game.seenDeathIds.has(data.shotId)) return;
        game.seenDeathIds.add(data.shotId);
        const killerName = typeof data.shooter === "string" ? data.shooter.trim().slice(0, MAX_NAME_LEN) : "Opponent";
        killLocalPlayer(killerName, data.shooterId, data.shotId);
        return;
    }

    if (msg.startsWith(PREFIX_DEATH)) {
        let data;
        try { data = JSON.parse(msg.slice(PREFIX_DEATH.length)); } catch { return; }
        if (!data || typeof data !== "object") return;
        if (typeof data.shotId !== "string" || game.seenDeathIds.has(data.shotId)) return;
        game.seenDeathIds.add(data.shotId);

        if (data.killerId === game.player.id && data.victimId !== game.player.id) {
            game.player.kills += 1;
            if (game.player.kills > game.bestKills) {
                game.bestKills = game.player.kills;
                persistPrefs();
            }
            game.effects.hitConfirm = 1.0;
            audio.playKill();
            broadcastState(true);
        }
        const killer = typeof data.killer === "string" ? data.killer.slice(0, MAX_NAME_LEN) : "Someone";
        const victim = typeof data.victim === "string" ? data.victim.slice(0, MAX_NAME_LEN) : "Player";
        addKillFeed(`${killer} zapped ${victim}`);
        updateHUD();
        return;
    }

    if (msg.startsWith(PREFIX_LEAVE)) {
        let data;
        try { data = JSON.parse(msg.slice(PREFIX_LEAVE.length)); } catch { return; }
        if (!data || typeof data !== "object" || data.id === game.player.id) return;
        const peer = game.remotePeers.get(data.id);
        if (peer) {
            game.remotePeers.delete(data.id);
            addKillFeed(`${peer.name} left the maze`);
            updateHUD();
        }
    }
}

function rememberShotId(id) {
    game.seenShotIds.add(id);
    if (game.seenShotIds.size > 200) {
        const first = game.seenShotIds.values().next().value;
        game.seenShotIds.delete(first);
    }
}

// ==================== GAMEPLAY & COMBAT ====================
function spawnLocalPlayer() {
    const spawn = game.maze.pickSpawn(allOpponents());
    game.player.x = spawn.x;
    game.player.y = spawn.y;
    game.player.dir = spawn.dir;
    game.player.alive = true;
    game.player.killedBy = "";
    game.effects.dead = false;
    game.effects.killedBy = "";
    game.camera.x = spawn.x;
    game.camera.y = spawn.y;
    game.camera.targetAngle = spawn.dir * (Math.PI / 2);
    game.camera.angle = game.camera.targetAngle;
    game.camera.peeking = 0;
}

function killLocalPlayer(killerName, killerId, shotId) {
    if (!game.player.alive) return;
    game.player.alive = false;
    game.player.deaths += 1;
    game.player.respawnTimer = RESPAWN_SECONDS;
    game.player.killedBy = killerName;
    game.effects.dead = true;
    game.effects.killedBy = killerName;
    game.effects.hitFlash = 1.0;
    audio.playHit();
    addKillFeed(`${killerName} zapped ${game.player.name}`);

    if (!game.soloMode) {
        sendSwarm(PREFIX_DEATH, {
            shotId,
            killerId: killerId || "",
            killer: killerName,
            victimId: game.player.id,
            victim: game.player.name
        });
        broadcastState(true);
    }
    updateHUD();
}

function spawnShot(shotId, ownerId, ownerName, startX, startY, dir, isLocal) {
    game.shots.push({
        shotId,
        ownerId,
        ownerName,
        x: startX,
        y: startY,
        dir,
        isLocal,
        stepTimer: 0
    });
}

function fireLocalWeapon() {
    if (!game.inGame || !game.player.alive) return;
    const now = performance.now();
    if (now - game.lastShotAt < SHOT_COOLDOWN_MS) return;
    game.lastShotAt = now;

    const shotId = `${game.player.id}_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    rememberShotId(shotId);
    audio.playLaser();
    game.effects.muzzleFlash = 1.0;

    spawnShot(shotId, game.player.id, game.player.name, game.player.x, game.player.y, game.player.dir, true);

    if (!game.soloMode) {
        sendSwarm(PREFIX_SHOT, {
            id: game.player.id,
            shotId,
            name: game.player.name,
            x: game.player.x,
            y: game.player.y,
            dir: game.player.dir
        });
    }
}

function movePlayer(deltaForward, deltaStrafe) {
    if (!game.inGame || !game.player.alive) return;
    const fVec = DIR_VECTORS[game.player.dir];
    const rVec = DIR_VECTORS[(game.player.dir + 1) % 4];
    const nx = game.player.x + fVec.dx * deltaForward + rVec.dx * deltaStrafe;
    const ny = game.player.y + fVec.dy * deltaForward + rVec.dy * deltaStrafe;

    if (game.maze.isWall(nx, ny)) {
        audio.playBump();
        return;
    }

    game.player.x = nx;
    game.player.y = ny;
    audio.playStep();

    // Check teleporter pad
    const now = performance.now();
    if (game.maze.isTeleporter(nx, ny) && now - game.player.lastTeleportAt > TELEPORT_COOLDOWN_MS) {
        const dest = game.maze.otherTeleporter(nx, ny);
        if (dest) {
            game.player.lastTeleportAt = now;
            game.player.x = dest.x;
            game.player.y = dest.y;
            game.camera.x = dest.x;
            game.camera.y = dest.y;
            game.effects.teleportFlash = 1.0;
            audio.playTeleport();
            addKillFeed(`${game.player.name} teleported!`);
        }
    }

    broadcastState(true);
}

function turnPlayer(deltaDir) {
    if (!game.inGame || !game.player.alive) return;
    game.player.dir = (game.player.dir + deltaDir + 4) % 4;
    game.camera.targetAngle = game.player.dir * (Math.PI / 2);
    broadcastState(true);
}

function setPeek(side) {
    if (!game.inGame || !game.player.alive) {
        game.camera.peeking = 0;
        return;
    }
    if (side === 0) {
        game.camera.peeking = 0;
        return;
    }
    const sideDir = (game.player.dir + (side > 0 ? 1 : 3)) % 4;
    const vec = DIR_VECTORS[sideDir];
    if (!game.maze.isWall(game.player.x + vec.dx, game.player.y + vec.dy)) {
        game.camera.peeking = side;
    } else {
        game.camera.peeking = 0;
    }
}

function updateShots(dt) {
    for (let i = game.shots.length - 1; i >= 0; i--) {
        const shot = game.shots[i];
        shot.stepTimer += dt;
        let remove = false;

        while (shot.stepTimer >= SHOT_STEP_INTERVAL) {
            shot.stepTimer -= SHOT_STEP_INTERVAL;
            const vec = DIR_VECTORS[shot.dir];
            const nx = shot.x + vec.dx;
            const ny = shot.y + vec.dy;

            if (game.maze.isWall(nx, ny)) {
                remove = true;
                break;
            }
            shot.x = nx;
            shot.y = ny;

            // Check hit against local player (bots or offline simulation)
            if (shot.ownerId !== game.player.id && game.player.alive && nx === game.player.x && ny === game.player.y) {
                if (shot.ownerId.startsWith("bot_")) {
                    const bot = botManager.bots.find((b) => b.id === shot.ownerId);
                    if (bot) bot.kills += 1;
                    killLocalPlayer(shot.ownerName, shot.ownerId, shot.shotId);
                    remove = true;
                    break;
                }
            }

            // Check hit against AI bots (from local player or remote peer)
            for (const bot of botManager.bots) {
                if (bot.alive && bot.id !== shot.ownerId && nx === bot.x && ny === bot.y) {
                    bot.alive = false;
                    bot.deaths += 1;
                    bot.respawnTimer = 3.0;
                    if (shot.isLocal) {
                        game.player.kills += 1;
                        if (game.player.kills > game.bestKills) {
                            game.bestKills = game.player.kills;
                            persistPrefs();
                        }
                        game.effects.hitConfirm = 1.0;
                        audio.playKill();
                        addKillFeed(`${game.player.name} zapped ${bot.name} [BOT]`);
                        broadcastState(true);
                    }
                    updateHUD();
                    remove = true;
                    break;
                }
            }
            if (remove) break;

            // Check hit against remote human peers (shooter claims hit)
            if (shot.isLocal && !game.soloMode) {
                for (const peer of game.remotePeers.values()) {
                    if (peer.alive && nx === peer.x && ny === peer.y) {
                        sendSwarm(PREFIX_HIT, {
                            shotId: shot.shotId,
                            shooterId: game.player.id,
                            shooter: game.player.name,
                            targetId: peer.id
                        });
                        game.effects.hitConfirm = 1.0;
                        remove = true;
                        break;
                    }
                }
                if (remove) break;
            }
        }

        if (remove) {
            game.shots.splice(i, 1);
        }
    }
}

function updateLoop(now) {
    if (!game.inGame) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - game.lastLoopTime) / 1000));
    game.lastLoopTime = now;

    // Respawn timer
    if (!game.player.alive) {
        game.player.respawnTimer -= dt;
        if (game.player.respawnTimer <= 0) {
            spawnLocalPlayer();
            broadcastState(true);
            updateHUD();
        }
    }

    // Smooth camera interpolation + peek offset
    let targetX = game.player.x;
    let targetY = game.player.y;
    if (game.camera.peeking !== 0) {
        const sideDir = (game.player.dir + (game.camera.peeking > 0 ? 1 : 3)) % 4;
        const vec = DIR_VECTORS[sideDir];
        if (!game.maze.isWall(game.player.x + vec.dx, game.player.y + vec.dy)) {
            targetX += vec.dx * 0.85;
            targetY += vec.dy * 0.85;
        } else {
            game.camera.peeking = 0;
        }
    }

    const lerp = Math.min(1, dt * 18);
    game.camera.x += (targetX - game.camera.x) * lerp;
    game.camera.y += (targetY - game.camera.y) * lerp;
    game.camera.angle += wrapAngleDelta(game.camera.angle, game.camera.targetAngle) * Math.min(1, dt * 20);

    // Smooth remote peers & prune stale peers
    const nowMs = Date.now();
    let pruned = false;
    for (const [id, peer] of game.remotePeers) {
        peer.renderX += (peer.x - peer.renderX) * Math.min(1, dt * 14);
        peer.renderY += (peer.y - peer.renderY) * Math.min(1, dt * 14);
        if (nowMs - peer.lastSeen > PEER_TIMEOUT_MS) {
            game.remotePeers.delete(id);
            addKillFeed(`${peer.name} timed out`);
            pruned = true;
        }
    }
    if (pruned) updateHUD();

    // Update bots
    botManager.update(dt, game.maze, game.player, (bot) => {
        const shotId = `${bot.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
        spawnShot(shotId, bot.id, `${bot.name} [BOT]`, bot.x, bot.y, bot.dir, false);
    });

    // Update shots
    updateShots(dt);

    // Decay visual effects
    game.effects.muzzleFlash = Math.max(0, game.effects.muzzleFlash - dt * 7);
    game.effects.hitFlash = Math.max(0, game.effects.hitFlash - dt * 3.5);
    game.effects.teleportFlash = Math.max(0, game.effects.teleportFlash - dt * 3.2);
    game.effects.hitConfirm = Math.max(0, game.effects.hitConfirm - dt * 4);
    game.effects.peeking = game.camera.peeking;

    // Periodic heartbeat in multiplayer
    broadcastState(false);

    // Render FPS view & 2D minimap
    const renderEntities = [
        ...Array.from(game.remotePeers.values()).map((p) => ({
            ...p,
            x: p.renderX,
            y: p.renderY
        })),
        ...botManager.bots.map((b) => ({
            ...b,
            x: b.renderX,
            y: b.renderY
        }))
    ];

    renderer.renderFPS(game.maze, game.camera, renderEntities, game.shots, game.effects);
    renderer.renderMap(game.maze, game.player, renderEntities, game.shots, game.showAllRadar);

    game.rafId = requestAnimationFrame(updateLoop);
}

// ==================== SESSION FLOW ====================
function enterGame(soloMode) {
    const rawName = usernameInput.value.trim().slice(0, MAX_NAME_LEN) || "Eyeball";
    game.soloMode = soloMode;
    game.warnedSendError = false;
    game.player.name = rawName;
    game.player.kills = 0;
    game.player.deaths = 0;
    game.remotePeers.clear();
    game.shots = [];
    game.seenShotIds.clear();
    game.seenDeathIds.clear();

    game.maze = createMaze(mapSelect.value);
    mapLabel.textContent = game.maze.name;
    applyTheme(themeSelect.value);

    const botCount = Number(botSelect.value) || 0;
    botManager.setCount(botCount, game.maze, []);
    spawnLocalPlayer();
    botManager.reset(game.maze, [game.player]);

    lobbyScreen.hidden = true;
    gameScreen.hidden = false;
    game.inGame = true;
    resizeCanvases();
    updateConnectionUI();
    updateHUD();
    persistPrefs();

    if (!soloMode) {
        broadcastState(true);
    }

    game.lastLoopTime = performance.now();
    if (game.rafId) cancelAnimationFrame(game.rafId);
    game.rafId = requestAnimationFrame(updateLoop);
    fpsCanvas.focus();
}

function leaveGame() {
    if (!game.inGame) return;
    if (!game.soloMode && messagingReady()) {
        sendSwarm(PREFIX_LEAVE, { id: game.player.id, name: game.player.name });
    }
    game.inGame = false;
    if (game.rafId) {
        cancelAnimationFrame(game.rafId);
        game.rafId = null;
    }
    game.remotePeers.clear();
    game.shots = [];
    game.camera.peeking = 0;
    gameScreen.hidden = true;
    lobbyScreen.hidden = false;
    updateConnectionUI();
    usernameInput.focus();
}

// ==================== INPUT BINDINGS ====================
usernameInput.addEventListener("input", updateConnectionUI);
themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));

joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (joinBtn.disabled) return;
    enterGame(false);
});

soloBtn.addEventListener("click", () => {
    if (!usernameInput.value.trim()) usernameInput.value = "Eyeball";
    enterGame(true);
});

leaveBtn.addEventListener("click", leaveGame);

radarBtn.addEventListener("click", () => {
    game.showAllRadar = !game.showAllRadar;
    radarBtn.textContent = game.showAllRadar ? "Radar: All" : "Radar: LOS";
});

soundBtn.addEventListener("click", () => {
    game.muted = !game.muted;
    audio.setMuted(game.muted);
    soundBtn.textContent = game.muted ? "Sound: Off" : "Sound: On";
});

themeBtn.addEventListener("click", () => {
    const keys = Object.keys(THEMES);
    const idx = (keys.indexOf(game.theme) + 1) % keys.length;
    applyTheme(keys[idx]);
    persistPrefs();
});

fpsCanvas.addEventListener("pointerdown", () => {
    fpsCanvas.focus();
    fireLocalWeapon();
});

// On-screen pointer/touch controls
for (const btn of document.querySelectorAll(".ctrl-btn[data-action]")) {
    const action = btn.dataset.action;
    btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (action === "forward") movePlayer(1, 0);
        else if (action === "backward") movePlayer(-1, 0);
        else if (action === "turn-left") turnPlayer(-1);
        else if (action === "turn-right") turnPlayer(1);
        else if (action === "strafe-left") movePlayer(0, -1);
        else if (action === "strafe-right") movePlayer(0, 1);
        else if (action === "peek-left") setPeek(-1);
        else if (action === "peek-right") setPeek(1);
        else if (action === "fire") fireLocalWeapon();
    });
    if (action === "peek-left" || action === "peek-right") {
        for (const endEvt of ["pointerup", "pointercancel", "pointerleave"]) {
            btn.addEventListener(endEvt, () => setPeek(0));
        }
    }
}

document.addEventListener("keydown", (e) => {
    if (!game.inGame) return;
    const key = e.key.toLowerCase();

    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
        e.preventDefault();
    }

    if (key === "w" || key === "arrowup") movePlayer(1, 0);
    else if (key === "s" || key === "arrowdown") movePlayer(-1, 0);
    else if (key === "a" || key === "arrowleft") turnPlayer(-1);
    else if (key === "d" || key === "arrowright") turnPlayer(1);
    else if (key === "q") movePlayer(0, -1);
    else if (key === "e") movePlayer(0, 1);
    else if (key === "z" && !e.repeat) setPeek(-1);
    else if (key === "c" && !e.repeat) setPeek(1);
    else if (key === " " || key === "f") fireLocalWeapon();
    else if (key === "m" && !e.repeat) soundBtn.click();
    else if (key === "r" && !e.repeat) radarBtn.click();
    else if (key === "escape") leaveGame();
});

document.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (key === "z" || key === "c") {
        setPeek(0);
    }
});

window.addEventListener("blur", () => setPeek(0));
window.addEventListener("resize", () => {
    if (game.inGame) resizeCanvases();
});

// ==================== LIFECYCLE & SDK BOOTSTRAP ====================
function closeWidget() {
    if (closed) return;
    closed = true;
    if (game.inGame && !game.soloMode && messagingReady()) {
        sendSwarm(PREFIX_LEAVE, { id: game.player.id, name: game.player.name });
    }
    if (game.rafId) {
        cancelAnimationFrame(game.rafId);
        game.rafId = null;
    }
    subscriptions.forEach((unsub) => unsub());
    if (sdk) sdk.disconnect();
    updateConnectionUI();
}

window.addEventListener("pagehide", (event) => {
    if (!event.persisted) closeWidget();
});

async function bootstrapSDK() {
    applyTheme("classic");
    updateConnectionUI();

    if (!hasKilroyParams) {
        // Standalone preview without Kilroy launch args: leave swarm disabled, allow solo play.
        updateConnectionUI();
        return;
    }

    try {
        const { initWebWidget } = await import("/apps/kilroy.utils/lib/kilroy/js/webwidget_sdk.js");
        sdk = initWebWidget({
            focusBridgeEnabled: true,
            targetOrigin: window.location.origin
        });
        connected = Boolean(sdk.connected);

        subscriptions.push(sdk.onConnectionState((event) => {
            connected = Boolean(event.connected);
            if (event.error) showError(event.error);
            else clearError();
            updateConnectionUI();
        }));
        subscriptions.push(sdk.onMessage(handleIncomingMessage));
        subscriptions.push(sdk.onLifecycle(({ event }) => {
            if (event === "WIDGET_CLOSING") closeWidget();
        }));

        await sdk.ready;
        await sdk.setMessageFilters(MESSAGE_FILTERS);
        if (closed) return;

        connected = Boolean(sdk.connected);
        filtersReady = true;
        initialized = true;

        // Load saved preferences from Kilroy KV store
        try {
            const prefs = await sdk.getKV("mazewars_prefs", null);
            if (prefs && typeof prefs === "object") {
                if (typeof prefs.name === "string" && prefs.name.trim() && !usernameInput.value.trim()) {
                    usernameInput.value = prefs.name.trim().slice(0, MAX_NAME_LEN);
                }
                if (typeof prefs.theme === "string" && THEMES[prefs.theme]) {
                    applyTheme(prefs.theme);
                }
                if (Number.isInteger(prefs.bestKills) && prefs.bestKills >= 0) {
                    game.bestKills = prefs.bestKills;
                }
            }
        } catch (_kvErr) {}

        updateConnectionUI();
    } catch (err) {
        filtersReady = false;
        initialized = false;
        showError(`Kilroy SDK unavailable: ${err && err.message ? err.message : err}`);
        lobbyStatus.textContent = "Multiplayer unavailable; you can still play Solo (Bots).";
        updateConnectionUI();
    }
}

bootstrapSDK();
