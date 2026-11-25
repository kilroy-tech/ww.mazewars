import { DIR_VECTORS } from "./maze.js";

export const THEMES = {
    classic: {
        name: "Classic Mac",
        bg: "#f7f7f2",
        ceiling: "#f7f7f2",
        floor: "#eaeae0",
        ink: "#111111",
        wallSide: "#ffffff",
        wallFront: "#e2e2d8",
        wallFar: "#c8c8be",
        ditherInk: "rgba(17, 17, 17, 0.24)",
        ditherFar: "rgba(17, 17, 17, 0.40)",
        bolt: "#111111",
        boltCore: "#ffffff",
        hitFlash: "rgba(17, 17, 17, 0.65)",
        mapBg: "#f7f7f2",
        mapWall: "#111111",
        mapGrid: "rgba(17, 17, 17, 0.12)",
        mapPlayer: "#111111",
        mapEnemy: "#444444",
        mapTeleport: "#111111"
    },
    green: {
        name: "Phosphor Green",
        bg: "#071409",
        ceiling: "#051007",
        floor: "#0a1c0d",
        ink: "#4af66b",
        wallSide: "#0c2411",
        wallFront: "#113218",
        wallFar: "#091c0d",
        ditherInk: "rgba(74, 246, 107, 0.20)",
        ditherFar: "rgba(74, 246, 107, 0.34)",
        bolt: "#b8ff8a",
        boltCore: "#ffffff",
        hitFlash: "rgba(74, 246, 107, 0.45)",
        mapBg: "#071409",
        mapWall: "#2ab847",
        mapGrid: "rgba(74, 246, 107, 0.12)",
        mapPlayer: "#b8ff8a",
        mapEnemy: "#ff5c5c",
        mapTeleport: "#4af66b"
    },
    amber: {
        name: "Amber CRT",
        bg: "#160d04",
        ceiling: "#120a03",
        floor: "#1c1106",
        ink: "#ffb038",
        wallSide: "#241507",
        wallFront: "#321e0a",
        wallFar: "#1a1005",
        ditherInk: "rgba(255, 176, 56, 0.22)",
        ditherFar: "rgba(255, 176, 56, 0.36)",
        bolt: "#ffe28a",
        boltCore: "#ffffff",
        hitFlash: "rgba(255, 176, 56, 0.45)",
        mapBg: "#160d04",
        mapWall: "#d9881c",
        mapGrid: "rgba(255, 176, 56, 0.12)",
        mapPlayer: "#ffe28a",
        mapEnemy: "#ff594f",
        mapTeleport: "#ffb038"
    }
};

const MAX_VIEW_CELLS = 9;
const Z_NEAR = 0.12;

function createDitherPattern(ctx, color, density = 1) {
    const tile = document.createElement("canvas");
    tile.width = 4;
    tile.height = 4;
    const tctx = tile.getContext("2d");
    tctx.fillStyle = color;
    if (density === 1) {
        tctx.fillRect(0, 0, 1, 1);
        tctx.fillRect(2, 2, 1, 1);
    } else {
        tctx.fillRect(0, 0, 1, 1);
        tctx.fillRect(2, 0, 1, 1);
        tctx.fillRect(1, 2, 1, 1);
        tctx.fillRect(3, 2, 1, 1);
    }
    return ctx.createPattern(tile, "repeat");
}

export class MazeRenderer {
    constructor(fpsCanvas, mapCanvas) {
        this.fpsCanvas = fpsCanvas;
        this.fpsCtx = fpsCanvas.getContext("2d");
        this.mapCanvas = mapCanvas;
        this.mapCtx = mapCanvas.getContext("2d");
        this.themeKey = "classic";
        this.patterns = {};
        this._buildPatterns();
    }

    setTheme(themeKey) {
        this.themeKey = THEMES[themeKey] ? themeKey : "classic";
        this._buildPatterns();
    }

    _buildPatterns() {
        const theme = THEMES[this.themeKey];
        this.patterns = {
            front: createDitherPattern(this.fpsCtx, theme.ditherInk, 1),
            far: createDitherPattern(this.fpsCtx, theme.ditherFar, 2)
        };
    }

    renderFPS(maze, camera, entities, shots, effects) {
        const canvas = this.fpsCanvas;
        const ctx = this.fpsCtx;
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h) return;

