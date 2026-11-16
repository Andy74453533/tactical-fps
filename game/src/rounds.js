// Rounds and the match: freeze (buy) → live → round end → next freeze,
// until a team reaches five rounds or nine are played. Wiping the defenders
// ends the round at once; wiping the attackers after a plant does not.
import { CONFIG, WEAPONS, GRENADE_DEFS, EQUIPMENT, BOT_NAMES } from './config.js';
import { TEAM } from './palette.js';
import { PHASE, pushEvent, teamAlive, aliveActors } from './state.js';
import { createActor, resetActor, giveWeapon, currentWeapon, damageActor } from './actors.js';
import { createBot } from './bots.js';
import { distance2D } from './physics.js';

export function setupMatch(state, scene) {
  const world = state.world;
  const actors = [];
  const player = createActor(scene, {
    id: 0, name: 'You', team: TEAM.VANGUARD, isPlayer: true, spawn: world.spawns[TEAM.VANGUARD][0],
  });
  actors.push(player);
  state.player = player;
  const vanguardRoles = ['rushA', 'rushB', 'rushA', 'mid'];
  const vanguardNames = BOT_NAMES[TEAM.VANGUARD];
  for (let i = 0; i < 4; i += 1) {
    const actor = createActor(scene, {
      id: i + 1, name: vanguardNames[i], team: TEAM.VANGUARD, isPlayer: false,
      spawn: world.spawns[TEAM.VANGUARD][i + 1],
    });
    createBot(actor, vanguardRoles[i], makeSkill(state), i + 1);
    actors.push(actor);
  }
  const aegisRoles = ['holdA', 'holdA', 'holdB', 'holdB', 'mid'];
  const aegisNames = BOT_NAMES[TEAM.AEGIS];
  const holdPool = [world.holdSpots.A[0], world.holdSpots.A[1], world.holdSpots.B[0], world.holdSpots.B[1], world.holdSpots.MID[0]];
  for (let i = 0; i < 5; i += 1) {
    const actor = createActor(scene, {
      id: i + 5, name: aegisNames[i], team: TEAM.AEGIS, isPlayer: false,
      spawn: world.spawns[TEAM.AEGIS][i],
    });
    const bot = createBot(actor, aegisRoles[i], makeSkill(state), i + 5);
    bot.holdSpot = holdPool[i];
    actors.push(actor);
  }
  state.actors = actors;
  return actors;
}

function makeSkill(state) {
  return {
    reaction: state.rng.range(CONFIG.bot.reactionMin, CONFIG.bot.reactionMax),
    aimError: state.rng.range(CONFIG.bot.aimErrorMin, CONFIG.bot.aimErrorMax),
    turnSpeed: state.rng.range(3.6, 5.6),
  };
}

function pickCarrier(state) {
  const bots = state.actors.filter((a) => a.team === TEAM.VANGUARD && !a.isPlayer);
  return bots[state.rng.int(0, bots.length - 1)];
}

