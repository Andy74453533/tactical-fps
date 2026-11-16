// Actors: player and bots share one body — position, velocity, health,
// armour, loadout, and a stylised mesh with separate head/body/leg hit
// meshes so damage can tell a headshot from a graze.
import * as THREE from 'three';
import { CONFIG, WEAPONS } from './config.js';
import { TEAM_COLOR } from './palette.js';
import { pushEvent } from './state.js';

const BODY_GEO = new THREE.BoxGeometry(0.52, 0.72, 0.3);
const HEAD_GEO = new THREE.SphereGeometry(0.21, 14, 10);
const LEGS_GEO = new THREE.BoxGeometry(0.42, 0.62, 0.26);
const ARM_GEO = new THREE.BoxGeometry(0.13, 0.5, 0.13);
const GUN_GEO = new THREE.BoxGeometry(0.09, 0.12, 0.62);
const HELMET_GEO = new THREE.SphereGeometry(0.23, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const VISOR_GEO = new THREE.BoxGeometry(0.3, 0.08, 0.05);

const sharedMats = {};
function teamMaterials(team) {
  if (!sharedMats[team]) {
    sharedMats[team] = {
      suit: new THREE.MeshStandardMaterial({ color: team === 'vanguard' ? '#5a4a33' : '#37424a', roughness: 0.9 }),
      vest: new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: '#26282c', roughness: 0.7, metalness: 0.3 }),
      skin: new THREE.MeshStandardMaterial({ color: '#c9a184', roughness: 0.8 }),
    };
  }
  return sharedMats[team];
}

export function createLoadout() {
  return {
    primary: null,
    secondary: { def: WEAPONS.p9, mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve },
    slot: 'secondary',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    selectedGrenade: 'frag',
    armor: 0,
    kit: false,
    cooldown: 0,
    reloadLeft: 0,
    bloom: 0,
    flash: 0,
  };
}

export function currentWeapon(loadout) {
  return loadout.slot === 'primary' && loadout.primary ? loadout.primary : loadout.secondary;
}

export function giveWeapon(loadout, def) {
  const entry = { def, mag: def.mag, reserve: def.reserve };
  if (def.slot === 'primary') {
    loadout.primary = entry;
    loadout.slot = 'primary';
  } else {
    loadout.secondary = entry;
    loadout.slot = 'secondary';
  }
  loadout.cooldown = 0;
  loadout.reloadLeft = 0;
  loadout.bloom = 0;
  return entry;
}

export function createActor(scene, { id, name, team, isPlayer, spawn }) {
  const mats = teamMaterials(team);
  const mesh = new THREE.Group();
  const legs = new THREE.Mesh(LEGS_GEO, mats.suit);
  legs.position.y = 0.31;
  const body = new THREE.Mesh(BODY_GEO, mats.vest);
  body.position.y = 0.98;
  const head = new THREE.Mesh(HEAD_GEO, mats.skin);
  head.position.y = 1.52;
  const helmet = new THREE.Mesh(HELMET_GEO, mats.dark);
  helmet.position.y = 1.55;
  const visor = new THREE.Mesh(VISOR_GEO, mats.dark);
  visor.position.set(0, 1.54, -0.19);
  const armL = new THREE.Mesh(ARM_GEO, mats.suit);
  armL.position.set(-0.32, 1.0, -0.1);
  armL.rotation.x = -1.1;
  const armR = new THREE.Mesh(ARM_GEO, mats.suit);
  armR.position.set(0.32, 1.0, -0.1);
  armR.rotation.x = -1.1;
  const gun = new THREE.Mesh(GUN_GEO, mats.dark);
  gun.position.set(0.18, 1.12, -0.42);
  mesh.add(legs, body, head, helmet, visor, armL, armR, gun);
  mesh.position.set(spawn.x, 0, spawn.z);
  mesh.rotation.y = spawn.yaw;
  scene.add(mesh);

  const actor = {
    id,
    name,
    team,
    isPlayer: Boolean(isPlayer),
    mesh,
    hitMeshes: [head, body, legs],
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    eye: CONFIG.player.standEye,
    height: CONFIG.player.standHeight,
    crouching: false,
    onGround: true,
    alive: true,
    health: CONFIG.player.health,
    armor: 0,
    money: CONFIG.match.startMoney,
    kills: 0,
    deaths: 0,
    loadout: createLoadout(),
    spawn,
    walkPhase: 0,
    deathTime: 0,
    blind: 0,
    // Bot-only fields, filled by bots.js.
    bot: null,
    // Muzzle world position, refreshed by syncMesh.
    muzzle: new THREE.Vector3(),
  };
  head.userData.actor = actor;
  head.userData.part = 'head';
  body.userData.actor = actor;
  body.userData.part = 'body';
  legs.userData.actor = actor;
  legs.userData.part = 'legs';
  actor.parts = { head, body, legs, gun, armL, armR };
  return actor;
}

