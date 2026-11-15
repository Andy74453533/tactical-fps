// Gunfire. One hitscan path serves the player and the bots: a ray from the
// muzzle against the world's surfaces and every actor's hit meshes, nearest
// valid hit wins, damage falls off with distance and multiplies on the head.
// The view model is procedural geometry per weapon, with kick, bob, reload
// dip and a muzzle flash, all driven from the same weapon state.
import * as THREE from 'three';
import { WEAPONS, weaponDamageAt } from './config.js';
import { PALETTE } from './palette.js';
import { pushEvent } from './state.js';
import { damageActor, currentWeapon } from './actors.js';

const raycaster = new THREE.Raycaster();
const perturbed = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();

function perturbDirection(dir, spread, rng, out) {
  out.copy(dir);
  if (spread > 0) {
    right.set(1, 0, 0);
    if (Math.abs(dir.y) > 0.9) right.set(0, 0, 1);
    right.crossVectors(dir, right).normalize();
    up.crossVectors(right, dir).normalize();
    const a = rng.gauss(spread);
    const b = rng.gauss(spread);
    out.addScaledVector(right, a).addScaledVector(up, b).normalize();
  }
  return out;
}

// Fires one trigger pull (all pellets). Returns the hits for effects. The
// caller owns ammo, cooldown, recoil and sound; this owns the ray.
export function fireHitscan(state, hitList, shooter, origin, dir, def, spread) {
  const hits = [];
  raycaster.far = def.range;
  for (let p = 0; p < def.pellets; p += 1) {
    perturbDirection(dir, spread, state.rng, perturbed);
    raycaster.set(origin, perturbed);
    const found = raycaster.intersectObjects(hitList, false);
    let end = null;
    let endDistance = def.range;
    for (const hit of found) {
      const actor = hit.object.userData.actor;
      if (actor) {
        if (actor === shooter || !actor.alive) continue;
        if (actor.team === shooter.team) {
          // No friendly fire: a teammate's body stops the bullet harmlessly.
          end = hit.point;
          endDistance = hit.distance;
          break;
        }
        const part = hit.object.userData.part;
        const mult = part === 'head' ? def.headMult : part === 'legs' ? def.legsMult : 1;
        const damage = weaponDamageAt(def, hit.distance) * mult;
        damageActor(state, actor, damage, part, shooter);
        hits.push({ actor, part, distance: hit.distance, point: hit.point.clone(), damage });
        end = hit.point;
        endDistance = hit.distance;
        break;
      }
      end = hit.point;
      endDistance = hit.distance;
      pushEvent(state, { type: 'spark', x: hit.point.x, y: hit.point.y, z: hit.point.z });
      break;
    }
    if (!end) {
      end = new THREE.Vector3().copy(origin).addScaledVector(perturbed, def.range);
    }
    pushEvent(state, {
      type: 'tracer',
      fromX: origin.x, fromY: origin.y, fromZ: origin.z,
      toX: end.x, toY: end.y, toZ: end.z,
      team: shooter.team,
    });
    void endDistance;
  }
  return hits;
}

// Spread now: still base, plus movement, plus bloom from sustained fire,
// plus an airborne penalty. Standing still and tapping beats running and
// holding the trigger, which is the whole point of the gunplay.
export function currentSpread(def, speed, airborne, crouching, bloom) {
  let spread = def.spreadStill + bloom;
  spread += Math.min(1, speed / 5.2) * def.spreadMove;
  if (airborne) spread += 0.03;
  if (crouching) spread *= 0.8;
  return spread;
}

export function stepLoadout(loadout, dt) {
  loadout.cooldown = Math.max(0, loadout.cooldown - dt);
  loadout.flash = Math.max(0, loadout.flash - dt);
  loadout.bloom = Math.max(0, loadout.bloom - dt * 0.05);
  if (loadout.reloadLeft > 0) {
    loadout.reloadLeft = Math.max(0, loadout.reloadLeft - dt);
    if (loadout.reloadLeft === 0) {
      const weapon = currentWeapon(loadout);
      const need = weapon.def.mag - weapon.mag;
      const take = Math.min(need, weapon.reserve);
      weapon.mag += take;
      weapon.reserve -= take;
    }
  }
}

export function tryReload(loadout) {
  const weapon = currentWeapon(loadout);
  if (loadout.reloadLeft > 0 || weapon.mag === weapon.def.mag || weapon.reserve === 0) return false;
  loadout.reloadLeft = weapon.def.reload;
  return true;
}

export function tryFire(loadout) {
  const weapon = currentWeapon(loadout);
  if (loadout.reloadLeft > 0 || loadout.cooldown > 0) return null;
  if (weapon.mag <= 0) return 'empty';
  weapon.mag -= 1;
  loadout.cooldown = weapon.def.fireGap;
  loadout.flash = 0.055;
  loadout.bloom = Math.min(0.05, loadout.bloom + weapon.def.spreadBloom);
  return weapon;
}

// --- View models ------------------------------------------------------------

const VM_MATS = {
  body: new THREE.MeshStandardMaterial({ color: '#3d4148', roughness: 0.55, metalness: 0.15 }),
  grip: new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.8, metalness: 0.05 }),
  accent: new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.2 }),
  steel: new THREE.MeshStandardMaterial({ color: '#9aa2ac', roughness: 0.35, metalness: 0.3 }),
};