export function startRound(state) {
  state.round += 1;
  // Team plan for this round, drawn from the seeded stream: split keeps
  // role pushes, executes send everyone to one site, mid takes mid first.
  const roll = state.rng.next();
  state.plan = roll < 0.45 ? 'split' : roll < 0.65 ? 'rushA' : roll < 0.85 ? 'rushB' : 'mid';
  state.planSite = state.plan === 'rushB' ? 'B' : state.plan === 'rushA' ? 'A' : state.rng.chance(0.5) ? 'A' : 'B';
  state.phase = PHASE.FREEZE;
  state.phaseTime = 0;
  state.freezeLeft = CONFIG.match.freezeTime;
  state.roundLeft = CONFIG.match.roundTime;
  state.roundEndLeft = 0;
  state.winner = null;
  state.winReason = '';
  state.grenades = [];
  state.smokes = [];
  state.noise = [];
  state.channel = null;
  state.spectateTarget = null;
  state.bomb.state = 'carried';
  state.bomb.site = null;
  state.bomb.fuseLeft = 0;
  state.bomb.plantProgress = 0;
  state.bomb.defuseProgress = 0;
  state.bomb.planter = null;
  state.bomb.defuser = null;
  state.bomb.carrier = pickCarrier(state);
  for (const actor of state.actors) {
    resetActor(actor);
    // Keep bought weapons between rounds; refill the pistol reserve.
    const secondary = actor.loadout.secondary;
    if (secondary.def.id === 'p9') secondary.reserve = Math.max(secondary.reserve, 24);
    if (actor.loadout.primary) {
      actor.loadout.slot = 'primary';
      const primary = actor.loadout.primary;
      primary.mag = primary.def.mag;
      primary.reserve = primary.def.reserve;
    } else {
      actor.loadout.slot = 'secondary';
      secondary.mag = secondary.def.mag;
    }
    actor.loadout.reloadLeft = 0;
    actor.loadout.cooldown = 0;
    actor.loadout.bloom = 0;
    if (!actor.isPlayer) botBuy(state, actor);
    if (actor.bot && actor.team === TEAM.VANGUARD) {
      actor.bot.planSite = state.planSite;
      const site = state.world.sites[state.planSite];
      actor.bot.planDest = state.plan === 'rushA' || state.plan === 'rushB'
        ? { x: site.center.x, z: site.center.z }
        : state.plan === 'mid' && actor !== state.bomb.carrier ? { x: 0, z: -11 } : null;
    }
  }
  const planLabel = state.plan === 'split' ? 'split push on both sites'
    : state.plan === 'mid' ? `mid control, then Site ${state.planSite}`
    : `full execute on Site ${state.planSite}`;
  pushEvent(state, {
    type: 'roundStart', round: state.round, carrier: state.bomb.carrier, planLabel,
  });
}

function botBuy(state, actor) {
  const money = actor.money;
  const loadout = actor.loadout;
  if (!loadout.primary) {
    if (money >= WEAPONS.ar4.price + 650) {
      giveWeapon(loadout, WEAPONS.ar4);
      actor.money -= WEAPONS.ar4.price;
    } else if (money >= WEAPONS.k7.price) {
      giveWeapon(loadout, WEAPONS.k7);
      actor.money -= WEAPONS.k7.price;
    } else if (money >= WEAPONS.m870.price && state.rng.chance(0.4)) {
      giveWeapon(loadout, WEAPONS.m870);
      actor.money -= WEAPONS.m870.price;
    }
  }
  if (loadout.armor === 0 && actor.money >= EQUIPMENT.armor.price) {
    loadout.armor = CONFIG.player.armor;
    actor.money -= EQUIPMENT.armor.price;
  }
  if (actor.team === TEAM.AEGIS && !loadout.kit && actor.money >= EQUIPMENT.kit.price && state.rng.chance(0.6)) {
    loadout.kit = true;
    actor.money -= EQUIPMENT.kit.price;
  }
  if (actor.money >= GRENADE_DEFS.frag.price + 400 && state.rng.chance(0.5)) {
    loadout.grenades.frag += 1;
    actor.money -= GRENADE_DEFS.frag.price;
  }
}

export function buyItem(state, player, item) {
  if (state.phase !== PHASE.FREEZE && state.phase !== PHASE.LIVE) return false;
  if (state.phase === PHASE.LIVE && state.phaseTime > 12) return false;
  if (!player.alive) return false;
  const loadout = player.loadout;
  if (item.kind === 'weapon') {
    const def = WEAPONS[item.id];
    if (player.money < def.price) return false;
    if (loadout.primary && loadout.primary.def.id === def.id) return false;
    player.money -= def.price;
    giveWeapon(loadout, def);
    return true;
  }
  if (item.kind === 'armor') {
    if (loadout.armor > 0 || player.money < EQUIPMENT.armor.price) return false;
    player.money -= EQUIPMENT.armor.price;
    loadout.armor = CONFIG.player.armor;
    player.armor = CONFIG.player.armor;
    return true;
  }
  if (item.kind === 'kit') {
    if (loadout.kit || player.money < EQUIPMENT.kit.price) return false;
    player.money -= EQUIPMENT.kit.price;
    loadout.kit = true;
    return true;
  }
  if (item.kind === 'grenade') {
    const def = GRENADE_DEFS[item.id];
    if (loadout.grenades[item.id] >= 2 || player.money < def.price) return false;
    player.money -= def.price;
    loadout.grenades[item.id] += 1;
    return true;
  }
  return false;
}

