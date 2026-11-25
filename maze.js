// Classic 16x16 MazeWars+ deterministic maps.
// Legend: '#' = wall, '.' = open corridor, 'T' = teleporter pad.

export const DIR = Object.freeze({
    NORTH: 0,
    EAST: 1,
    SOUTH: 2,
    WEST: 3
});

export const DIR_VECTORS = Object.freeze([
    { dx: 0, dy: -1, name: "N" }, // NORTH
    { dx: 1, dy: 0, name: "E" },  // EAST
    { dx: 0, dy: 1, name: "S" },  // SOUTH
    { dx: -1, dy: 0, name: "W" }  // WEST
]);

const RAW_MAPS = {
    classic: {
        id: "classic",
        name: "Classic Maze",
        rows: [
            "################",
            "#...#......#..T#",
            "#.#.#.####.#.#.#",
            "#.#...#..#...#.#",
            "#.###.#.##.###.#",
            "#.....#........#",
            "###.###.####.###",
            "#...#...#..#...#",
            "#.#.#.###..###.#",
            "#.#............#",
            "#.###.##.##.####",
            "#..T..#...#....#",
            "#.###.#.#.#.##.#",
            "#.#...#.#...#..#",
            "#...#.....#....#",
            "################"
        ]
    },
    arena: {
        id: "arena",
        name: "Central Arena",
        rows: [
            "################",
            "#T....#..#....T#",
            "#.###.#..#.###.#",
            "#.#..........#.#",
            "#.#.##.##.##.#.#",
            "#...#......#...#",
            "###.#.####.#.###",
            "#.....#..#.....#",
            "#.#.#......#.#.#",
            "###.#.####.#.###",
            "#...#......#...#",
            "#.#.##.##.##.#.#",
            "#.#..........#.#",
            "#.###.#..#.###.#",
            "#.....#..#.....#",
            "################"
        ]
    },
    catacombs: {
        id: "catacombs",
        name: "Catacombs",
        rows: [
            "################",
            "#.....#....#...#",
            "#.###.#.##.#.#.#",
            "#.#T..#..#...#.#",
            "#.#.####.###.#.#",
            "#........#.....#",
            "###.##.###.###.#",
            "#...#......#...#",
            "#.#.###.##.#.#.#",
            "#.#.....#..#.#.#",
            "#.#####.#.##.###",
            "#.....#.#....T.#",
            "#.###.#.######.#",
            "#.#...#........#",
            "#...#....#.....#",
            "################"
        ]
    }
};

export const MAP_LIST = Object.freeze(
    Object.values(RAW_MAPS).map(({ id, name }) => ({ id, name }))
);

export function createMaze(mapId = "classic") {
    const def = RAW_MAPS[mapId] || RAW_MAPS.classic;
    const height = def.rows.length;
    const width = def.rows[0].length;
    const cells = new Uint8Array(width * height);
    const openCells = [];
    const teleporters = [];

    for (let y = 0; y < height; y++) {
        const row = def.rows[y];
        for (let x = 0; x < width; x++) {
            const ch = row[x];
            let val = 0;
            if (ch === "#") val = 1;
            else if (ch === "T") val = 2;
            cells[y * width + x] = val;
            if (val !== 1) {
                openCells.push({ x, y });
                if (val === 2) teleporters.push({ x, y });
            }
        }
    }

    function inBounds(x, y) {
        return x >= 0 && y >= 0 && x < width && y < height;
    }

    function cellAt(x, y) {
        if (!inBounds(x, y)) return 1;
        return cells[y * width + x];
    }

    function isWall(x, y) {
        return cellAt(x, y) === 1;
    }

    function isTeleporter(x, y) {
        return cellAt(x, y) === 2;
    }

    function pickSpawn(avoidList = []) {
        if (openCells.length === 0) return { x: 1, y: 1, dir: DIR.EAST };
        let best = null;
        let bestScore = -1;
        // Sample up to 24 candidates to pick a cell far from opponents
        const count = Math.min(24, openCells.length);
        for (let i = 0; i < count; i++) {
            const candidate = openCells[Math.floor(Math.random() * openCells.length)];
            if (isTeleporter(candidate.x, candidate.y)) continue;
            let minDist = Infinity;
            for (const other of avoidList) {
                const d = Math.abs(other.x - candidate.x) + Math.abs(other.y - candidate.y);
                if (d < minDist) minDist = d;
            }
            if (avoidList.length === 0) minDist = 10;
            if (minDist > bestScore) {
                bestScore = minDist;
                best = candidate;
            }
        }
        const chosen = best || openCells[0];
        // Face an open direction
        const openDirs = [];
        for (let d = 0; d < 4; d++) {
            const vec = DIR_VECTORS[d];
            if (!isWall(chosen.x + vec.dx, chosen.y + vec.dy)) {
                openDirs.push(d);
            }
        }
        const dir = openDirs.length
            ? openDirs[Math.floor(Math.random() * openDirs.length)]
            : DIR.EAST;
        return { x: chosen.x, y: chosen.y, dir };
    }

    function otherTeleporter(x, y) {
        const others = teleporters.filter((tp) => tp.x !== x || tp.y !== y);
        if (others.length === 0) return null;
        return others[Math.floor(Math.random() * others.length)];
    }

    function hasLineOfSight(x1, y1, x2, y2) {
        if (x1 === x2 && y1 === y2) return true;
        if (x1 === x2) {
            const step = y2 > y1 ? 1 : -1;
            for (let y = y1 + step; y !== y2; y += step) {
                if (isWall(x1, y)) return false;
            }
            return true;
        }
        if (y1 === y2) {
            const step = x2 > x1 ? 1 : -1;
            for (let x = x1 + step; x !== x2; x += step) {
                if (isWall(x, y1)) return false;
            }
            return true;
        }
        return false;
    }

    return {
        id: def.id,
        name: def.name,
        width,
        height,
        teleporters,
        inBounds,
        cellAt,
        isWall,
        isTeleporter,
        pickSpawn,
        otherTeleporter,
        hasLineOfSight
    };
}
