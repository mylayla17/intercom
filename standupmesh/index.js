#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════╗
 * ║           StandupMesh v1.0.0                        ║
 * ║   Decentralized P2P Daily Standup Bot               ║
 * ║   Intercom Vibe Competition Submission              ║
 * ║   Trac Address: [INSERT_YOUR_TRAC_ADDRESS_HERE]     ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   node index.js                          # Full interactive mode
 *   node index.js --mode listen            # Listen-only (silent observer)
 *   node index.js --topic <32-byte-hex>    # Join a specific team topic
 *   node index.js --name "Alice"           # Set your display name
 *   node index.js --reminder 09:00         # Set a daily reminder (HH:MM, 24h)
 *   node index.js --export                 # Auto-export summary to standup.log
 */

'use strict';

const Hyperswarm  = require('hyperswarm');
const crypto      = require('hypercore-crypto');
const b4a         = require('b4a');
const readline    = require('readline');
const fs          = require('fs');
const path        = require('path');
const args        = require('minimist')(process.argv.slice(2));

// ─── ANSI Color Helpers (works in Termux & standard terminals) ───────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  white:   '\x1b[37m',
  bgBlue:  '\x1b[44m',
};

// ─── Config ──────────────────────────────────────────────────────────────────
const MODE         = args.mode    || 'interactive';   // 'interactive' | 'listen'
const DISPLAY_NAME = args.name    || `Peer-${Math.floor(Math.random() * 9000) + 1000}`;
const REMINDER     = args.reminder || null;           // e.g. "09:00"
const DO_EXPORT    = args.export  || false;
const CUSTOM_TOPIC = args.topic   || null;
const LOG_FILE     = path.join(process.cwd(), 'standup.log');

// ─── Protocol version for message validation ──────────────────────────────────
const PROTOCOL_VERSION = 1;
const MSG_TYPE_STANDUP  = 'standup';
const MSG_TYPE_SUMMARY  = 'summary_request';
const MSG_TYPE_PING     = 'ping';
const MSG_TYPE_PONG     = 'pong';

// ─── In-memory store: holds all standup updates received this session ─────────
// Structure: { [peerName]: { yesterday, today, blocker, ts, peerId } }
const standupStore = new Map();

// Connected peers list
const peers = new Set();

// ─── Utilities ────────────────────────────────────────────────────────────────
function timestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function datestamp() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function log(prefix, color, msg) {
  console.log(`${color}${C.bold}[${timestamp()}]${C.reset} ${color}${prefix}${C.reset} ${msg}`);
}

function info(msg)    { log('ℹ', C.cyan,    msg); }
function success(msg) { log('✔', C.green,   msg); }
function warn(msg)    { log('⚠', C.yellow,  msg); }
function error(msg)   { log('✖', C.red,     msg); }
function peer(msg)    { log('◈', C.magenta, msg); }

