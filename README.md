# MazeWars+ WebWidget

A classic Macintosh **Maze Wars+** style first-person 3D maze shooter for the Kilroy WebWidget runtime.

## Features
- **Classic 1-bit Macintosh 3D Perspective View**: Crisp vector wall rendering with dithered depth shading, teleporter pads, and floating Eyeball opponents whose pupils track which direction they are facing.
- **2-D Radar Automap**: Overhead 16×16 maze display with toggleable visibility (`All` vs `LOS` line-of-sight only).
- **Corner Peeking**: Hold `Z` or `C` (or on-screen `Peek L` / `Peek R`) to lean into an adjacent corridor and scout around corners.
- **Multiplayer over Kilroy Swarm**: Real-time position, shot, hit, death, and scoreboard synchronization over `/ww.mazewars.*` messages.
- **AI Eyeball Bots & Solo Mode**: Play immediately against 0–4 local AI bots, even offline or alongside human peers.
- **Display Themes & Retro Audio**: Switch between *Classic Mac*, *Phosphor Green*, and *Amber CRT* themes with synthesized Web Audio sound effects.

## Controls

| Input | Action |
|---|---|
| `W` / `↑` | Move forward |
| `S` / `↓` | Move backward |
| `A` / `←` | Turn left 90° |
| `D` / `→` | Turn right 90° |
| `Q` / `E` | Strafe left / right |
| `Z` / `C` (hold) | Peek left / right around corner |
| `Space` / `F` / Click | Fire laser bolt |
| `R` | Toggle Radar (`All` / `LOS`) |
| `M` | Mute / unmute sound |
| `Esc` | Leave to lobby |

## Kilroy Integration
- URL bootstrap: `/kilroypublic/webwidgets/mazewars/index.html?{{bootstrap_args}}`
- Subscribes with anchored filter `^/ww\\.mazewars\\.(state|shot|hit|death|leave) `
- Persists player preferences and best score via `sdk.setKV("mazewars_prefs", ...)` / `sdk.getKV(...)`.