        const theme = THEMES[this.themeKey];
        const cx = w * 0.5;
        const cy = h * 0.5;
        const focal = Math.min(w * 0.54, h * 0.66);

        // Background: ceiling & floor halves
        ctx.fillStyle = theme.ceiling;
        ctx.fillRect(0, 0, w, cy);
        ctx.fillStyle = theme.floor;
        ctx.fillRect(0, cy, w, h - cy);

        // Subtle horizon line
        ctx.strokeStyle = theme.ditherInk;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();

        // Camera basis: angle 0 = North (0, -1), PI/2 = East (1, 0)
        // Step eye slightly back within current open cell so current cell's walls/doorways frame the view.
        const sinA = Math.sin(camera.angle);
        const cosA = Math.cos(camera.angle);
        const fx = sinA;
        const fy = -cosA;
        const rx = cosA;
        const ry = sinA;
        const eyeX = camera.x - fx * 0.36;
        const eyeY = camera.y - fy * 0.36;

        const toCamera = (wx, wy) => {
            const dx = wx - eyeX;
            const dy = wy - eyeY;
            return {
                u: dx * rx + dy * ry,
                v: dx * fx + dy * fy
            };
        };

        const drawItems = [];

        // Gather visible teleporter floor pads
        for (const tp of maze.teleporters) {
            const dx = tp.x - eyeX;
            const dy = tp.y - eyeY;
            const distSq = dx * dx + dy * dy;
            if (distSq > MAX_VIEW_CELLS * MAX_VIEW_CELLS) continue;
            const c = toCamera(tp.x, tp.y);
            if (c.v < 0.15) continue;
            drawItems.push({
                kind: "teleporter",
                distSq: distSq + 0.4,
                cx: tp.x,
                cy: tp.y
            });
        }

        // Gather visible wall faces in local window
        const minX = Math.max(0, Math.floor(camera.x) - MAX_VIEW_CELLS);
        const maxX = Math.min(maze.width - 1, Math.ceil(camera.x) + MAX_VIEW_CELLS);
        const minY = Math.max(0, Math.floor(camera.y) - MAX_VIEW_CELLS);
        const maxY = Math.min(maze.height - 1, Math.ceil(camera.y) + MAX_VIEW_CELLS);

        const pushFace = (ax, ay, bx, by, nx, ny) => {
            const midX = (ax + bx) * 0.5;
            const midY = (ay + by) * 0.5;
            const vx = midX - eyeX;
            const vy = midY - eyeY;
            // Backface cull: camera must be in front of face normal
            if (vx * nx + vy * ny >= 0) return;

            const p1 = toCamera(ax, ay);
            const p2 = toCamera(bx, by);
            if (p1.v < Z_NEAR && p2.v < Z_NEAR) return;

            let u1 = p1.u;
            let v1 = p1.v;
            let u2 = p2.u;
            let v2 = p2.v;

            if (v1 < Z_NEAR) {
                const t = (Z_NEAR - v1) / (v2 - v1);
                u1 = u1 + (u2 - u1) * t;
                v1 = Z_NEAR;
            } else if (v2 < Z_NEAR) {
                const t = (Z_NEAR - v2) / (v1 - v2);
                u2 = u2 + (u1 - u2) * t;
                v2 = Z_NEAR;
            }

            const distSq = vx * vx + vy * vy;
            const facingDot = Math.abs(nx * fx + ny * fy);
            drawItems.push({
                kind: "wall",
                distSq,
                u1,
                v1,
                u2,
                v2,
                shaded: facingDot > 0.5
            });
        };

        for (let gy = minY; gy <= maxY; gy++) {
            for (let gx = minX; gx <= maxX; gx++) {
                if (!maze.isWall(gx, gy)) continue;
                const ddx = gx - camera.x;
                const ddy = gy - camera.y;
                if (ddx * ddx + ddy * ddy > (MAX_VIEW_CELLS + 1) * (MAX_VIEW_CELLS + 1)) continue;

                // North face
                if (!maze.isWall(gx, gy - 1)) {
                    pushFace(gx - 0.5, gy - 0.5, gx + 0.5, gy - 0.5, 0, -1);
                }
                // South face
                if (!maze.isWall(gx, gy + 1)) {
                    pushFace(gx + 0.5, gy + 0.5, gx - 0.5, gy + 0.5, 0, 1);
                }
                // West face
                if (!maze.isWall(gx - 1, gy)) {
                    pushFace(gx - 0.5, gy + 0.5, gx - 0.5, gy - 0.5, -1, 0);
                }
                // East face
                if (!maze.isWall(gx + 1, gy)) {
                    pushFace(gx + 0.5, gy - 0.5, gx + 0.5, gy + 0.5, 1, 0);
                }
            }
        }

