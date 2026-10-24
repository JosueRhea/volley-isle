# Volley Isle 🏐🏝️

Online 2v2 cartoon volleyball on a cel-shaded island, built with Three.js and a Node WebSocket server.

## Run locally

```bash
npm install
npm run dev        # server on :3000 + Vite on http://localhost:5173
```

Open http://localhost:5173 in two browser windows to play against yourself. Empty slots are filled with CPU players.

## The cast

Pick your critter in the lobby. Each one has its own look; the gameplay stats are the same for everyone (for now).

| | |
| --- | --- |
| **Bongo** the Frog | Huge hops. Bigger grin. |
| **Pinchy** the Crab | Sideways? Never. Spikes? Always. |
| **Pip** the Puffin | Tiny wings, perfect sets. |
| **Tiki** the Coconut | Hard head. Soft touch. |
| **Mochi** the Axolotl | Always smiling, always diving. |
| **Rocco** the Volcano | Hot-headed. Rock-solid defense. |

Teams are **Lagoon** (blue) and **Sunset** (orange). You can tell them apart by sneakers, wristbands and the ring under each player. To add a critter, add a builder to `client/scene/species.js` and its name to `CHARACTERS` in `shared/constants.js`.

## Tutorial

New players can hit **🎓 Tutorial** on the title screen, which is highlighted until you've finished it once. It runs on a private practice court with your teammate at the net and no opponents, and nothing is scored. A coach walks you through running, jumping, passing, spiking, tipping, diving and serving. Each step only moves on once you've actually done it. If you miss, the coach tells you what went wrong and feeds you another ball. At the end, **Play a match!** drops you straight into Quick Play.

## Playing

Create a room (or Quick Play) and you land in the **warm-up**. Pick your side with the team cards, knock the ball around, and the **host** (♛) presses **Start match**. The host can also turn CPU fill on or off. With it off, empty spots stay empty, so 1v1 and 1v2 are possible. After a match everyone returns to warm-up for a rematch.

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move (forward = toward the net) | WASD / arrows | Left stick | Floating stick (left thumb) |
| Jump | Space / right-click | A | A |
| Hit (also auto-dives) | J / left-click | X | X |
| Tip (in the air) | K / Shift | B | B |
| Music on/off | M or the 🎵 button | | 🎵 button |

**Serving is a timing mini-game.** Press **Hit** once and a power meter starts sweeping. Press it again to lock the power:
- **Weak (red, left):** the serve dies on your own side.
- **Green:** a solid serve. More power lands deeper.
- **★ Perfect (gold):** a deep, flat serve that's hard to return.
- **Long (red, right):** sails past their baseline, out.

Steer with **left/right** to aim the serve sideways. The CPU uses the same meter, so it botches a serve now and then too.

When you hit the ball:
- **1st touch:** passes up to the net in front of your teammate.
- **2nd touch:** sets them up high for the spike.
- **3rd touch:** always goes over.
- **Holding forward** (toward the net) sends it straight over on any touch.
- **In the air:** spikes it.
- **Tip** (in the air) is a soft touch just over the net. It's slow enough to float over blockers' hands, so it catches a team that jumped to block with its back players deep.
- **Auto-dive:** if the ball is just out of reach, too far to run to but close enough to save, **Hit dives for it automatically** and pops it back up for your team ("SAVE!").
- **Blocking** happens automatically when you're in the air right at the net as a hard ball comes across. You either stuff it straight back down or get fingertips on it and pop it up for your team.
- **The net is a springy cloth.** A ball that hits the mesh sinks in and bounces back out, so it can be played off the net. A ball that clips the top tape trickles over ("net cord!").

A floating button prompt above your head shows what your next press will do: *Pass!*, *Set!*, *Over!*, *SPIKE! / Tip*, *Jump!* or *Dive!*. Your ring glows when the ball is in reach. A miss tells you whether you were *Too early!*, *Too late!* or *Too far!*. You get 3 touches per side.

## Menus & settings

Press **Esc** (or the ☰ button) in a game for the menu: Resume, Settings, How to play, Copy invite, and **Leave game** (tap twice to confirm). The match keeps running online while the menu is open; only your own controls pause. When you leave, your spot goes back to a CPU, and the host role passes to the next player.

Settings are also on the title screen and are saved in the browser:
- **Sound:** master, music and effects volume.
- **Gameplay:** button prompts.
- **Graphics:** quality High / Medium / Low. Lower quality reduces resolution, and Low also turns off shadows.

## Match formats

- **Quick Play:** always a **3-minute timed match**.
- **Private rooms:** the host picks in the warm-up card. Options are **⏱ 2 / 3 / 5 minutes** or **🏐 first to 7 / 11 / 15** (win by 2). The default is 3 minutes.
- **Timed matches:**
  - The clock only runs while the ball is being served or is in play. It stops for point celebrations and slows down with slow-mo.
  - At 0:00 a live rally gets to finish ("Last rally!").
  - A tie goes to **sudden death**: the next point wins.
  - The scoreboard shows the countdown, which turns red for the last 10 seconds.

