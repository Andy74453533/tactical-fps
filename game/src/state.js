// The one state object. Every system reads and writes this and nothing else,
// so the simulation, the HUD and the audio can never disagree about the game.
// Events are a queue the simulation pushes and the frame loop drains: sounds,
// kill feed entries and banners all come from here, never from direct calls
// inside the simulation.
import { CONFIG } from './config.js';
import { TEAM } from './palette.js';

export const PHASE = {
  MENU: 'menu',
  FREEZE: 'freeze',
  LIVE: 'live',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export function createState(rng) {
  return {
    rng,
    time: 0,
    phase: PHASE.MENU,
    phaseTime: 0,
    round: 0,
    scores: { [TEAM.VANGUARD]: 0, [TEAM.AEGIS]: 0 },
    lossStreak: { [TEAM.VANGUARD]: 0, [TEAM.AEGIS]: 0 },
    actors: [],
    player: null,
    bomb: {
      state: 'carried', // carried | dropped | planted | exploded | defused
      carrier: null,
      site: null,
      x: 0,
      z: 0,
      fuseLeft: 0,
      plantProgress: 0,
      defuseProgress: 0,
      planter: null,
      defuser: null,
    },
    roundTime: CONFIG.match.roundTime,
    freezeLeft: 0,
    roundLeft: 0,
    roundEndLeft: 0,
    world: null,
    colliders: [],
    intel: {
      [TEAM.VANGUARD]: { x: 0, z: 0, at: -99 },
      [TEAM.AEGIS]: { x: 0, z: 0, at: -99 },
    },
    channel: null,
    playerSpread: 0,
    events: [],
    noise: [],
    grenades: [],
    smokes: [],
    kills: [],
    winner: null,
    winReason: '',
    paused: false,
    buyOpen: false,
    scoreboardOpen: false,
    spectateTarget: null,
    settings: { sensitivity: 1.0, volume: 0.8 },
    stats: { shotsFired: 0, shotsHit: 0, headshots: 0 },
  };
}

export function pushEvent(state, event) {
  state.events.push(event);
}

export function drainEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}

export function aliveActors(state, team) {
  const out = [];
  for (const actor of state.actors) {
    if (actor.alive && (!team || actor.team === team)) out.push(actor);
  }
  return out;
}

export function teamAlive(state, team) {
  for (const actor of state.actors) {
    if (actor.alive && actor.team === team) return true;
  }
  return false;
}