function printBanner() {
  console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════╗
║          StandupMesh v1.0.0  — P2P Standup Bot      ║
║    No server. No account. Just your team & P2P.     ║
╚══════════════════════════════════════════════════════╝${C.reset}
  ${C.dim}Built on Hyperswarm · Intercom Vibe Competition${C.reset}
`);
}

function printHelp() {
  console.log(`${C.yellow}${C.bold}Available commands:${C.reset}
  ${C.green}/standup${C.reset}         — Start your daily standup (guided prompts)
  ${C.green}/summary${C.reset}         — Print today's aggregated team summary
  ${C.green}/peers${C.reset}           — List currently connected peers
  ${C.green}/export${C.reset}          — Export today's summary to ${C.dim}standup.log${C.reset}
  ${C.green}/topic${C.reset}           — Show the current topic key (share with team)
  ${C.green}/clear${C.reset}           — Clear the terminal screen
  ${C.green}/help${C.reset}            — Show this help message
  ${C.green}/quit${C.reset}            — Disconnect and exit

  ${C.dim}In listen mode, all standup updates appear automatically.${C.reset}
`);
}

// ─── Message builders ─────────────────────────────────────────────────────────
function buildStandupMsg(name, yesterday, today, blocker) {
  return JSON.stringify({
    v:         PROTOCOL_VERSION,
    type:      MSG_TYPE_STANDUP,
    name,
    yesterday,
    today,
    blocker,
    ts:        Date.now(),
  });
}

function buildPingMsg(name) {
  return JSON.stringify({ v: PROTOCOL_VERSION, type: MSG_TYPE_PING, name, ts: Date.now() });
}

function buildPongMsg(name) {
  return JSON.stringify({ v: PROTOCOL_VERSION, type: MSG_TYPE_PONG, name, ts: Date.now() });
}

// ─── Message parser & handler ─────────────────────────────────────────────────
function handleIncoming(raw, fromPeerId) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    warn(`Received malformed message — ignoring.`);
    return;
  }

  if (!msg.v || msg.v !== PROTOCOL_VERSION) return; // version mismatch

  switch (msg.type) {
    case MSG_TYPE_STANDUP: {
      const entry = {
        yesterday: msg.yesterday || '—',
        today:     msg.today     || '—',
        blocker:   msg.blocker   || 'None',
        ts:        msg.ts,
        peerId:    fromPeerId,
      };
      standupStore.set(msg.name, entry);

      const timeStr = new Date(msg.ts).toLocaleTimeString('en-GB', { hour12: false });
      console.log(`
${C.bgBlue}${C.white}${C.bold}  📋 STANDUP from ${msg.name}  ${C.reset}  ${C.dim}(${timeStr})${C.reset}
  ${C.yellow}Yesterday:${C.reset} ${msg.yesterday}
  ${C.green}Today:    ${C.reset} ${msg.today}
  ${C.red}Blocker:  ${C.reset} ${msg.blocker || 'None'}
`);

      if (DO_EXPORT) exportSummary(false);
      break;
    }

    case MSG_TYPE_PING: {
      // Respond with a pong so the pinger knows we're alive
      peer(`Ping from ${C.bold}${msg.name}${C.reset}`);
      break;
    }

    case MSG_TYPE_PONG: {
      peer(`Pong from ${C.bold}${msg.name}${C.reset}`);
      break;
    }

    default:
      break;
  }
}

// ─── Summary printer ──────────────────────────────────────────────────────────
function printSummary() {
  if (standupStore.size === 0) {
    warn('No standup updates received yet for today.');
    return;
  }

  const date = datestamp();
  const divider = `${C.dim}${'─'.repeat(56)}${C.reset}`;

  console.log(`\n${C.cyan}${C.bold}┌─────────────────────────────────────────────────────┐`);
  console.log(`│         📊  TEAM STANDUP SUMMARY                   │`);
  console.log(`│  ${date.padEnd(51)}│`);
  console.log(`└─────────────────────────────────────────────────────┘${C.reset}\n`);

  let i = 1;
  for (const [name, entry] of standupStore.entries()) {
    const timeStr = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });
    console.log(`${C.bold}${C.magenta}${i}. ${name}${C.reset}  ${C.dim}(submitted ${timeStr})${C.reset}`);
    console.log(`   ${C.yellow}Yesterday:${C.reset} ${entry.yesterday}`);
    console.log(`   ${C.green}Today:    ${C.reset} ${entry.today}`);
    console.log(`   ${C.red}Blocker:  ${C.reset} ${entry.blocker}`);
    console.log(divider);
    i++;
  }

  const blockers = [...standupStore.entries()].filter(([, e]) => e.blocker && e.blocker.toLowerCase() !== 'none' && e.blocker.trim() !== '');
  if (blockers.length > 0) {
    console.log(`\n${C.red}${C.bold}⚡ Active Blockers (${blockers.length}):${C.reset}`);
    blockers.forEach(([name, e]) => {
      console.log(`   • ${C.bold}${name}:${C.reset} ${e.blocker}`);
    });
  } else {
    console.log(`\n${C.green}${C.bold}✔ No blockers reported today!${C.reset}`);
  }

  console.log(`\n${C.dim}Total responses: ${standupStore.size} peer(s)${C.reset}\n`);
}

// ─── Export to file ───────────────────────────────────────────────────────────
function exportSummary(verbose = true) {
  if (standupStore.size === 0) {
    if (verbose) warn('Nothing to export yet.');
    return;
  }

  const date   = datestamp();
  const lines  = [`StandupMesh — Team Summary`, `Date: ${date}`, `${'='.repeat(56)}\n`];

  for (const [name, entry] of standupStore.entries()) {
    const timeStr = new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false });
    lines.push(`[ ${name} ]  (${timeStr})`);
    lines.push(`  Yesterday: ${entry.yesterday}`);
    lines.push(`  Today:     ${entry.today}`);
    lines.push(`  Blocker:   ${entry.blocker}`);
    lines.push('');
  }

  lines.push(`${'='.repeat(56)}`);
  lines.push(`Exported by StandupMesh — Intercom Vibe Competition`);
  lines.push(`Trac Address: [INSERT_YOUR_TRAC_ADDRESS_HERE]`);

  fs.appendFileSync(LOG_FILE, lines.join('\n') + '\n\n');
  if (verbose) success(`Summary exported → ${C.bold}${LOG_FILE}${C.reset}`);
}

// ─── Reminder scheduler ───────────────────────────────────────────────────────
function scheduleReminder(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    warn(`Invalid reminder time "${timeStr}". Use HH:MM (24h format).`);
    return;
  }

  function checkTime() {
    const now  = new Date();
    const diff = new Date();
    diff.setHours(hh, mm, 0, 0);

    // If already past today, schedule for tomorrow
    if (diff <= now) diff.setDate(diff.getDate() + 1);

    const msUntil = diff - now;
    info(`⏰ Daily standup reminder set for ${C.bold}${timeStr}${C.reset} (in ${Math.round(msUntil / 60000)} min)`);

    setTimeout(() => {
      console.log(`\n${C.yellow}${C.bold}⏰  STANDUP TIME!  It's ${timeStr} — time for your daily update.${C.reset}`);
      console.log(`${C.dim}Type /standup to submit your update.${C.reset}\n`);
      checkTime(); // reschedule for tomorrow
    }, msUntil);
  }

  checkTime();
}

