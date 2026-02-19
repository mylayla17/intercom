# StandupMesh

> **Decentralized P2P Daily Standup Bot — No server. No account. Just your team.**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Built for](https://img.shields.io/badge/Built%20for-Intercom%20Vibe%20Competition-orange)](https://github.com/Trac-Systems/intercom)
[![Termux Ready](https://img.shields.io/badge/Termux-Ready-brightgreen)](https://termux.dev)

---

## What is StandupMesh?

**StandupMesh** is an Intercom Vibe Competition submission that turns any terminal — including your Android phone via Termux — into a decentralized daily standup participant.

Instead of paying for Slack, Jira, or any SaaS standup tool, your team members each run `node index.js`, get connected via **Hyperswarm P2P**, and share their daily updates directly peer-to-peer. The aggregated summary appears live in every terminal on the mesh.

**Zero servers. Zero accounts. Zero cost.**

---

## Features

- **📋 Guided standup input** — prompts for yesterday / today / blocker
- **🔴 Real-time P2P broadcast** — updates appear instantly on all peers
- **📊 Live team summary** — aggregated view with blocker highlighting
- **💾 Export to file** — save summaries to `standup.log` for records
- **⏰ Daily reminder** — built-in scheduler reminds you at a set time
- **👁 Listen-only mode** — observe the mesh without submitting
- **🎨 Colorized terminal UI** — works in Termux and standard terminals
- **🔑 Custom topic keys** — create private team channels with `--topic`
- **📱 Termux-native** — lightweight, no native add-ons needed

---

## Architecture

```
┌──────────────┐     Hyperswarm P2P      ┌──────────────┐
│  Alice       │◄───────────────────────►│  Bob         │
│  Termux/Android│    (no server)        │  Desktop     │
│  node index.js│                        │  node index.js│
└──────────────┘                         └──────────────┘
        │                                       │
        └───────────────────────────────────────┘
                    ┌──────────────┐
                    │  Charlie     │
                    │  Laptop      │
                    │  node index.js│
                    └──────────────┘
```

All peers connect via the same **Hyperswarm topic key** (a 32-byte hash). There is no relay server, no cloud, no persistent storage — messages live only in RAM for the session duration.

---

## Installation

### Desktop / Linux / macOS

```bash
# Requires Node.js >= 18
git clone https://github.com/mylayla17/standupmesh
cd standupmesh
npm install
node index.js --name "YourName"
```

### Android (Termux) — Step by Step

```bash
# 1. Install Termux from F-Droid (NOT Google Play — outdated)
#    https://f-droid.org/packages/com.termux/

# 2. Update package lists
pkg update && pkg upgrade -y

# 3. Install Node.js and git
pkg install nodejs git -y

# 4. Clone StandupMesh
git clone https://github.com/[YOUR_GITHUB_USERNAME]/standupmesh
cd standupmesh

# 5. Install dependencies
npm install

# 6. Run!
node index.js --name "Alice"
```

> **Note:** On first run, Hyperswarm will attempt UDP hole-punching. This works on most mobile networks. If your network blocks UDP, try a different WiFi or mobile data connection.

---

## Usage

### Basic — interactive mode (broadcast + listen)

```bash
node index.js --name "Alice"
```

### Listen-only — just observe the team's updates

```bash
node index.js --mode listen
```

### Join a private team channel

```bash
# Person A: share the topic key from /topic command
node index.js --name "Alice"
# In prompt: /topic  →  copy the 64-char hex key

# Person B: join using that key
node index.js --name "Bob" --topic <64-char-hex-key>
```

### Set a daily reminder

```bash
node index.js --name "Alice" --reminder 09:00
```

### Auto-export summaries

```bash
node index.js --name "Alice" --export
```

---

## Commands Reference

| Command | What it does |
|---|---|
| `/standup` | Guided 3-step standup input |
| `/summary` | Print today's full team summary |
| `/peers` | Show active peer count |
| `/export` | Export summary to `standup.log` |
| `/topic` | Display & copy the topic key |
| `/clear` | Clear screen |
| `/help` | Show all commands |
| `/quit` | Exit cleanly |

---

## CLI Flags Reference

| Flag | Example | Description |
|---|---|---|
| `--name` | `--name "Alice"` | Your display name |
| `--mode` | `--mode listen` | `interactive` (default) or `listen` |
| `--topic` | `--topic abc123…` | 64-char hex key for private team |
| `--reminder` | `--reminder 09:30` | Daily reminder time (24h HH:MM) |
| `--export` | `--export` | Auto-save summaries to `standup.log` |

---

## How It Works (Technical)

1. On startup, StandupMesh hashes a fixed seed string using `hypercore-crypto` to derive a 32-byte **topic key**.
2. It joins this topic on **Hyperswarm**, advertising itself as both a server and client.
3. When peers connect, they exchange **ping** messages to announce their display name.
4. When a user submits `/standup`, StandupMesh builds a JSON message and writes it to all open connections.
5. Receiving peers parse the message, display it, and store it in their local in-memory map.
6. `/summary` reads from this local map and renders the aggregated view.

No data ever leaves your machine to a central server.

---

## Message Protocol

```json
{
  "v": 1,
  "type": "standup",
  "name": "Alice",
  "yesterday": "Reviewed PR #42, fixed login bug",
  "today": "Implement caching layer",
  "blocker": "Waiting on design review",
  "ts": 1718000000000
}
```

See `SKILL.md` for full protocol documentation and integration guide for other Intercom agents.

---

## Trac Address

```
[INSERT_YOUR_TRAC_ADDRESS_HERE]
```

---

## Competition Context

This project is submitted to the **Intercom Vibe Competition** by Trac Systems.

It is based on the [Intercom reference implementation](https://github.com/Trac-Systems/intercom), using the same P2P philosophy (Hyperswarm) adapted for a practical team productivity use-case.

**Why StandupMesh?**
- Solves a real problem every dev team has (async standups)
- Requires zero infrastructure — perfect for teams, open-source projects, hackathons
- Works on Termux / Android, making it truly mobile-first P2P
- Extensible via the documented JSON protocol (other Intercom agents can post to the mesh)

---

## License

MIT © [trac1far8mpghdkk4vpyurnl0x9tzngrwam7d2skjuy9faj3ps257cmcsrfksk9]