function awardRound(state, winner, reason) {
  state.phase = PHASE.ROUND_END;
  state.phaseTime = 0;
  state.roundEndLeft = CONFIG.match.endTime;
  state.winner = winner;
  state.winReason = reason;
  state.scores[winner] += 1;
  state.roundHistory.push(winner === TEAM.VANGUARD ? 'V' : 'A');
  const loser = winner === TEAM.VANGUARD ? TEAM.AEGIS : TEAM.VANGUARD;
  state.lossStreak[loser] += 1;
  state.lossStreak[winner] = 0;
  const lossReward = Math.min(
    CONFIG.economy.maxLossReward,
    CONFIG.economy.lossReward + CONFIG.economy.lossStreakBonus * (state.lossStreak[loser] - 1),
  );
  for (const actor of state.actors) {
    const reward = actor.team === winner ? CONFIG.economy.winReward : lossReward;
    actor.money = Math.min(CONFIG.match.maxMoney, actor.money + reward);
  }
  pushEvent(state, { type: 'roundEnd', winner, reason });
}

function siteAt(state, x, z) {
  for (const site of Object.values(state.world.sites)) {
    if (x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ) return site.id;
  }
  return null;
}

function updateBomb(state, dt) {
  const bomb = state.bomb;
  // Pickup: a living Vanguard walking over the dropped charge takes it.
  if (bomb.state === 'dropped') {
    for (const actor of state.actors) {
      if (!actor.alive || actor.team !== TEAM.VANGUARD) continue;
      if (distance2D(actor.position.x, actor.position.z, bomb.x, bomb.z) < 1.2) {
        bomb.state = 'carried';
        bomb.carrier = actor;
        pushEvent(state, { type: 'bombPickup', actor });
        break;
      }
    }
  }
  // Plant channel.
  if (bomb.state === 'carried' && bomb.planter && bomb.planter.alive) {
    const planter = bomb.planter;
    const site = siteAt(state, planter.position.x, planter.position.z);
    const standing = Math.hypot(planter.velocity.x, planter.velocity.z) < 0.5;
    if (site && standing) {
      bomb.plantProgress += dt / CONFIG.bomb.plantTime;
      if (planter.isPlayer) {
        state.channel = { active: true, label: `PLANTING CHARGE — SITE ${site}`, progress: bomb.plantProgress };
      }
      if (bomb.plantProgress >= 1) {
        bomb.state = 'planted';
        bomb.site = site;
        bomb.x = planter.position.x;
        bomb.z = planter.position.z;
        bomb.fuseLeft = CONFIG.bomb.fuseTime;
        bomb.carrier = null;
        bomb.planter = null;
        planter.money = Math.min(CONFIG.match.maxMoney, planter.money + CONFIG.economy.plantReward);
        pushEvent(state, { type: 'bombPlanted', site, actor: planter });
      }
    } else {
      bomb.plantProgress = 0;
      bomb.planter = null;
    }
  } else {
    bomb.plantProgress = 0;
  }
  // Defuse channel.
  if (bomb.state === 'planted' && bomb.defuser && bomb.defuser.alive) {
    const defuser = bomb.defuser;
    const near = distance2D(defuser.position.x, defuser.position.z, bomb.x, bomb.z) < 2.2;
    const standing = Math.hypot(defuser.velocity.x, defuser.velocity.z) < 0.5;
    if (near && standing) {
      const defuseTime = defuser.loadout.kit ? CONFIG.bomb.defuseTime / 2 : CONFIG.bomb.defuseTime;
      bomb.defuseProgress += dt / defuseTime;
      if (defuser.isPlayer) {
        state.channel = { active: true, label: 'DEFUSING CHARGE', progress: bomb.defuseProgress };
      }
      if (bomb.defuseProgress >= 1) {
        bomb.state = 'defused';
        bomb.defuser = null;
        defuser.money = Math.min(CONFIG.match.maxMoney, defuser.money + CONFIG.economy.defuseReward);
        pushEvent(state, { type: 'bombDefused', actor: defuser });
        awardRound(state, TEAM.AEGIS, 'Charge defused');
        return;
      }
    } else {
      bomb.defuseProgress = 0;
      bomb.defuser = null;
    }
  } else {
    bomb.defuseProgress = 0;
  }
  if (!bomb.planter && !bomb.defuser) state.channel = null;
  // Fuse.
  if (bomb.state === 'planted') {
    bomb.fuseLeft -= dt;
    if (bomb.fuseLeft <= 0) {
      bomb.state = 'exploded';
      pushEvent(state, { type: 'explosion', x: bomb.x, y: 0.5, z: bomb.z, radius: CONFIG.bomb.blastRadius, big: true });
      for (const actor of aliveActors(state)) {
        const d = distance2D(actor.position.x, actor.position.z, bomb.x, bomb.z);
        if (d < CONFIG.bomb.blastRadius) {
          damageActor(state, actor, CONFIG.bomb.blastDamage * (1 - d / CONFIG.bomb.blastRadius * 0.5), 'body', null, true);
        }
      }
      awardRound(state, TEAM.VANGUARD, 'Charge detonated');
    }
  }
}

