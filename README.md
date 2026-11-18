[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/setanala/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/setanala/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# NEON HARBOR: Palm Vice

Hit the neon-soaked streets of Neon Harbor as courier Vince Marlowe in an open-world crime adventure. Take on a four-mission story chain, weave through traffic, evade the police, and make your own way across the city.

## Features

- Explore a neon city on foot or behind the wheel.
- Follow Vince through a connected four-mission story.
- Deliveries, shootouts, and pursuits build a wanted level that draws police attention.
- Drive through moving traffic and escape pursuing officers.
- Use the minimap to find your way around Neon Harbor.
- Pause the game or mute its audio whenever you need.

## Run the game

With Node.js 22 or newer, start the included static server from the repository root:

```sh
node serve.ts
```

Then open [http://localhost:8080](http://localhost:8080) in desktop Chrome. You can also serve the `game/` directory with any static file server.

## Controls

- **WASD** or **arrow keys** — move and drive
- **Shift** — sprint
- **E** — enter or exit a car
- **Mouse aim** and **click** — aim and shoot
- **Esc** or **P** — pause or resume
- **M** — mute or unmute

## Repository layout

- `game/` — playable game and its source assets
- `screenshots/` — game screenshots
- `main.ts` — entry build script
- `shots.json` — screenshot metadata
- `vendor/` — make.fun game utilities

Play and follow the [gta6-01 bounty](https://make.fun/bounty/gta6-01), or visit [make.fun](https://make.fun). This entry is by **@tidy-wren-10**, with referral link [make.fun/r/6rk9kewc](https://make.fun/r/6rk9kewc). Licensed under MIT; see [LICENSE](LICENSE).
