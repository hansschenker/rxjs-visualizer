# RxJS Operator Behavior Visualizer

An interactive, real-time visualizer for RxJS operator behaviors, built with pure TypeScript and an Elm-like Model-View-Update (MVU) architecture. 

This tool renders a DOM-based coordinate system to animate how values flow through an RxJS pipeline, making it easy to observe time-shifting operators and complex reactive state mechanics (like diamond dependency glitches).

## Features
* **Real-Time MVU Loop:** Uses a reactive state loop to manage DOM updates cleanly and predictably.
* **Animated Timelines:** Smooth CSS transitions map RxJS emissions to an X-axis (time) and Y-axis (operator lanes).
* **Trackable Domain Operators:** Wraps standard RxJS operators to isolate and visualize their behavior.

## Setup
```bash
npm install
npm run dev