export function updateRounds(state, dt) {
  state.phaseTime += dt;
  if (state.phase === PHASE.FREEZE) {
    state.freezeLeft -= dt;
    if (state.freezeLeft <= 0) {
      state.phase = PHASE.LIVE;
      state.phaseTime = 0;
      state.buyOpen = false;
      pushEvent(state, { type: 'roundLive' });
    }
    return;
  }
  if (state.phase === PHASE.LIVE) {
    state.roundLeft -= dt;
    updateBomb(state, dt);
    if (state.phase !== PHASE.LIVE) return; // bomb events may have ended the round
    const vanguardAlive = teamAlive(state, TEAM.VANGUARD);
    const aegisAlive = teamAlive(state, TEAM.AEGIS);
    if (!aegisAlive) {
      awardRound(state, TEAM.VANGUARD, 'Aegis eliminated');
      return;
    }
    if (!vanguardAlive && state.bomb.state !== 'planted') {
      awardRound(state, TEAM.AEGIS, 'Vanguard eliminated');
      return;
    }
    if (state.roundLeft <= 0) {
      if (state.bomb.state === 'planted') {
        // The clock stops mattering once the charge is down; the fuse decides.
        state.roundLeft = 0;
      } else {
        awardRound(state, TEAM.AEGIS, 'Time expired');
      }
    }
    return;
  }
  if (state.phase === PHASE.ROUND_END) {
    state.roundEndLeft -= dt;
    if (state.roundEndLeft <= 0) {
      if (state.scores[TEAM.VANGUARD] >= CONFIG.match.roundsToWin
        || state.scores[TEAM.AEGIS] >= CONFIG.match.roundsToWin
        || state.round >= CONFIG.match.maxRounds) {
        state.phase = PHASE.MATCH_END;
        state.phaseTime = 0;
        pushEvent(state, { type: 'matchEnd' });
      } else {
        startRound(state);
      }
    }
  }
}

export function matchWinner(state) {
  if (state.scores[TEAM.VANGUARD] > state.scores[TEAM.AEGIS]) return TEAM.VANGUARD;
  if (state.scores[TEAM.AEGIS] > state.scores[TEAM.VANGUARD]) return TEAM.AEGIS;
  return null;
}