// ─── Guided standup input ─────────────────────────────────────────────────────
async function promptStandup(rl, swarm) {
  const ask = (q) => new Promise(resolve => {
    rl.question(`${C.cyan}${C.bold}${q}${C.reset} `, answer => resolve(answer.trim()));
  });

  console.log(`\n${C.green}${C.bold}📋 Starting your standup...${C.reset} (press Enter to skip a field)\n`);

  const yesterday = await ask('  Yesterday (what did you do?):');
  const today     = await ask('  Today     (what will you do?):');
  const blocker   = await ask('  Blockers  (anything in your way?):');

  if (!yesterday && !today) {
    warn('Standup cancelled — no content entered.');
    return;
  }

  const msg = buildStandupMsg(
    DISPLAY_NAME,
    yesterday || '—',
    today     || '—',
    blocker   || 'None'
  );

  // Store own update locally
  standupStore.set(DISPLAY_NAME, {
    yesterday: yesterday || '—',
    today:     today     || '—',
    blocker:   blocker   || 'None',
    ts:        Date.now(),
    peerId:    'self',
  });

  // Broadcast to all connected peers
  let broadcastCount = 0;
  for (const conn of peers) {
    try {
      conn.write(b4a.from(msg));
      broadcastCount++;
    } catch (err) {
      // Peer may have disconnected; remove it
      peers.delete(conn);
    }
  }

  success(`Standup submitted! Broadcast to ${broadcastCount} peer(s).`);
  if (DO_EXPORT) exportSummary(false);
}

