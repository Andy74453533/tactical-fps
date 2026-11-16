// Bots. Each bot has a role (which site to attack or hold), a skill draw, and
// a small state machine: move along the waypoint graph, hold an angle,
// engage what it sees, investigate what it hears, and work the objective.
// Perception is line of sight through the map's boxes plus a hearing radius;
// aim error shrinks while the bot stands still, so bots that stop to shoot
// are dangerous and bots on the run are not.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { TEAM } from './palette.js';
import { segmentBlocked, segmentSmoked, angleDelta, distance2D } from './physics.js';
import { slideMove } from './physics.js';
import { eyePosition, currentWeapon } from './actors.js';
import { fireHitscan, currentSpread, stepLoadout } from './weapons.js';
import { pushEvent } from './state.js';

const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i].x - x;
    const dz = nodes[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first search over the waypoint graph. Returns node indices from
// start to goal, excluding start, or [] when already there.
export function findPath(adjacency, start, goal) {
  if (start === goal) return [];
  const prev = new Int16Array(adjacency.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === goal) {
        const path = [goal];
        let cur = goal;
        while (cur !== start) {
          cur = prev[cur];
          path.unshift(cur);
        }
        path.shift();
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

export function createBot(actor, role, skill, index) {
  const bot = {
    role,
    skill,
    index,
    state: 'move',
    path: [],
    pathTarget: null,
    destination: null,
    holdSpot: null,
    thinkAt: index * 0.02,
    reactionAt: 0,
    target: null,
    lastKnown: null,
    lastKnownAt: -99,
    aimYaw: actor.yaw,
    aimPitch: 0,
    aimSettle: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    strafeDir: 1,
    strafeUntil: 0,
    stuckAt: 0,
    stuckX: 0,
    stuckZ: 0,
    detour: null,
    repathAt: 0,
    investigate: null,
    planSite: null,
    planDest: null,
    reset() {
      bot.state = 'move';
      bot.path = [];
      bot.pathTarget = null;
      bot.destination = null;
      bot.target = null;
      bot.lastKnown = null;
      bot.burstLeft = 0;
      bot.investigate = null;
      bot.detour = null;
      bot.aimYaw = actor.yaw;
      bot.aimPitch = 0;
      bot.aimSettle = 0;
    },
  };
  actor.bot = bot;
  return bot;
}

function setDestination(state, bot, actor, dest) {
  const nodes = state.world.navNodes;
  const from = nearestNode(nodes, actor.position.x, actor.position.z);
  const to = nearestNode(nodes, dest.x, dest.z);
  bot.path = findPath(state.world.navAdjacency, from, to);
  bot.pathTarget = to;
  bot.destination = dest;
  bot.repathAt = state.time + 2.5;
}

function canSee(state, actor, enemy) {
  if (actor.blind > 0) return false;
  eyePosition(actor, _eye);
  eyePosition(enemy, _targetEye);
  const dx = _targetEye.x - _eye.x;
  const dy = _targetEye.y - _eye.y;
  const dz = _targetEye.z - _eye.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > CONFIG.bot.sightRange) return false;
  if (dist > 4) {
    const facing = Math.atan2(-dx, -dz);
    if (Math.abs(angleDelta(actor.yaw, facing)) > CONFIG.bot.sightFov / 2) return false;
  }
  if (segmentBlocked(_eye.x, _eye.y, _eye.z, _targetEye.x, _targetEye.y, _targetEye.z, state.colliders)) {
    // Eye line blocked: try the chest before giving up.
    if (segmentBlocked(_eye.x, _eye.y, _eye.z, enemy.position.x, enemy.position.y + 1.0, enemy.position.z, state.colliders)) return false;
  }
  if (segmentSmoked(_eye.x, _eye.y, _eye.z, _targetEye.x, _targetEye.y, _targetEye.z, state.smokes)) return false;
  return true;
}

function nearestVisibleEnemy(state, actor) {
  let best = null;
  let bestDist = Infinity;
  for (const other of state.actors) {
    if (!other.alive || other.team === actor.team) continue;
    const d = distance2D(actor.position.x, actor.position.z, other.position.x, other.position.z);
    if (d < bestDist && canSee(state, actor, other)) {
      best = other;
      bestDist = d;
    }
  }
  return best;
}

function hearNoise(state, actor, bot) {
  for (const n of state.noise) {
    if (state.time - n.time > 1.2) continue;
    const d = distance2D(actor.position.x, actor.position.z, n.x, n.z);
    if (d < n.radius) {
      bot.investigate = { x: n.x, z: n.z, at: state.time };
      return;
    }
  }
}

function objectiveDestination(state, actor, bot) {
  const bomb = state.bomb;
  if (actor.team === TEAM.VANGUARD) {
    if (bomb.state === 'planted') {
      // Guard the planted charge from just outside the site.
      const site = state.world.sites[bomb.site];
      return { x: site.center.x + (actor.id % 2 ? 4 : -4), z: site.center.z + 5 };
    }
    if (bomb.state === 'dropped' && !bomb.carrier) {
      const d = distance2D(actor.position.x, actor.position.z, bomb.x, bomb.z);
      if (d < 14) return { x: bomb.x, z: bomb.z };
    }
    if (bomb.carrier === actor) {
      const site = state.world.sites[bot.planSite || 'A'];
      return { x: site.center.x, z: site.center.z };
    }
    // The round plan overrides the role push: executes send everyone to one
    // site, mid sends the escorts to mid, split falls back to roles.
    if (bot.planDest) return bot.planDest;
    if (bot.role === 'rushA') return { x: -20, z: -13 };
    if (bot.role === 'rushB') return { x: 20, z: -13 };
    return { x: 0, z: -11 };
  }
  // Aegis
  if (bomb.state === 'planted') {
    const site = state.world.sites[bomb.site];
    return { x: site.center.x, z: site.center.z };
  }
  if (bot.holdSpot) return bot.holdSpot;
  return { x: 0, z: -11 };
}

function think(state, actor, bot, dt) {
  const bomb = state.bomb;
  // Perception.
  const enemy = nearestVisibleEnemy(state, actor);
  if (enemy) {
    if (bot.target !== enemy) {
      bot.target = enemy;
      bot.reactionAt = state.time + bot.skill.reaction;
    }
    bot.lastKnown = { x: enemy.position.x, z: enemy.position.z };
    bot.lastKnownAt = state.time;
    const intel = state.intel[actor.team];
    intel.x = enemy.position.x;
    intel.z = enemy.position.z;
    intel.at = state.time;
  } else if (bot.target && (state.time - bot.lastKnownAt > 1.4 || !bot.target.alive)) {
    bot.target = null;
  }
  if (!bot.target) hearNoise(state, actor, bot);

  // Objective channels.
  if (actor.team === TEAM.VANGUARD && bomb.carrier === actor && bomb.state === 'carried') {
    const site = state.world.sites[bot.planSite || (bot.role === 'rushB' ? 'B' : 'A')];
    const inSite = actor.position.x >= site.minX && actor.position.x <= site.maxX
      && actor.position.z >= site.minZ && actor.position.z <= site.maxZ;
    if (inSite && !bot.target && state.time - bot.lastKnownAt > 1.2) {
      bot.state = 'plant';
      return;
    }
  }
  if (actor.team === TEAM.AEGIS && bomb.state === 'planted') {
    const d = distance2D(actor.position.x, actor.position.z, bomb.x, bomb.z);
    if (d < 2.2 && !bot.target) {
      bot.state = 'defuse';
      return;
    }
  }
  if (bot.state === 'plant' || bot.state === 'defuse') bot.state = 'move';

  // Destination.
  let dest = null;
  if (bot.target && bot.lastKnown) {
    dest = null; // fight in place, strafe only
  } else if (bot.investigate && state.time - bot.investigate.at < 5) {
    dest = bot.investigate;
  } else if (actor.team === TEAM.AEGIS && !bot.target && bomb.state !== 'planted' && bot.holdSpot) {
    const d = distance2D(actor.position.x, actor.position.z, bot.holdSpot.x, bot.holdSpot.z);
    dest = d > 1.2 ? bot.holdSpot : null;
    if (!dest) bot.state = 'hold';
  } else {
    dest = objectiveDestination(state, actor, bot);
  }
  if (bot.state !== 'hold') bot.state = bot.target ? 'engage' : 'move';
  // A detour overrides the objective until reached or expired: it is how a
  // bot unwedges itself from a crate corner instead of pushing forever.
  if (bot.detour) {
    if (state.time > bot.detour.until
      || distance2D(actor.position.x, actor.position.z, bot.detour.x, bot.detour.z) < 1.5) {
      bot.detour = null;
    } else {
      dest = bot.detour;
    }
  }
  if (dest && (!bot.destination || Math.hypot(dest.x - bot.destination.x, dest.z - bot.destination.z) > 3 || state.time > bot.repathAt)) {
    setDestination(state, bot, actor, dest);
  }
  if (!dest) {
    bot.path = [];
    bot.destination = null;
  }
}

function moveAlongPath(state, actor, bot, dt) {
  const speed = 4.6;
  let tx = null;
  let tz = null;
  if (bot.path.length) {
    const node = state.world.navNodes[bot.path[0]];
    tx = node.x;
    tz = node.z;
    if (distance2D(actor.position.x, actor.position.z, tx, tz) < 1.0) {
      bot.path.shift();
      if (bot.path.length) {
        const next = state.world.navNodes[bot.path[0]];
        tx = next.x;
        tz = next.z;
      } else if (bot.destination) {
        tx = bot.destination.x;
        tz = bot.destination.z;
      }
    }
  } else if (bot.destination) {
    tx = bot.destination.x;
    tz = bot.destination.z;
  }
  if (tx === null) return false;
  const dx = tx - actor.position.x;
  const dz = tz - actor.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.6) return false;
  // Separation from nearby teammates so bots do not stack.
  let pushX = 0;
  let pushZ = 0;
  for (const other of state.actors) {
    if (other === actor || !other.alive) continue;
    const ox = actor.position.x - other.position.x;
    const oz = actor.position.z - other.position.z;
    const od = Math.hypot(ox, oz);
    if (od > 0.01 && od < 0.9) {
      pushX += (ox / od) * (0.9 - od) * 2;
      pushZ += (oz / od) * (0.9 - od) * 2;
    }
  }
  const mx = dx / dist + pushX;
  const mz = dz / dist + pushZ;
  const len = Math.hypot(mx, mz) || 1;
  actor.velocity.x = (mx / len) * speed;
  actor.velocity.z = (mz / len) * speed;
  actor.yaw += angleDelta(actor.yaw, Math.atan2(-mx, -mz)) * Math.min(1, dt * 8);
  // Stuck: no progress while pushing — route via a nearby waypoint instead
  // of re-planning the same blocked line.
  if (Math.hypot(actor.position.x - bot.stuckX, actor.position.z - bot.stuckZ) < 0.25) {
    if (state.time - bot.stuckAt > 1.2) {
      bot.stuckAt = state.time;
      bot.stuckX = actor.position.x;
      bot.stuckZ = actor.position.z;
      const options = state.world.navNodes.filter((n) => {
        const d = distance2D(actor.position.x, actor.position.z, n.x, n.z);
        return d > 4 && d < 14;
      });
      if (options.length) {
        const pick = options[state.rng.int(0, options.length - 1)];
        bot.detour = { x: pick.x, z: pick.z, until: state.time + 4 };
        bot.destination = null;
        bot.path = [];
      }
    }
  } else {
    bot.stuckAt = state.time;
    bot.stuckX = actor.position.x;
    bot.stuckZ = actor.position.z;
  }
  return true;
}

function engage(state, actor, bot, dt, hitList) {
  const target = bot.target;
  if (!target || !target.alive) return;
  eyePosition(target, _targetEye);
  const dx = _targetEye.x - actor.position.x;
  const dy = _targetEye.y - (actor.position.y + actor.eye);
  const dz = _targetEye.z - actor.position.z;
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
  const turn = Math.min(1, dt * bot.skill.turnSpeed);
  bot.aimYaw += angleDelta(bot.aimYaw, wantYaw) * turn;
  bot.aimPitch += (wantPitch - bot.aimPitch) * turn;
  actor.yaw = bot.aimYaw;
  actor.pitch = bot.aimPitch;
  const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  if (speed < 0.5) bot.aimSettle = Math.min(1, bot.aimSettle + dt * 1.6);
  else bot.aimSettle = Math.max(0, bot.aimSettle - dt * 2.5);

  // Strafe while fighting, changing direction every second or so.
  if (state.time > bot.strafeUntil) {
    bot.strafeDir = state.rng.chance(0.5) ? 1 : -1;
    bot.strafeUntil = state.time + state.rng.range(0.7, 1.4);
  }
  const moving = state.rng.chance(0.6);
  if (moving) {
    const sx = Math.cos(bot.aimYaw) * bot.strafeDir;
    const sz = -Math.sin(bot.aimYaw) * bot.strafeDir;
    actor.velocity.x = sx * 2.2;
    actor.velocity.z = sz * 2.2;
  } else {
    actor.velocity.x *= 0.8;
    actor.velocity.z *= 0.8;
  }
  actor.crouching = state.rng.chance(0.02) ? !actor.crouching : actor.crouching;

  if (state.time < bot.reactionAt) return;
  const weapon = currentWeapon(actor.loadout);
  if (bot.burstLeft <= 0) {
    if (state.time < bot.burstPauseUntil) return;
    bot.burstLeft = state.rng.int(CONFIG.bot.burstMin, CONFIG.bot.burstMax);
  }
  if (actor.loadout.cooldown > 0 || actor.loadout.reloadLeft > 0) return;
  if (weapon.mag <= 0) return;
  const dist = Math.hypot(dx, dz);
  if (dist > weapon.def.range) return;
  // Re-check the line before every shot: no shooting through walls.
  eyePosition(actor, _eye);
  if (segmentBlocked(_eye.x, _eye.y, _eye.z, _targetEye.x, _targetEye.y, _targetEye.z, state.colliders)) return;
  weapon.mag -= 1;
  actor.loadout.cooldown = weapon.def.fireGap;
  bot.burstLeft -= 1;
  if (bot.burstLeft <= 0) {
    bot.burstPauseUntil = state.time + state.rng.range(CONFIG.bot.burstPauseMin, CONFIG.bot.burstPauseMax);
  }
  const error = bot.skill.aimError * (1.6 - bot.aimSettle) * (moving ? 1.5 : 1);
  _dir.set(dx, dy, dz).normalize();
  eyePosition(actor, _origin);
  const hits = fireHitscan(state, hitList, actor, _origin, _dir, weapon.def, error);
  pushEvent(state, {
    type: 'shot', x: _origin.x, y: _origin.y, z: _origin.z,
    weapon: weapon.def.id, actor, muzzle: true,
  });
  pushEvent(state, { type: 'noise', x: actor.position.x, z: actor.position.z, radius: CONFIG.bot.hearRadius, time: state.time });
  for (const hit of hits) {
    if (hit.actor.isPlayer) pushEvent(state, { type: 'playerDamaged', fromX: actor.position.x, fromZ: actor.position.z });
  }
}

export function stepBots(state, dt, hitList) {
  for (const actor of state.actors) {
    if (actor.isPlayer || !actor.alive) continue;
    const bot = actor.bot;
    if (!bot) continue;
    stepLoadout(actor.loadout, dt);
    actor.blind = Math.max(0, actor.blind - dt);
    if (state.phase !== 'live') {
      actor.velocity.x = 0;
      actor.velocity.z = 0;
      continue;
    }
    if (state.time >= bot.thinkAt) {
      bot.thinkAt = state.time + CONFIG.bot.thinkInterval;
      think(state, actor, bot, dt);
    }
    if (bot.state === 'plant') {
      actor.velocity.x = 0;
      actor.velocity.z = 0;
      state.bomb.planter = actor;
    } else if (bot.state === 'defuse') {
      actor.velocity.x = 0;
      actor.velocity.z = 0;
      state.bomb.defuser = actor;
    } else {
      if (state.bomb.planter === actor) state.bomb.planter = null;
      if (state.bomb.defuser === actor) state.bomb.defuser = null;
      const moving = bot.target ? false : moveAlongPath(state, actor, bot, dt);
      if (!moving && !bot.target) {
        actor.velocity.x *= 0.8;
        actor.velocity.z *= 0.8;
        if (bot.state === 'hold' && bot.holdSpot) {
          const wantYaw = Math.atan2(-(bot.holdSpot.lookX - actor.position.x), -(bot.holdSpot.lookZ - actor.position.z));
          actor.yaw += angleDelta(actor.yaw, wantYaw) * Math.min(1, dt * 4);
          bot.aimYaw = actor.yaw;
        }
      }
      if (bot.target) engage(state, actor, bot, dt, hitList);
    }
    // Gravity and ground contact.
    actor.velocity.y -= CONFIG.player.gravity * dt;
    const height = actor.crouching ? CONFIG.player.crouchHeight : CONFIG.player.standHeight;
    actor.height = height;
    actor.eye += ((actor.crouching ? CONFIG.player.crouchEye : CONFIG.player.standEye) - actor.eye) * Math.min(1, dt * 12);
    actor.onGround = slideMove(actor.position, actor.velocity, dt, CONFIG.player.radius, height, state.colliders);
    // Reload when the magazine runs dry out of danger.
    const weapon = currentWeapon(actor.loadout);
    if (weapon.mag === 0 && weapon.reserve > 0 && actor.loadout.reloadLeft === 0) {
      actor.loadout.reloadLeft = weapon.def.reload;
    }
  }
}