        // Gather visible opponents / bots
        for (const ent of entities) {
            if (!ent.alive) continue;
            const dx = ent.x - eyeX;
            const dy = ent.y - eyeY;
            const distSq = dx * dx + dy * dy;
            if (distSq > MAX_VIEW_CELLS * MAX_VIEW_CELLS) continue;
            const c = toCamera(ent.x, ent.y);
            if (c.v < 0.22) continue;
            drawItems.push({
                kind: "entity",
                distSq,
                u: c.u,
                v: c.v,
                entity: ent
            });
        }

        // Gather visible laser bolts
        for (const shot of shots) {
            const dx = shot.x - eyeX;
            const dy = shot.y - eyeY;
            const distSq = dx * dx + dy * dy;
            if (distSq > MAX_VIEW_CELLS * MAX_VIEW_CELLS) continue;
            const c = toCamera(shot.x, shot.y);
            if (c.v < 0.16) continue;
            drawItems.push({
                kind: "shot",
                distSq,
                u: c.u,
                v: c.v,
                shot
            });
        }

        // Sort back-to-front (Painter's Algorithm)
        drawItems.sort((a, b) => b.distSq - a.distSq);

        for (const item of drawItems) {
            if (item.kind === "teleporter") {
                this._drawTeleporterFloor(ctx, toCamera, cx, cy, focal, item.cx, item.cy, theme);
            } else if (item.kind === "wall") {
                this._drawWallQuad(ctx, cx, cy, focal, item, theme);
            } else if (item.kind === "entity") {
                this._drawEyeball(ctx, cx, cy, focal, camera.angle, item, theme);
            } else if (item.kind === "shot") {
                this._drawShot(ctx, cx, cy, focal, item, theme);
            }
        }

        // Crosshair / classic Mac targeting reticle
        this._drawReticle(ctx, cx, cy, effects, theme);

        // Muzzle / Teleport / Hit overlays
        if (effects.muzzleFlash > 0) {
            ctx.save();
            ctx.strokeStyle = theme.ink;
            ctx.lineWidth = 2;
            const r = Math.min(w, h) * 0.12 * effects.muzzleFlash;
            ctx.beginPath();
            ctx.moveTo(cx, cy + h * 0.25);
            ctx.lineTo(cx, cy + 6);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy + 4, r * 0.4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if (effects.teleportFlash > 0) {
            ctx.save();
            ctx.fillStyle = theme.ink;
            ctx.globalAlpha = Math.min(0.65, effects.teleportFlash * 0.7);
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }

        if (effects.hitFlash > 0) {
            ctx.save();
            ctx.fillStyle = theme.hitFlash;
            ctx.globalAlpha = Math.min(0.85, effects.hitFlash);
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }

        // Dead overlay
        if (effects.dead) {
            ctx.save();
            ctx.fillStyle = theme.bg;
            ctx.globalAlpha = 0.65;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 1;
            ctx.fillStyle = theme.ink;
            ctx.strokeStyle = theme.ink;
            ctx.lineWidth = 2;
            const boxW = Math.min(w * 0.76, 300);
            const boxH = 84;
            ctx.fillStyle = theme.bg;
            ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
            ctx.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
            ctx.fillStyle = theme.ink;
            ctx.textAlign = "center";
            ctx.font = "bold 18px 'Chicago', 'Geneva', 'Courier New', monospace";
            ctx.fillText("ZAPPED!", cx, cy - 10);
            ctx.font = "13px 'Geneva', 'Courier New', monospace";
            const msg = effects.killedBy ? `By ${effects.killedBy} — Respawning...` : "Respawning...";
            ctx.fillText(msg.slice(0, 34), cx, cy + 16);
            ctx.restore();
        }

        // Peek indicator badge
        if (effects.peeking !== 0 && !effects.dead) {
            ctx.save();
            ctx.fillStyle = theme.ink;
            ctx.fillRect(cx - 56, 10, 112, 22);
            ctx.fillStyle = theme.bg;
            ctx.font = "bold 11px 'Geneva', 'Courier New', monospace";
            ctx.textAlign = "center";
            ctx.fillText(effects.peeking < 0 ? "< PEEKING LEFT" : "PEEKING RIGHT >", cx, 25);
            ctx.restore();
        }
    }