// ─── Interactive CLI loop ─────────────────────────────────────────────────────
async function startCLI(swarm) {
  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    terminal: true,
    prompt:   `${C.dim}standupmesh>${C.reset} `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const cmd = line.trim().toLowerCase();

    switch (cmd) {
      case '/standup':
        rl.pause();
        await promptStandup(rl, swarm);
        rl.resume();
        break;

      case '/summary':
        printSummary();
        break;

      case '/peers':
        info(`Connected peers: ${C.bold}${peers.size}${C.reset}`);
        break;

      case '/export':
        exportSummary(true);
        break;

      case '/topic': {
        const topicHex = b4a.toString(swarm._discovery ? swarm._discovery._topic || Buffer.alloc(32) : Buffer.alloc(32), 'hex');
        info(`Current topic key:\n  ${C.bold}${C.yellow}${topicHex}${C.reset}`);
        info(`Share this key with teammates so they can join your standup.`);
        break;
      }

      case '/clear':
        console.clear();
        printBanner();
        break;

      case '/help':
        printHelp();
        break;

      case '/quit':
      case '/exit':
        info('Disconnecting…');
        await swarm.destroy();
        process.exit(0);
        break;

      case '':
        break;

      default:
        warn(`Unknown command "${cmd}" — type /help for options.`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    info('Session ended.');
    await swarm.destroy();
    process.exit(0);
  });

  return rl;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
async function main() {
  printBanner();

  // Determine the swarm topic
  let topicBuffer;
  if (CUSTOM_TOPIC) {
    if (CUSTOM_TOPIC.length !== 64) {
      error('--topic must be a 64-character hex string (32 bytes).');
      process.exit(1);
    }
    topicBuffer = b4a.from(CUSTOM_TOPIC, 'hex');
    info(`Joining custom topic: ${C.bold}${CUSTOM_TOPIC}${C.reset}`);
  } else {
    // Derive a stable default topic from a known seed
    // Teams sharing the same seed phrase join the same mesh
    const seed    = b4a.from('standupmesh-intercom-vibe-2025');
    topicBuffer   = crypto.hash(seed);
    const topicHex = b4a.toString(topicBuffer, 'hex');
    info(`Default topic: ${C.bold}${C.yellow}${topicHex}${C.reset}`);
    info(`Share this key (or use --topic <key>) so teammates join your mesh.`);
  }

  info(`Your name: ${C.bold}${DISPLAY_NAME}${C.reset}  ${C.dim}(use --name "YourName" to change)${C.reset}`);
  info(`Mode: ${C.bold}${MODE}${C.reset}`);
  info('Connecting to P2P network via Hyperswarm…\n');

  // ── Hyperswarm setup ──────────────────────────────────────────────────────
  const swarm = new Hyperswarm();

  // Graceful shutdown on SIGINT / SIGTERM
  const shutdown = async () => {
    info('\nShutting down StandupMesh…');
    await swarm.destroy();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // ── Peer connection handler ───────────────────────────────────────────────
  swarm.on('connection', (conn, info) => {
    const peerId = b4a.toString(info.publicKey, 'hex').slice(0, 12);
    peers.add(conn);
    peer(`New peer connected ${C.dim}(${peerId}…)${C.reset}  [${peers.size} total]`);

    // Send a ping so the remote peer knows our name
    try {
      conn.write(b4a.from(buildPingMsg(DISPLAY_NAME)));
    } catch (_) {}

    // Stream incoming data
    conn.on('data', (data) => {
      handleIncoming(data, peerId);
    });

    conn.on('error', (err) => {
      if (err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
        warn(`Connection error (${peerId}): ${err.message}`);
      }
    });

    conn.on('close', () => {
      peers.delete(conn);
      peer(`Peer disconnected ${C.dim}(${peerId}…)${C.reset}  [${peers.size} remaining]`);
    });
  });

  // ── Swarm error handler ───────────────────────────────────────────────────
  swarm.on('error', (err) => {
    error(`Swarm error: ${err.message}`);
  });

  // ── Join the topic ────────────────────────────────────────────────────────
  const discovery = swarm.join(topicBuffer, { server: true, client: true });
  await discovery.flushed();

  const topicHex = b4a.toString(topicBuffer, 'hex');
  success(`Joined P2P mesh! Topic: ${C.bold}${C.yellow}${topicHex}${C.reset}`);
  success(`Waiting for peers… (this may take a few seconds on mobile)\n`);

  // ── Optional reminder ─────────────────────────────────────────────────────
  if (REMINDER) scheduleReminder(REMINDER);

  // ── Start CLI or listen-only mode ─────────────────────────────────────────
  if (MODE === 'listen') {
    info(`Running in ${C.bold}listen-only${C.reset} mode. Standup updates will appear here.`);
    info('Press Ctrl+C to exit.\n');
  } else {
    console.log(`${C.dim}Type /help for commands, /standup to submit your update.${C.reset}\n`);
    await startCLI(swarm);
  }
}

main().catch((err) => {
  error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