function vmBox(w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function buildGunModel(def) {
  const g = new THREE.Group();
  if (def.id === 'p9') {
    g.add(vmBox(0.06, 0.07, 0.26, 0, 0, -0.05, VM_MATS.body));
    g.add(vmBox(0.05, 0.12, 0.07, 0, -0.08, 0.06, VM_MATS.grip));
    g.add(vmBox(0.02, 0.03, 0.1, 0, 0.05, -0.16, VM_MATS.steel));
  } else if (def.id === 'k7') {
    g.add(vmBox(0.07, 0.09, 0.4, 0, 0, -0.05, VM_MATS.body));
    g.add(vmBox(0.04, 0.04, 0.2, 0, 0.02, -0.3, VM_MATS.steel));
    g.add(vmBox(0.05, 0.13, 0.07, 0, -0.09, 0.05, VM_MATS.grip));
    g.add(vmBox(0.05, 0.1, 0.06, 0, -0.07, -0.14, VM_MATS.grip));
    g.add(vmBox(0.02, 0.04, 0.06, 0, 0.07, -0.02, VM_MATS.accent));
  } else if (def.id === 'dmr7') {
    g.add(vmBox(0.07, 0.09, 0.55, 0, 0, -0.1, VM_MATS.body));
    g.add(vmBox(0.035, 0.035, 0.42, 0, 0.02, -0.5, VM_MATS.steel));
    g.add(vmBox(0.05, 0.13, 0.07, 0, -0.09, 0.08, VM_MATS.grip));
    g.add(vmBox(0.06, 0.07, 0.2, 0, -0.01, 0.22, VM_MATS.grip));
    g.add(vmBox(0.05, 0.05, 0.16, 0, 0.08, -0.08, VM_MATS.accent));
    g.add(vmBox(0.02, 0.02, 0.08, 0, 0.05, -0.28, VM_MATS.steel));
  } else if (def.id === 'm870') {
    g.add(vmBox(0.08, 0.09, 0.5, 0, 0, -0.08, VM_MATS.body));
    g.add(vmBox(0.05, 0.05, 0.4, 0, 0.03, -0.42, VM_MATS.steel));
    g.add(vmBox(0.045, 0.045, 0.34, 0, -0.045, -0.38, VM_MATS.steel));
    g.add(vmBox(0.06, 0.1, 0.2, 0, -0.03, 0.24, VM_MATS.grip));
  } else {
    g.add(vmBox(0.08, 0.1, 0.46, 0, 0, -0.06, VM_MATS.body));
    g.add(vmBox(0.04, 0.04, 0.3, 0, 0.02, -0.4, VM_MATS.steel));
    g.add(vmBox(0.05, 0.13, 0.07, 0, -0.09, 0.06, VM_MATS.grip));
    g.add(vmBox(0.05, 0.08, 0.14, 0, -0.06, -0.18, VM_MATS.grip));
    g.add(vmBox(0.06, 0.08, 0.2, 0, -0.01, 0.24, VM_MATS.grip));
    g.add(vmBox(0.02, 0.03, 0.05, 0, 0.07, -0.1, VM_MATS.accent));
  }
  return g;
}

export function createViewModel(camera) {
  const root = new THREE.Group();
  root.position.set(0.22, -0.18, -0.42);
  root.scale.setScalar(0.72);
  camera.add(root);
  // A small warm fill so the gun reads as gunmetal, not a black slab: the
  // scene has no environment map, so bare metal would go nearly black.
  const fillLight = new THREE.PointLight(new THREE.Color('#ffd9a0'), 1.4, 2.5);
  fillLight.position.set(0.1, 0.15, 0.1);
  root.add(fillLight);
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildGunModel(def);
    model.visible = false;
    root.add(model);
    models[def.id] = model;
  }
  const grenadeModel = new THREE.Group();
  const charge = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), VM_MATS.body);
  const pin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), VM_MATS.steel);
  pin.position.y = 0.07;
  grenadeModel.add(charge, pin);
  grenadeModel.visible = false;
  root.add(grenadeModel);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0, 0.02, -0.75);
  flash.visible = false;
  root.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffcf8a'), 0, 6);
  flashLight.position.set(0, 0, -0.6);
  root.add(flashLight);

  const vm = {
    kick: 0,
    bobPhase: 0,
    activeId: 'p9',
    grenadeShown: false,
    setWeapon(id) {
      vm.activeId = id;
      vm.grenadeShown = false;
      for (const [key, model] of Object.entries(models)) model.visible = key === id;
      grenadeModel.visible = false;
    },
    showGrenade(kind) {
      vm.grenadeShown = true;
      for (const model of Object.values(models)) model.visible = false;
      grenadeModel.visible = true;
      charge.material = kind === 'flash'
        ? new THREE.MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.5 })
        : kind === 'smoke'
          ? new THREE.MeshStandardMaterial({ color: '#7a828c', roughness: 0.6 })
          : VM_MATS.body;
    },
    pullTrigger() {
      vm.kick = 0.06;
    },
    step(dt, speed, reloading, reloadProgress) {
      vm.kick += (0 - vm.kick) * Math.min(1, dt * 16);
      vm.bobPhase += dt * (2 + speed * 1.4);
      const bob = Math.min(1, speed / 5) * 0.012;
      root.position.y = -0.18 + Math.abs(Math.sin(vm.bobPhase)) * bob;
      root.position.x = 0.22 + Math.sin(vm.bobPhase * 0.5) * bob * 0.5;
      root.position.z = -0.42 + vm.kick;
      root.rotation.x = vm.kick * 2.4;
      if (reloading) {
        root.rotation.x = -0.5 * Math.sin(reloadProgress * Math.PI);
        root.position.y -= 0.05 * Math.sin(reloadProgress * Math.PI);
      }
    },
    setFlash(visible) {
      flash.visible = visible;
      if (visible) flash.rotation.z += 1.7;
      flashLight.intensity = visible ? 20 : 0;
    },
  };
  vm.setWeapon('p9');
  return vm;
}