## Fair play & abuse protection

The server is in charge, and both hosts share the same rules (`server/room.js`, `server/session.js`, `server/names.js`):

- **AFK:** after 4½ minutes without moving or pressing anything, you get a 30-second warning. At 5 minutes you're sent back to the title screen, and the room closes once it's empty.
- **Movement checks:** clients report their own position for responsiveness, but the server only accepts moves that fit the max run, jump and dive speed. Teleports and super-jumps get clamped, and the client is snapped back.
- **Serve meter:** timed by the server, from the press that starts the needle to the press that stops it. The client can't choose its own serve power.
- **Message flooding:** every connection gets a message budget (about 60/s, bursts allowed). Anyone who keeps flooding is disconnected.
- **Room spam and code guessing:** 30 room creates/joins per minute per IP, using Cloudflare's Rate Limiting binding (or an in-memory limiter on the Node host).
- **Bots and scripts:** only real browsers can join.
  - **Turnstile:** before getting a room, the browser passes Cloudflare Turnstile (action `join`; usually invisible, sometimes a checkbox). The server checks the token with siteverify: it must be valid, single-use, for action `join`, and from an allowed hostname.
  - **Join tickets:** the server then issues the room code plus a **signed join ticket** (HMAC, valid 60 s). Rooms refuse any connection without a valid ticket for that exact room, or one that doesn't come from the game's own pages (Origin check).
- **"Too perfect" detection:** the server times how fast each player changes direction after the other team hits. People need ~200 ms or more, while a script reading the game state reacts almost instantly. A player whose median reaction is under 120 ms (over 12+ reactions made from a steady state) is removed, and the removal is logged.
- **Names:** invisible and trick characters are stripped. Names containing common English or Spanish profanity become "Player". It's a simple word list, so expect the occasional false positive (e.g. "Dick Grayson").

## Languages

The game is in **English** and **Español**. It picks Spanish automatically if your browser is set to Spanish. Switch any time with the **EN | ES** toggle on the title card or in ⚙ Settings → Language. The switch is instant, even mid-match. All text lives in `client/i18n.js`. To add a language, add another dictionary there with the same keys and a button in the language switchers.

## Architecture

- `shared/`: physics and constants, used by both the server and the client so the client's predictions match the server.
- `server/`: the authoritative game loop (60 Hz tick, 30 Hz snapshots), rooms with 4-letter codes, quick-play matchmaking, and CPU bots.
- `client/`: Three.js toon rendering (gradient-mapped toon materials with inverted-hull outlines), procedural characters and island, plus the HUD and lobby.

The coconut palms and scalloped umbrellas load Blender-authored GLBs from `client/assets/models/`, with toon materials, shared geometry, and the original procedural props as loading/error fallbacks. Umbrellas retain their four scene color schemes; palms retain whole-tree sway. Edit `assets/blender/island-props.blend`, or rebuild both exports by running `assets/blender/build_island_props.py` inside Blender (with `__file__` set to the script path). The generator creates its own scene, preserves unrelated scenes, and exports Y-up GLBs with ground-level origins. The palm is about 7 m tall (4,804 triangles); the umbrella is about 3 m tall (3,516 triangles).

All six playable mascots also load Blender models, along with an 18-panel volleyball, padded net standards, and the SUN SIP snack hut. Their editable source is `assets/blender/gameplay-cast.blend`; `assets/blender/build_gameplay_assets.py` rebuilds the nine exports. Character assets are about 150–180 KB each and under 11,000 triangles. They use articulated mesh pivots identified by glTF `extras.role`, rather than skinned armatures or baked animation clips. `character-rig.js` drives two-segment arms and legs from the existing gameplay targets, keeps grounded shoes level, and animates brows, mouths, tails, gills, leaves, and smoke. The runtime adds toon shading, outlines, and per-instance team colors. Geometry is shared across instances; failed loads retain the procedural characters. The net cloth retains its spring simulation, and collision dimensions and server timing are unchanged.

For animation review, run `npm run dev` and open **http://localhost:5173/animation-lab.html**. This development-only page shows all six characters in 12 action previews, with playback speed, pause, and phase scrubbing. The gameplay animation remains driven by live movement and hit events; the studio supplies sample states to the same driver. Run `npm test` for IK edge cases and the exported rig/asset-size contracts, and `npm run build` to verify the game bundle.

The sand uses shared procedural grain and ripple textures, with a smoother court center. Running leaves alternating sneaker impressions, jump landings leave paired prints, dives carve short trails, and grounded point-ending balls leave impact marks. Tracks fade gradually and clear when joining a room. `client/scene/env/sand.js` keeps them in a fixed 1280×800 canvas overlay (one draw call, uploads capped at 10 Hz), below court lines and landing indicators. These are visual surface details; the playing surface and physics remain flat.

Each client controls its own player's movement so it feels instant. The server clamps positions and has the final say on the ball, hits, and scoring. The client extrapolates the ball forward by about half the round-trip time so it doesn't appear late.