    _drawTeleporterFloor(ctx, toCamera, cx, cy, focal, tx, ty, theme) {
        const corners = [
            toCamera(tx - 0.34, ty),
            toCamera(tx, ty - 0.34),
            toCamera(tx + 0.34, ty),
            toCamera(tx, ty + 0.34)
        ];
        if (corners.some((p) => p.v < Z_NEAR)) return;
        ctx.save();
        ctx.beginPath();
        corners.forEach((p, idx) => {
            const sx = cx + (p.u / p.v) * focal;
            const sy = cy + (0.49 / p.v) * focal;
            if (idx === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    _drawWallQuad(ctx, cx, cy, focal, item, theme) {
        const sx1 = cx + (item.u1 / item.v1) * focal;
        const hh1 = (0.5 / item.v1) * focal;
        const sx2 = cx + (item.u2 / item.v2) * focal;
        const hh2 = (0.5 / item.v2) * focal;

        // Skip zero-width or totally off-screen quads
        const w = ctx.canvas.width;
        if (Math.max(sx1, sx2) < -4 || Math.min(sx1, sx2) > w + 4) return;
        if (Math.abs(sx1 - sx2) < 0.5) return;

        ctx.beginPath();
        ctx.moveTo(sx1, cy - hh1);
        ctx.lineTo(sx2, cy - hh2);
        ctx.lineTo(sx2, cy + hh2);
        ctx.lineTo(sx1, cy + hh1);
        ctx.closePath();

        const avgV = (item.v1 + item.v2) * 0.5;
        if (avgV > 4.5) {
            ctx.fillStyle = theme.wallFar;
            ctx.fill();
            if (this.patterns.far) {
                ctx.fillStyle = this.patterns.far;
                ctx.fill();
            }
        } else if (item.shaded) {
            ctx.fillStyle = theme.wallFront;
            ctx.fill();
            if (this.patterns.front) {
                ctx.fillStyle = this.patterns.front;
                ctx.fill();
            }
        } else {
            ctx.fillStyle = theme.wallSide;
            ctx.fill();
        }

        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = avgV < 2.2 ? 1.8 : 1.2;
        ctx.stroke();
    }

    _drawEyeball(ctx, cx, cy, focal, cameraAngle, item, theme) {
        const sx = cx + (item.u / item.v) * focal;
        const radius = Math.max(4, (0.28 / item.v) * focal);
        const bob = Math.sin(performance.now() * 0.006 + (item.entity.seed || 0)) * (radius * 0.08);
        const sy = cy + bob;
        const ent = item.entity;

        ctx.save();

        // Ground shadow ellipse
        const shadowY = cy + (0.46 / item.v) * focal;
        ctx.fillStyle = theme.ditherInk;
        ctx.beginPath();
        ctx.ellipse(sx, shadowY, radius * 0.85, Math.max(2, radius * 0.22), 0, 0, Math.PI * 2);
        ctx.fill();

        // Main eyeball sclera
        ctx.fillStyle = this.themeKey === "classic" ? "#ffffff" : theme.bg;
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = Math.max(1.5, radius * 0.08);
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Bot antenna ears so humans vs bots are distinguishable in classic Mac style
        if (ent.isBot) {
            ctx.beginPath();
            ctx.moveTo(sx - radius * 0.65, sy - radius * 0.72);
            ctx.lineTo(sx - radius * 0.95, sy - radius * 1.15);
            ctx.moveTo(sx + radius * 0.65, sy - radius * 0.72);
            ctx.lineTo(sx + radius * 0.95, sy - radius * 1.15);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(sx - radius * 0.95, sy - radius * 1.15, Math.max(1.5, radius * 0.1), 0, Math.PI * 2);
            ctx.arc(sx + radius * 0.95, sy - radius * 1.15, Math.max(1.5, radius * 0.1), 0, Math.PI * 2);
            ctx.fillStyle = theme.ink;
            ctx.fill();
        }

        // Compute relative facing of opponent vs vector toward viewer!
        // Entity facing vector:
        const entAngle = ent.dir * (Math.PI / 2);
        const ex = Math.sin(entAngle);
        const ey = -Math.cos(entAngle);

        // Vector from entity toward camera in world space:
        const toCamX = -Math.sin(cameraAngle);
        const toCamY = Math.cos(cameraAngle);
        const facingViewer = ex * toCamX + ey * toCamY; // +1 = looking right at us, -1 = facing away

        // Sideways projection in camera space
        const camRightX = Math.cos(cameraAngle);
        const camRightY = Math.sin(cameraAngle);
        const sideDot = ex * camRightX + ey * camRightY;

        if (facingViewer > -0.2) {
            // Pupil visible on front hemisphere of the eyeball
            const offsetX = sideDot * radius * 0.55;
            const irisR = Math.max(2, radius * 0.42);
            const pupilR = Math.max(1.2, radius * 0.21);

            ctx.beginPath();
            ctx.ellipse(
                sx + offsetX,
                sy,
                irisR * Math.max(0.35, Math.sqrt(Math.max(0, 1 - sideDot * sideDot * 0.65))),
                irisR,
                0,
                0,
                Math.PI * 2
            );
            ctx.strokeStyle = theme.ink;
            ctx.lineWidth = Math.max(1, radius * 0.06);
            ctx.stroke();

            ctx.fillStyle = theme.ink;
            ctx.beginPath();
            ctx.ellipse(
                sx + offsetX,
                sy,
                pupilR * Math.max(0.35, Math.sqrt(Math.max(0, 1 - sideDot * sideDot * 0.65))),
                pupilR,
                0,
                0,
                Math.PI * 2
            );
            ctx.fill();

            // Classic Mac eye highlight glint
            if (radius >= 10) {
                ctx.fillStyle = this.themeKey === "classic" ? "#ffffff" : theme.bg;
                ctx.beginPath();
                ctx.arc(sx + offsetX - pupilR * 0.45, sy - pupilR * 0.45, Math.max(1, radius * 0.07), 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            // Back of eyeball (classic MazeWars optic nerve / hatching)
            ctx.strokeStyle = theme.ditherFar;
            ctx.lineWidth = Math.max(1, radius * 0.05);
            for (let a = -0.5; a <= 0.5; a += 0.5) {
                ctx.beginPath();
                ctx.moveTo(sx + a * radius * 0.7, sy - radius * 0.5);
                ctx.lineTo(sx + a * radius * 0.7, sy + radius * 0.5);
                ctx.stroke();
            }
        }

        // Nameplate above eyeball
        if (radius >= 8) {
            const label = String(ent.name || "").slice(0, 14);
            ctx.font = `bold ${Math.max(10, Math.min(13, Math.round(radius * 0.35)))}px 'Geneva', 'Courier New', monospace`;
            const tw = ctx.measureText(label).width;
            const tagY = sy - radius - 14;
            ctx.fillStyle = theme.bg;
            ctx.fillRect(sx - tw / 2 - 4, tagY - 10, tw + 8, 13);
            ctx.strokeStyle = theme.ink;
            ctx.lineWidth = 1;
            ctx.strokeRect(sx - tw / 2 - 4, tagY - 10, tw + 8, 13);
            ctx.fillStyle = theme.ink;
            ctx.textAlign = "center";
            ctx.fillText(label, sx, tagY);
        }

        ctx.restore();
    }

    _drawShot(ctx, cx, cy, focal, item, theme) {
        const sx = cx + (item.u / item.v) * focal;
        const r = Math.max(2.5, (0.11 / item.v) * focal);
        ctx.save();
        ctx.fillStyle = theme.bolt;
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.5;

        // Diamond star laser bolt
        ctx.beginPath();
        ctx.moveTo(sx, cy - r * 1.4);
        ctx.lineTo(sx + r * 0.9, cy);
        ctx.lineTo(sx, cy + r * 1.4);
        ctx.lineTo(sx - r * 0.9, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = theme.boltCore;
        ctx.beginPath();
        ctx.arc(sx, cy, Math.max(1, r * 0.35), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _drawReticle(ctx, cx, cy, effects, theme) {
        ctx.save();
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.5;
        const gap = 5;
        const len = 10;
        ctx.beginPath();
        ctx.moveTo(cx - gap - len, cy);
        ctx.lineTo(cx - gap, cy);
        ctx.moveTo(cx + gap, cy);
        ctx.lineTo(cx + gap + len, cy);
        ctx.moveTo(cx, cy - gap - len);
        ctx.lineTo(cx, cy - gap);
        ctx.moveTo(cx, cy + gap);
        ctx.lineTo(cx, cy + gap + len);
        ctx.stroke();

        if (effects.hitConfirm > 0) {
            ctx.beginPath();
            ctx.moveTo(cx - 12, cy - 12);
            ctx.lineTo(cx - 5, cy - 5);
            ctx.moveTo(cx + 12, cy - 12);
            ctx.lineTo(cx + 5, cy - 5);
            ctx.moveTo(cx - 12, cy + 12);
            ctx.lineTo(cx - 5, cy + 5);
            ctx.moveTo(cx + 12, cy + 12);
            ctx.lineTo(cx + 5, cy + 5);
            ctx.stroke();
        }
        ctx.restore();
    }

    renderMap(maze, player, entities, shots, showAllOnRadar = true) {
        const canvas = this.mapCanvas;
        const ctx = this.mapCtx;
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h) return;

        const theme = THEMES[this.themeKey];
        ctx.fillStyle = theme.mapBg;
        ctx.fillRect(0, 0, w, h);

        const cellW = w / maze.width;
        const cellH = h / maze.height;

        // Maze walls and teleporters
        for (let y = 0; y < maze.height; y++) {
            for (let x = 0; x < maze.width; x++) {
                const c = maze.cellAt(x, y);
                const px = x * cellW;
                const py = y * cellH;
                if (c === 1) {
                    ctx.fillStyle = theme.mapWall;
                    ctx.fillRect(px, py, Math.ceil(cellW), Math.ceil(cellH));
                } else {
                    ctx.strokeStyle = theme.mapGrid;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(px, py, cellW, cellH);
                    if (c === 2) {
                        ctx.strokeStyle = theme.mapTeleport;
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(px + cellW / 2, py + cellH / 2, Math.min(cellW, cellH) * 0.28, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                }
            }
        }

        // Shots on minimap
        ctx.fillStyle = theme.ink;
        for (const shot of shots) {
            ctx.beginPath();
            ctx.arc((shot.x + 0.5) * cellW, (shot.y + 0.5) * cellH, Math.max(2, cellW * 0.16), 0, Math.PI * 2);
            ctx.fill();
        }

        // Entities (classic MazeWars+ radar shows opponents in LOS or radar-pinged; toggleable)
        for (const ent of entities) {
            if (!ent.alive) continue;
            const visible = showAllOnRadar || maze.hasLineOfSight(player.x, player.y, Math.round(ent.x), Math.round(ent.y));
            if (!visible) continue;

            const ex = (ent.x + 0.5) * cellW;
            const ey = (ent.y + 0.5) * cellH;
            const r = Math.max(3, Math.min(cellW, cellH) * 0.3);

            ctx.fillStyle = theme.mapEnemy;
            ctx.beginPath();
            ctx.arc(ex, ey, r, 0, Math.PI * 2);
            ctx.fill();

            // Facing tick
            const vec = DIR_VECTORS[ent.dir] || DIR_VECTORS[0];
            ctx.strokeStyle = theme.mapBg;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex + vec.dx * r, ey + vec.dy * r);
            ctx.stroke();
        }

        // Local player arrow
        const px = (player.x + 0.5) * cellW;
        const py = (player.y + 0.5) * cellH;
        const r = Math.max(4, Math.min(cellW, cellH) * 0.38);
        const angle = player.dir * (Math.PI / 2);

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.fillStyle = theme.mapPlayer;
        ctx.strokeStyle = theme.mapBg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.78, r * 0.85);
        ctx.lineTo(0, r * 0.42);
        ctx.lineTo(-r * 0.78, r * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}
