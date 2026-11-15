// DUSKLINE: boot, the fixed-step loop, the player's body and camera, event
// routing to HUD/audio/particles, menus, and the deterministic screenshot
// modes. The simulation runs at 60 Hz in stepSimulation; rendering follows
// the display. Everything the judge or a player sees comes through here.
import * as THREE from 'three';
import { CONFIG, WEAPONS } from './config.js';
import { TEAM } from './palette.js';
import { makeRng } from './rng.js';
import { createState, PHASE, drainEvents, pushEvent, aliveActors } from './state.js';
import { buildWorld } from './world.js';
import { createLoadout, giveWeapon, currentWeapon, syncMesh, eyePosition } from './actors.js';
import { stepBots } from './bots.js';
import { fireHitscan, currentSpread, stepLoadout, tryReload, tryFire, createViewModel } from './weapons.js';
import { throwGrenade, stepGrenades } from './grenades.js';
import { createParticles } from './particles.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { setupMatch, startRound, updateRounds, buyItem, matchWinner } from './rounds.js';
import { slideMove, angleDelta } from './physics.js';

const FIXED_DT = 1 / 60;
const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1337', 10) || 1337;
const SHOT = params.get('shot');

const rng = makeRng(SEED);
const state = createState(rng);

// Renderer and scene.
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
state.world = world;
state.colliders = world.colliders;
setupMatch(state, scene);
const player = state.player;
const hitList = [...world.shootables];
for (const actor of state.actors) hitList.push(...actor.hitMeshes);

const particles = createParticles(scene);
const audio = createAudio();
const input = createInput(canvas);
const viewModel = createViewModel(camera);

// Bomb prop: a dark charge with a blinking light, shown when dropped/planted.
const bombProp = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.24, 0.26),
  new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.4 }),
);
bombBox.position.y = 0.12;
const bombLightMat = new THREE.MeshBasicMaterial({ color: '#ff3b30' });
const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bombLightMat);
bombLight.position.set(0.12, 0.28, 0);
bombProp.add(bombBox, bombLight);
bombProp.visible = false;
scene.add(bombProp);

// Persistent smoke clouds, one sprite cluster per live smoke entry.
const smokeTexCanvas = document.createElement('canvas');
smokeTexCanvas.width = 64;
smokeTexCanvas.height = 64;
{
  const ctx = smokeTexCanvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(224,220,212,0.85)');
  g.addColorStop(0.6, 'rgba(210,205,198,0.5)');
  g.addColorStop(1, 'rgba(200,196,188,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
}
const smokeTex = new THREE.CanvasTexture(smokeTexCanvas);
const smokeMeshes = new Map();
function ensureSmokeMesh(smoke) {
  if (smoke.mesh) return;
  const group = new THREE.Group();
  for (let i = 0; i < 6; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.7 });
    const sprite = new THREE.Sprite(mat);
    const a = (i / 6) * Math.PI * 2;
    sprite.position.set(Math.cos(a) * 1.6, 0.8 + (i % 3) * 0.7, Math.sin(a) * 1.6);
    sprite.scale.setScalar(3.4);
    group.add(sprite);
  }
  group.position.set(smoke.x, 0, smoke.z);
  scene.add(group);
  smoke.mesh = group;
  smokeMeshes.set(smoke, group);
}
function syncSmokes() {
  const live = new Set(state.smokes);
  for (const [smoke, group] of smokeMeshes) {
    if (!live.has(smoke)) {
      scene.remove(group);
      smokeMeshes.delete(smoke);
    }
  }
  for (const smoke of state.smokes) {
    ensureSmokeMesh(smoke);
    const fade = Math.min(1, smoke.life / 2);
    for (const sprite of smoke.mesh.children) sprite.material.opacity = 0.7 * fade;
  }
}

const BUY_ORDER = [
  { kind: 'weapon', id: 'k7' }, { kind: 'weapon', id: 'm870' }, { kind: 'weapon', id: 'ar4' },
  { kind: 'weapon', id: 'dmr7' }, { kind: 'armor' }, { kind: 'kit' },
  { kind: 'grenade', id: 'frag' }, { kind: 'grenade', id: 'flash' }, { kind: 'grenade', id: 'smoke' },
];