export function resetActor(actor) {
  actor.position.set(actor.spawn.x, 0, actor.spawn.z);
  actor.velocity.set(0, 0, 0);
  actor.yaw = actor.spawn.yaw;
  actor.pitch = 0;
  actor.alive = true;
  actor.health = CONFIG.player.health;
  actor.armor = actor.loadout.armor > 0 ? CONFIG.player.armor : 0;
  actor.crouching = false;
  actor.height = CONFIG.player.standHeight;
  actor.eye = CONFIG.player.standEye;
  actor.blind = 0;
  actor.mesh.visible = true;
  actor.mesh.rotation.set(0, actor.yaw, 0);
  actor.mesh.position.copy(actor.position);
  if (actor.bot) actor.bot.reset();
}

// Armour absorbs half the damage and loses one point per two absorbed.
export function damageActor(state, victim, rawDamage, part, attacker, isExplosion = false) {
  if (!victim.alive) return 0;
  let damage = rawDamage;
  if (victim.armor > 0 && !isExplosion) {
    const absorbed = Math.min(victim.armor, damage * 0.5);
    victim.armor -= absorbed;
    damage -= absorbed;
  }
  damage = Math.max(1, Math.round(damage));
  victim.health -= damage;
  if (victim.health <= 0) {
    victim.health = 0;
    victim.alive = false;
    victim.deathTime = state.time;
    victim.mesh.rotation.z = Math.PI / 2;
    victim.mesh.position.y = 0.25;
    if (attacker && attacker !== victim) {
      attacker.kills += 1;
      attacker.money = Math.min(CONFIG.match.maxMoney, attacker.money + CONFIG.economy.killReward);
    }
    victim.deaths += 1;
    pushEvent(state, { type: 'kill', victim, attacker, part, damage, isExplosion });
    if (state.bomb.carrier === victim) {
      state.bomb.state = 'dropped';
      state.bomb.carrier = null;
      state.bomb.x = victim.position.x;
      state.bomb.z = victim.position.z;
      pushEvent(state, { type: 'bombDropped', x: state.bomb.x, z: state.bomb.z });
    }
  } else {
    pushEvent(state, { type: 'hit', victim, attacker, part, damage });
  }
  return damage;
}

// Moves the visible mesh onto the simulated body. Bots lean and bob.
export function syncMesh(actor, dt) {
  const mesh = actor.mesh;
  if (!actor.alive) return;
  mesh.position.set(actor.position.x, actor.position.y, actor.position.z);
  mesh.rotation.y = actor.yaw;
  const speed = Math.hypot(actor.velocity.x, actor.velocity.z);
  actor.walkPhase += dt * (2 + speed * 1.6);
  const bob = Math.min(1, speed / 5) * 0.03;
  mesh.position.y += Math.abs(Math.sin(actor.walkPhase)) * bob;
  mesh.rotation.x = actor.crouching ? 0.18 : 0;
  const gun = actor.parts.gun;
  gun.position.y = 1.12 - (actor.crouching ? 0.35 : 0);
  actor.muzzle.set(
    actor.position.x - Math.sin(actor.yaw) * 0.7,
    actor.position.y + actor.eye - 0.12,
    actor.position.z - Math.cos(actor.yaw) * 0.7,
  );
}

export function eyePosition(actor, out) {
  out.set(actor.position.x, actor.position.y + actor.eye, actor.position.z);
  return out;
}
