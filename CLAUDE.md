# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start dev server (http://localhost:5173)
npm run build      # type-check + production build (output: dist/)
npm run lint       # ESLint
npm run lint:fix   # ESLint with auto-fix
npm run format     # Prettier over src/**
npm run preview    # serve the production build locally
```

## Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript (Vite 5) |
| Routing | React Router v7 (`BrowserRouter` in `main.tsx`) |
| Styling | Tailwind CSS v3 |
| Linting | ESLint 9 (flat config) + typescript-eslint |
| Formatting | Prettier (config: `.prettierrc`) |
| MQTT | mqtt.js v5 (WebSocket only in browser) |

## Architecture

- **Entry point:** `src/main.tsx` — mounts `<BrowserRouter>` around `<App />`
- **Routes:** declared in `src/App.tsx`; `/` redirects to `/lidar`; add new pages as `<Route>` elements here
- **Styling:** Tailwind directives are in `src/index.css`; use utility classes directly (no global CSS)
- **ESLint config:** `eslint.config.js` flat-config; Prettier injected via `eslint-plugin-prettier`

## Pages

### `/lidar` — URG LiDAR 即時視覺化 (`src/pages/LidarPage.tsx`)

Subscribes to MQTT topic `Urg/DetectData/Right` and renders detected obstacle positions on an HTML5 Canvas in real time.

**MQTT hook:** `src/hooks/useMqtt.ts` — wraps mqtt.js, manages connect/disconnect lifecycle.

**Data contract:** the topic publishes a JSON array of `{X: number, Y: number}` objects (coordinates in **metres**, Y-up). Example: `[{"X":-0.14,"Y":-0.003},{"X":0.5,"Y":1.2}]`

**Broker:** Default `ws://192.168.1.154:9001`. The broker must have WebSocket enabled (Mosquitto: `listener 9001` + `protocol websockets`). Port 1883 (TCP) cannot be used directly from a browser.

**Canvas interaction:** mouse wheel to zoom; origin marker (orange cross) at `(0, 0)`; grid rings every 1 m.