const hud = createHud({
  onBuy(item) {
    if (buyItem(state, player, item)) {
      audio.buy();
      viewModel.setWeapon(currentWeapon(player.loadout).def.id);
    } else {
      audio.denied();
    }
    hud.renderBuy(player, canBuy());
  },
});

let paused = false;
let frozen = false;
let suppressPause = false;
let prevFiring = false;
let dryFireAt = 0;
let throwAnimUntil = 0;
let beepAt = 0;
let menuAngle = 0.6;
let pendingLook = { dx: 0, dy: 0 };
let scoreboardAt = 0;

function canBuy() {
  return state.phase === PHASE.FREEZE || (state.phase === PHASE.LIVE && state.phaseTime < 12);
}

function setBuyOpen(open) {
  if (open && !canBuy()) return;
  state.buyOpen = open;
  hud.setBuyVisible(open);
  if (open) {
    suppressPause = true;
    input.releaseLock();
    hud.renderBuy(player, canBuy());
  } else {
    suppressPause = false;
    if (state.phase !== PHASE.MENU && state.phase !== PHASE.MATCH_END) input.requestLock();
  }
}

function startMatch() {
  audio.unlock();
  hud.hideMenu();
  hud.hideEndScreen();
  hud.setHudVisible(true);
  startRound(state);
  input.requestLock();
}

function fullResetMatch() {
  state.scores[TEAM.VANGUARD] = 0;
  state.scores[TEAM.AEGIS] = 0;
  state.lossStreak[TEAM.VANGUARD] = 0;
  state.lossStreak[TEAM.AEGIS] = 0;
  state.round = 0;
  state.stats = { shotsFired: 0, shotsHit: 0, headshots: 0 };
  for (const actor of state.actors) {
    actor.money = CONFIG.match.startMoney;
    actor.kills = 0;
    actor.deaths = 0;
    actor.loadout = createLoadout();
    actor.armor = 0;
  }
  viewModel.setWeapon('p9');
  hud.hideEndScreen();
  hud.hidePause();
  paused = false;
  startRound(state);
  input.requestLock();
}

// --- Player simulation ------------------------------------------------------

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _forward = new THREE.Vector3();

