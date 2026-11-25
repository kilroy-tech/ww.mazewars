import { DIR_VECTORS } from "./maze.js";

const BOT_NAMES = ["Eyebot", "MacDroid", "Pixel", "Vector"];

export class BotManager {
    constructor() {
        this.bots = [];
        this.targetCount = 2;
    }

    setCount(count, maze, avoidList) {
        const clamped = Math.max(0, Math.min(4, count));
        this.targetCount = clamped;
        while (this.bots.length < clamped) {
            const idx = this.bots.length;
            const spawn = maze.pickSpawn(avoidList.concat(this.bots));
            this.bots.push({
                id: `bot_${idx}`,
                name: `${BOT_NAMES[idx % BOT_NAMES.length]}`,
                isBot: true,
                x: spawn.x,
                y: spawn.y,
                renderX: spawn.x,
                renderY: spawn.y,
                dir: spawn.dir,
                alive: true,
                kills: 0,
                deaths: 0,
                seed: idx * 1.7 + 0.5,
                moveTimer: 0.25 + idx * 0.15,
                fireCooldown: 0.9 + idx * 0.2,
                respawnTimer: 0
            });
        }
        if (this.bots.length > clamped) {
            this.bots.length = clamped;
        }
    }

    reset(maze, avoidList) {
        const count = this.targetCount;
        this.bots = [];
        this.setCount(count, maze, avoidList);
    }

    update(dt, maze, player, onBotFire) {
        for (const bot of this.bots) {
            // Smooth visual interpolation toward grid cell
            bot.renderX += (bot.x - bot.renderX) * Math.min(1, dt * 14);
            bot.renderY += (bot.y - bot.renderY) * Math.min(1, dt * 14);

            if (!bot.alive) {
                bot.respawnTimer -= dt;
                if (bot.respawnTimer <= 0) {
                    const spawn = maze.pickSpawn([player, ...this.bots]);
                    bot.x = spawn.x;
                    bot.y = spawn.y;
                    bot.renderX = spawn.x;
                    bot.renderY = spawn.y;
                    bot.dir = spawn.dir;
                    bot.alive = true;
                    bot.fireCooldown = 1.0;
                    bot.moveTimer = 0.4;
                }
                continue;
            }

            bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
            bot.moveTimer -= dt;
            if (bot.moveTimer > 0) continue;

            // Check if player is visible along any cardinal line of sight
            let sawPlayerDir = -1;
            if (player.alive && maze.hasLineOfSight(bot.x, bot.y, player.x, player.y)) {
                if (player.x === bot.x) {
                    sawPlayerDir = player.y < bot.y ? 0 : 2;
                } else if (player.y === bot.y) {
                    sawPlayerDir = player.x > bot.x ? 1 : 3;
                }
            }

            if (sawPlayerDir !== -1) {
                if (bot.dir !== sawPlayerDir) {
                    bot.dir = sawPlayerDir;
                    bot.moveTimer = 0.34;
                    continue;
                }
                if (bot.fireCooldown <= 0) {
                    onBotFire(bot);
                    bot.fireCooldown = 1.15;
                    bot.moveTimer = 0.38;
                    continue;
                }
            }

            // Patrol maze: prefer continuing straight or turning at junctions, avoid immediate 180 unless dead-end
            const vec = DIR_VECTORS[bot.dir];
            const aheadOpen = !maze.isWall(bot.x + vec.dx, bot.y + vec.dy);
            const leftDir = (bot.dir + 3) % 4;
            const rightDir = (bot.dir + 1) % 4;
            const backDir = (bot.dir + 2) % 4;

            const leftOpen = !maze.isWall(bot.x + DIR_VECTORS[leftDir].dx, bot.y + DIR_VECTORS[leftDir].dy);
            const rightOpen = !maze.isWall(bot.x + DIR_VECTORS[rightDir].dx, bot.y + DIR_VECTORS[rightDir].dy);

            const choices = [];
            if (aheadOpen) choices.push({ type: "step", dir: bot.dir, weight: 4 });
            if (leftOpen) choices.push({ type: "turn", dir: leftDir, weight: aheadOpen ? 1.5 : 3 });
            if (rightOpen) choices.push({ type: "turn", dir: rightDir, weight: aheadOpen ? 1.5 : 3 });

            if (choices.length === 0) {
                bot.dir = backDir;
                bot.moveTimer = 0.35;
                continue;
            }

            const total = choices.reduce((s, c) => s + c.weight, 0);
            let roll = Math.random() * total;
            let pick = choices[0];
            for (const c of choices) {
                roll -= c.weight;
                if (roll <= 0) {
                    pick = c;
                    break;
                }
            }

            if (pick.type === "step") {
                const nv = DIR_VECTORS[bot.dir];
                bot.x += nv.dx;
                bot.y += nv.dy;
                if (maze.isTeleporter(bot.x, bot.y)) {
                    const dest = maze.otherTeleporter(bot.x, bot.y);
                    if (dest) {
                        bot.x = dest.x;
                        bot.y = dest.y;
                        bot.renderX = dest.x;
                        bot.renderY = dest.y;
                    }
                }
            } else {
                bot.dir = pick.dir;
            }
            bot.moveTimer = 0.32 + Math.random() * 0.16;
        }
    }
}