## Deploy

**Production runs on Cloudflare Workers + Durable Objects:** https://volley.makesuretheyfarrive.com (Custom Domain; the original https://volley-isle.searchmateapp.workers.dev still works too).

To add another domain, add it to `routes`, `TURNSTILE_HOSTNAMES` and `ALLOWED_ORIGINS` in `wrangler.jsonc`, and to the Turnstile widget's domain list.

```bash
npm run cf:dev     # build + run the Worker and Durable Objects locally (wrangler dev, http://localhost:8787)
npm run deploy     # build + deploy to Cloudflare (wrangler deploy)
```

**Automatic deploys:** every push to `main` (including merged PRs) deploys via `.github/workflows/deploy.yml`, and it can be re-run by hand from the Actions tab. It needs the repository secret `CLOUDFLARE_API_TOKEN` (a Cloudflare token from the "Edit Cloudflare Workers" template) and the repository variable `CLOUDFLARE_ACCOUNT_ID`.

**Secrets:** the Worker needs `TURNSTILE_SECRET` and `TICKET_SECRET`, set with `wrangler secret put` and never committed. For `npm run cf:dev`, the git-ignored `.dev.vars` provides Cloudflare's Turnstile test keys, the localhost hostnames and origins, and a local ticket key. The plain Node host (`npm run dev`) runs without Turnstile unless `TURNSTILE_SECRET` is set; origin checks and join tickets are always on.

How it fits together (`worker/index.js`, `wrangler.jsonc`):
- **Worker:** serves the built client from `dist/` and routes the API.
- **`RoomObject` Durable Object:** one per room, addressed by its 4-letter code. The room is created near its first player. It holds the match in memory, runs the 60 Hz simulation while anyone is connected, and shuts down when the last player leaves.
- **`Matchmaker` Durable Object:** a single directory of public rooms with open spots, used by Quick Play.
- **Client flow:** the client gets a Turnstile token and `POST`s it to `/api/join`, which returns a room code + signed ticket. It then connects to `/ws/<CODE>?mode=quick|create|tutorial|code&ticket=…`.

The game rules live in `server/room.js`, `server/bot.js` and `shared/`, and the connection protocol in `server/session.js`. Both hosts share them: the Cloudflare Worker, and the Node server (`server/index.js`) used by `npm run dev` and the Dockerfile. The Docker image still works as a single-server fallback on any container host:

```bash
npm run build && npm start   # Node host on $PORT (default 3000)
docker build -t volley-isle . && docker run -p 3000:3000 volley-isle
```

### Bleachers and spectators

Six three-tier wooden stands seat 72 instanced spectators outside the sidelines. Fans track the ball, gasp at spikes, applaud digs and blocks, and celebrate points in a staggered wave; opposing fans slump and the match winners get a longer celebration. The Blender source is `assets/blender/build_bleachers.py` / `wooden-bleachers.blend`, exported to `client/assets/models/wooden-bleachers.glb`. Crowd poses and event reactions live in `client/scene/env/crowd.js`. The crowd you hear is synthesized in `client/crowd-audio.js`: ensembles of individual formant-shaped voices and per-clapper applause are rendered once in the background, then mixed under the music as a chatter bed, a roar that builds with the rally, and reactions to every touch, net ball and point.

### Beach tournament kit

`assets/blender/build_tournament.py` rebuilds seven editable GLBs and the `tournament-kit.blend` source: the referee stand (with two arm pivots), scoreboard frame, golden coconut trophy, cooler, towel/sandals, surfboard, and duffel bag. Static mesh pieces are merged into material batches. The trophy preserves its metallic gold material.

`client/scene/env/tournament.js` adds the props to the island. Score snapshots drive the hinged number cards and keep them correct after reconnects; point events drive the referee's left/right signal. The winning side gets a trophy reveal during the `over` phase, cleared for the next match. Beach accessories stay outside the court. These are scenery only and do not change gameplay collision.

The animation studio's **Cheer** preview shows each character's celebration: Bongo's chest drums, Pinchy's claw dance, Pip's wing flaps, Tiki's hula, Mochi's soft bounces, and Rocco's fist pumps. The existing Blender face pivots now support laughs, effort expressions, and airborne gasps; landing squash varies with impact and character softness.

Pip now has a separate `LowerBeak` pivot, authored in `build_gameplay_assets.py` and saved in `assets/blender/pip-face.blend`; it opens for cheers and jumps.

### Island motion and impact polish

The ball briefly squashes on contacts without changing its physics radius. Hard landings throw a low radial sand burst, and the net has a broader, capped impulse. Twelve crowd members carry animated flags, foam fingers, drums, or signs. `env/breeze.js` deforms the loaded palm fronds, umbrella/referee canopy edges, and towel corners on the GPU, using the same deformation for shadows; rigid poles, sandals, and the referee remain still. Warm directional light, wider shadow filtering, rough sand lighting, and a restrained ocean glint complete the local visual pass.