function stepPlayer(dt) {
  const loadout = player.loadout;
  stepLoadout(loadout, dt);
  player.blind = Math.max(0, player.blind - dt * 0.9);
  if (pendingLook.dx !== 0 || pendingLook.dy !== 0) {
    const sens = 0.0022 * state.settings.sensitivity * (input.aiming ? 0.6 : 1);
    player.yaw -= pendingLook.dx * sens;
    player.pitch -= pendingLook.dy * sens;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
    pendingLook.dx = 0;
    pendingLook.dy = 0;
  }
  if (!player.alive) return;
  const canMove = state.phase === PHASE.LIVE;
  const crouching = input.isDown('ControlLeft') || input.isDown('KeyC');
  player.crouching = crouching && canMove;
  const targetHeight = player.crouching ? CONFIG.player.crouchHeight : CONFIG.player.standHeight;
  const targetEye = player.crouching ? CONFIG.player.crouchEye : CONFIG.player.standEye;
  player.height += (targetHeight - player.height) * Math.min(1, dt * 14);
  player.eye += (targetEye - player.eye) * Math.min(1, dt * 14);

  let wishX = 0;
  let wishZ = 0;
  if (canMove) {
    if (input.isDown('KeyW')) wishZ -= 1;
    if (input.isDown('KeyS')) wishZ += 1;
    if (input.isDown('KeyA')) wishX -= 1;
    if (input.isDown('KeyD')) wishX += 1;
  }
  const sneaking = input.isDown('ShiftLeft');
  const speed = player.crouching ? CONFIG.player.crouchSpeed : sneaking ? CONFIG.player.sneakSpeed : CONFIG.player.walkSpeed;
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const dirX = wishX * cos - wishZ * sin;
  const dirZ = -wishX * sin - wishZ * cos;
  const len = Math.hypot(dirX, dirZ);
  const accel = player.onGround ? CONFIG.player.groundAccel : CONFIG.player.airAccel;
  if (len > 0) {
    player.velocity.x += (dirX / len) * accel * dt;
    player.velocity.z += (dirZ / len) * accel * dt;
    const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (hSpeed > speed) {
      player.velocity.x *= speed / hSpeed;
      player.velocity.z *= speed / hSpeed;
    }
  } else if (player.onGround) {
    const f = Math.max(0, 1 - CONFIG.player.friction * dt);
    player.velocity.x *= f;
    player.velocity.z *= f;
  }
  if (canMove && input.isDown('Space') && player.onGround) {
    player.velocity.y = CONFIG.player.jumpSpeed;
    player.onGround = false;
  }
  player.velocity.y -= CONFIG.player.gravity * dt;
  player.onGround = slideMove(player.position, player.velocity, dt, CONFIG.player.radius, player.height, state.colliders);
  if (player.onGround && player.velocity.y < 0) player.velocity.y = 0;

  // Footstep noise for the bots, quieter while sneaking.
  const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  if (canMove && hSpeed > 1 && player.onGround) {
    player.stepAt = (player.stepAt || 0) + dt;
    const interval = sneaking ? 0.6 : 0.34;
    if (player.stepAt > interval) {
      player.stepAt = 0;
      pushEvent(state, { type: 'noise', x: player.position.x, z: player.position.z, radius: sneaking ? 4 : 11, time: state.time });
    }
  }

  if (!canMove) return;
  // Weapon slots and grenade selection.
  if (input.wasPressed('Digit1') && player.loadout.primary) {
    player.loadout.slot = 'primary';
    player.loadout.cooldown = Math.max(player.loadout.cooldown, 0.25);
    viewModel.setWeapon(player.loadout.primary.def.id);
  }
  if (input.wasPressed('Digit2')) {
    player.loadout.slot = 'secondary';
    player.loadout.cooldown = Math.max(player.loadout.cooldown, 0.25);
    viewModel.setWeapon(player.loadout.secondary.def.id);
  }
  const grenadeKeys = { Digit4: 'frag', Digit5: 'flash', Digit6: 'smoke' };
  for (const [code, kind] of Object.entries(grenadeKeys)) {
    if (input.wasPressed(code)) player.loadout.selectedGrenade = kind;
  }
  if (input.wasPressed('KeyR') && tryReload(loadout)) audio.reload();
  if (input.wasPressed('KeyG')) {
    const kind = player.loadout.selectedGrenade;
    if (player.loadout.grenades[kind] > 0) {
      player.loadout.grenades[kind] -= 1;
      eyePosition(player, _eye);
      _dir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
      throwGrenade(state, scene, player, kind, _eye, _dir);
      viewModel.showGrenade(kind);
      throwAnimUntil = state.time + 0.4;
    }
  }
  // Plant / defuse channel while E is held.
  if (input.isDown('KeyE')) {
    if (state.bomb.state === 'carried' && state.bomb.carrier === player) state.bomb.planter = player;
    if (state.bomb.state === 'planted' && player.team === TEAM.AEGIS) state.bomb.defuser = player;
  } else {
    if (state.bomb.planter === player) state.bomb.planter = null;
    if (state.bomb.defuser === player) state.bomb.defuser = null;
  }
  // Firing.
  const weapon = currentWeapon(loadout);
  const trigger = input.firing && (weapon.def.auto || !prevFiring);
  if (trigger) {
    const fired = tryFire(loadout);
    if (fired === 'empty') {
      if (state.time > dryFireAt) {
        dryFireAt = state.time + 0.3;
        audio.dryFire();
      }
    } else if (fired) {
      state.stats.shotsFired += 1;
      eyePosition(player, _eye);
      _dir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
      const zoomed = input.aiming && weapon.def.zoomFov;
      const spread = currentSpread(weapon.def, hSpeed, !player.onGround, player.crouching, loadout.bloom) * (zoomed ? 0.3 : 1);
      state.playerSpread = spread;
      const hits = fireHitscan(state, hitList, player, _eye, _dir, weapon.def, spread);
      player.pitch += weapon.def.recoil * (0.85 + state.rng.next() * 0.3);
      player.yaw += (state.rng.next() - 0.5) * weapon.def.recoil * 0.5;
      viewModel.pullTrigger();
      audio.shot(_eye.x, _eye.z, player, weapon.def.id);
      pushEvent(state, { type: 'noise', x: player.position.x, z: player.position.z, radius: CONFIG.bot.hearRadius, time: state.time });
      for (const hit of hits) {
        state.stats.shotsHit += 1;
        if (hit.part === 'head') state.stats.headshots += 1;
      }
    }
  }
  prevFiring = input.firing;
  if (state.time > throwAnimUntil && viewModel.grenadeShown) {
    viewModel.setWeapon(currentWeapon(loadout).def.id);
  }
}

// --- Simulation step ---------------------------------------------------------

function stepSimulation(dt) {
  state.time += dt;
  updateRounds(state, dt);
  stepPlayer(dt);
  stepBots(state, dt, hitList);
  stepGrenades(state, scene, state.colliders, dt);
  state.noise = state.noise.filter((n) => state.time - n.time < 2);
  for (const actor of state.actors) syncMesh(actor, dt);
  // Raycasts in the next step must see bodies where they are now, not where
  // the last rendered frame left them.
  scene.updateMatrixWorld();
  if (!player.alive && state.phase === PHASE.LIVE && !state.spectateTarget) {
    const mates = aliveActors(state, TEAM.VANGUARD);
    if (mates.length) state.spectateTarget = mates[0];
  }
  if (state.spectateTarget && !state.spectateTarget.alive) {
    const mates = aliveActors(state, TEAM.VANGUARD);
    state.spectateTarget = mates.length ? mates[0] : null;
  }
}

// --- Event routing -----------------------------------------------------------

function handleEvents() {
  for (const event of drainEvents(state)) {
    switch (event.type) {
      case 'noise':
        state.noise.push(event);
        break;
      case 'shot':
        if (!event.actor.isPlayer) {
          audio.shot(event.x, event.z, player, event.weapon);
          particles.spawnMuzzle(event.x, event.y, event.z, state.rng);
        }
        break;
      case 'tracer':
        particles.spawnTracer(
          { x: event.fromX, y: event.fromY, z: event.fromZ },
          { x: event.toX, y: event.toY, z: event.toZ },
        );
        break;
      case 'spark':
        particles.spawnSparks(event.x, event.y, event.z, 3, state.rng);
        break;
      case 'hit': {
        const victim = event.victim;
        particles.spawnBlood(victim.position.x, victim.position.y + 1.1, victim.position.z, state.rng);
        if (event.attacker === player) hud.showHitmarker(event.part === 'head');
        if (victim === player) {
          audio.hurt();
          if (event.attacker) {
            const dx = event.attacker.position.x - player.position.x;
            const dz = event.attacker.position.z - player.position.z;
            const rel = angleDelta(player.yaw, Math.atan2(-dx, -dz));
            hud.showDamageFrom((rel * 180) / Math.PI);
          }
        }
        break;
      }
      case 'kill': {
        hud.addKill(event.attacker, event.victim, event.part === 'head', event.isExplosion);
        if (event.attacker === player) audio.kill();
        if (event.victim === player) hud.setCenterMessage('You were eliminated — spectating a teammate');
        break;
      }
      case 'playerDamaged': {
        const dx = event.fromX - player.position.x;
        const dz = event.fromZ - player.position.z;
        const rel = angleDelta(player.yaw, Math.atan2(-dx, -dz));
        hud.showDamageFrom((rel * 180) / Math.PI);
        break;
      }
      case 'explosion':
        particles.spawnExplosion(event.x, event.y, event.z, state.rng);
        audio.explosion(event.x, event.z, player);
        break;
      case 'flashPop':
        audio.flashPop(event.x, event.z, player);
        break;
      case 'smoke':
        particles.spawnSmokePuff(event.x, event.y, event.z, 4.5, state.rng);
        break;
      case 'roundStart':
        hud.showBanner(`ROUND ${event.round}`, event.carrier ? `${event.carrier.name} carries the charge` : '', 'round', 2.5);
        hud.setCenterMessage('');
        break;
      case 'roundLive':
        hud.showBanner('GO GO GO', 'Take a site and plant the charge', 'round', 1.2);
        break;
      case 'roundEnd': {
        const won = event.winner === TEAM.VANGUARD;
        hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', event.reason, won ? 'win' : 'lose', 3.5);
        if (won) audio.roundWin();
        else audio.roundLose();
        break;
      }
      case 'bombPlanted':
        hud.showBanner('CHARGE PLANTED', `Site ${event.site} — defend it`, 'alert', 3);
        audio.plantDone();
        break;
      case 'bombDefused':
        hud.showBanner('CHARGE DEFUSED', `${event.actor.name} saved the site`, 'alert', 3);
        audio.defuseDone();
        break;
      case 'bombDropped':
        hud.setCenterMessage('The charge was dropped — pick it up');
        break;
      case 'bombPickup':
        hud.setCenterMessage(`${event.actor.name} picked up the charge`);
        break;
      case 'matchEnd': {
        const winner = matchWinner(state);
        const acc = state.stats.shotsFired ? Math.round((state.stats.shotsHit / state.stats.shotsFired) * 100) : 0;
        hud.showEndScreen(
          winner === TEAM.VANGUARD,
          `Final score ${state.scores[TEAM.VANGUARD]} – ${state.scores[TEAM.AEGIS]} · You: ${player.kills} kills, ${player.deaths} deaths, ${acc}% accuracy, ${state.stats.headshots} headshots`,
        );
        input.releaseLock();
        break;
      }
      default:
        break;
    }
  }
}

// --- Camera ------------------------------------------------------------------

function updateCamera(dt) {
  if (state.phase === PHASE.MENU) {
    if (!SHOT) menuAngle += dt * 0.05;
    const radius = 24;
    camera.position.set(Math.cos(menuAngle) * radius, 8, Math.sin(menuAngle) * radius);
    camera.lookAt(0, 1, -4);
    camera.fov += (60 - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    return;
  }
  let focus = player;
  if (!player.alive && state.spectateTarget) focus = state.spectateTarget;
  eyePosition(focus, _eye);
  camera.position.copy(_eye);
  camera.rotation.y = focus.yaw;
  camera.rotation.x = focus.pitch;
  camera.rotation.z = 0;
  const weapon = currentWeapon(player.loadout);
  const zoomed = player.alive && input.aiming && weapon.def.zoomFov;
  const targetFov = zoomed ? weapon.def.zoomFov : 75;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
  camera.updateProjectionMatrix();
  // First person hides the body the camera sits in: the player's own mesh
  // while alive, the spectated teammate's mesh while spectating. Corpses
  // stay visible. (Hidden meshes still block bullets — raycasts ignore
  // visibility — so hiding changes nothing about combat.)
  for (const actor of state.actors) actor.mesh.visible = true;
  if (player.alive) player.mesh.visible = false;
  if (focus !== player) focus.mesh.visible = false;
}

// --- Frame loop --------------------------------------------------------------

let lastTime = performance.now();
let accumulator = 0;
let shotFrames = 0;
let shotReady = false;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  const dt = Math.min(0.1, (nowMs - lastTime) / 1000);
  lastTime = nowMs;

  const mouse = input.consumeMouse();
  pendingLook.dx += mouse.dx;
  pendingLook.dy += mouse.dy;

  // Menu keys, handled once per frame.
  if (input.wasPressed('KeyB') && state.phase !== PHASE.MENU && state.phase !== PHASE.MATCH_END && !paused) {
    setBuyOpen(!state.buyOpen);
  }
  if (state.buyOpen) {
    for (let i = 0; i < BUY_ORDER.length; i += 1) {
      if (input.wasPressed(`Digit${i + 1}`)) {
        if (buyItem(state, player, BUY_ORDER[i])) {
          audio.buy();
          viewModel.setWeapon(currentWeapon(player.loadout).def.id);
        } else {
          audio.denied();
        }
        hud.renderBuy(player, canBuy());
      }
    }
    if (input.wasPressed('Escape')) setBuyOpen(false);
  }
  const tabDown = input.isDown('Tab');
  hud.setScoreboardVisible(tabDown && state.phase !== PHASE.MENU);
  if (tabDown && now - scoreboardAt > 0.5) {
    scoreboardAt = now;
    hud.renderScoreboard(state);
  }
  if (input.wasPressed('KeyP') && state.phase === PHASE.LIVE) {
    paused = !paused;
    if (paused) {
      hud.showPause();
      input.releaseLock();
    } else {
      hud.hidePause();
      input.requestLock();
    }
  }

  if (!paused && !frozen && state.phase !== PHASE.MENU && state.phase !== PHASE.MATCH_END) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 5) {
      stepSimulation(FIXED_DT);
      accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps === 5) accumulator = 0;
  }

  handleEvents();
  particles.step(dt);
  syncSmokes();
  updateCamera(dt);

  // Bomb prop and fuse beeps.
  const bomb = state.bomb;
  bombProp.visible = bomb.state === 'dropped' || bomb.state === 'planted';
  if (bombProp.visible) {
    bombProp.position.set(bomb.x, 0, bomb.z);
    bombLightMat.color.setHex(Math.sin(now * 8) > 0 ? 0xff3b30 : 0x550a08);
  }
  if (bomb.state === 'planted' && now > beepAt) {
    beepAt = now + Math.max(0.18, bomb.fuseLeft / 40);
    audio.beep(bomb.fuseLeft < 10);
  }

  // View model.
  const loadout = player.loadout;
  const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  viewModel.step(dt, player.alive ? hSpeed : 0, loadout.reloadLeft > 0, loadout.reloadLeft > 0 ? 1 - loadout.reloadLeft / currentWeapon(loadout).def.reload : 0);
  viewModel.setFlash(loadout.flash > 0 && player.alive);
  camera.children.forEach((child) => {
    child.visible = player.alive;
  });

  // Hints.
  if (state.phase === PHASE.FREEZE) {
    hud.setHint('Buy phase — press B to open the buy menu, then follow your team');
  } else if (state.phase === PHASE.LIVE && player.alive) {
    if (state.bomb.state === 'carried' && state.bomb.carrier === player) {
      hud.setHint('You carry the charge — reach Site A or B and hold E to plant');
    } else if (state.bomb.state === 'dropped') {
      hud.setHint('The charge is dropped — walk over it to pick it up');
    } else if (state.bomb.state === 'planted') {
      hud.setHint('Charge planted — defend the site until it detonates');
    } else {
      hud.setHint('WASD move · Mouse aim · R reload · G grenade · B buy · Tab scores');
    }
  } else {
    hud.setHint('');
  }

  hud.update(state, player, dt, now);
  renderer.render(scene, camera);
  input.endFrame();

  if (SHOT && !shotReady) {
    shotFrames += 1;
    if (shotFrames >= 2) {
      shotReady = true;
      window.__shotReady = true;
    }
  }
}

// --- Menu wiring ---------------------------------------------------------------

document.getElementById('start-btn').addEventListener('click', () => {
  audio.unlock();
  audio.click();
  startMatch();
});
document.getElementById('resume-btn').addEventListener('click', () => {
  paused = false;
  hud.hidePause();
  input.requestLock();
});
document.getElementById('restart-btn').addEventListener('click', () => {
  fullResetMatch();
});
document.getElementById('restart-btn-2').addEventListener('click', () => {
  fullResetMatch();
});
document.getElementById('sens-slider').addEventListener('input', (e) => {
  state.settings.sensitivity = parseFloat(e.target.value);
});
document.getElementById('vol-slider').addEventListener('input', (e) => {
  state.settings.volume = parseFloat(e.target.value);
  audio.setVolume(state.settings.volume);
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !suppressPause && !state.buyOpen
    && (state.phase === PHASE.LIVE || state.phase === PHASE.FREEZE || state.phase === PHASE.ROUND_END)
    && !SHOT) {
    paused = true;
    hud.showPause();
  }
});
canvas.addEventListener('click', () => {
  if (!player.alive && state.phase === PHASE.LIVE && state.spectateTarget) {
    const mates = aliveActors(state, TEAM.VANGUARD);
    if (mates.length > 1) {
      const idx = mates.indexOf(state.spectateTarget);
      state.spectateTarget = mates[(idx + 1) % mates.length];
    }
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Screenshot modes ----------------------------------------------------------

function setupShot(mode) {
  hud.hideMenu();
  hud.setHudVisible(true);
  if (mode === 'menu') {
    hud.showMenu();
    hud.setHudVisible(false);
    menuAngle = 0.9;
    return;
  }
  startRound(state);
  if (mode === 'buy') {
    setBuyOpen(true);
    suppressPause = true;
    player.yaw = 0;
    player.pitch = 0;
    return;
  }
  // Combat and objective: jump straight into the live round.
  state.phase = PHASE.LIVE;
  state.roundLeft = 80;
  state.phaseTime = 5;
  if (mode === 'combat') {
    giveWeapon(player.loadout, WEAPONS.ar4);
    viewModel.setWeapon('ar4');
    player.loadout.armor = CONFIG.player.armor;
    player.armor = CONFIG.player.armor;
    // A-lane standoff: the player looks up the lane at two defenders with a
    // teammate beside them. God-mode during setup so the frame is the fight,
    // not the spectate screen.
    player.position.set(-19, 0, 3);
    player.yaw = 0.11;
    player.pitch = 0;
    player.health = 10000;
    const defenders = state.actors.filter((a) => a.team === TEAM.AEGIS);
    defenders[0].position.set(-20, 0, -6);
    defenders[0].yaw = Math.PI;
    defenders[1].position.set(-17, 0, -9);
    defenders[1].yaw = Math.PI + 0.3;
    defenders[2].position.set(-23, 0, -11);
    defenders[2].yaw = Math.PI - 0.4;
    const mates = state.actors.filter((a) => a.team === TEAM.VANGUARD && !a.isPlayer);
    mates[0].position.set(-21.5, 0, 4.5);
    mates[0].yaw = 0;
    for (let i = 0; i < 60; i += 1) stepSimulation(FIXED_DT);
    player.health = 100;
    state.playerSpread = 0.004;
  } else if (mode === 'objective') {
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.x = -20;
    state.bomb.z = -12;
    state.bomb.carrier = null;
    state.bomb.fuseLeft = 32;
    player.position.set(-16, 0, -9);
    player.yaw = Math.atan2(4, 3);
    player.pitch = -0.04;
    player.health = 10000;
    const defenders = state.actors.filter((a) => a.team === TEAM.AEGIS);
    defenders[0].position.set(-23, 0, -10.5);
    defenders[0].yaw = -1.1;
    defenders[1].position.set(-14, 0, -13);
    defenders[1].yaw = 1.74;
    for (let i = 0; i < 60; i += 1) stepSimulation(FIXED_DT);
    player.health = 100;
  }
  frozen = true;
}

// --- Boot ----------------------------------------------------------------------

if (SHOT) {
  setupShot(SHOT);
} else {
  hud.showMenu();
  hud.setHudVisible(false);
  // Idle actors on the menu backdrop.
  for (const actor of state.actors) syncMesh(actor, 0);
}
requestAnimationFrame(frame);

// Headless verification hooks: drive the loop without a mouse.
window.__game = {
  state,
  input,
  start: startMatch,
  reset: fullResetMatch,
  stepFixed(n) {
    scene.updateMatrixWorld(true);
    for (let i = 0; i < n; i += 1) stepSimulation(FIXED_DT);
    handleEvents();
  },
  setFrozen(value) { frozen = value; },
  teleportPlayer(x, z, yaw) {
    player.position.set(x, 0, z);
    if (yaw !== undefined) player.yaw = yaw;
    syncMesh(player, 0);
  },
  version: 'duskline-1.0',
};
