// Grenades: a thrown charge with gravity, bounces, and a fuse. Frag kills
// in a radius through line of sight, flash blinds, smoke blocks sight.
import * as THREE from 'three';
import { GRENADE_DEFS } from './config.js';
import { pushEvent } from './state.js';
import { segmentBlocked } from './physics.js';
import { damageActor } from './actors.js';

const MESH_GEO = new THREE.SphereGeometry(0.09, 10, 8);
const MESH_MATS = {
  frag: new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.4 }),
  flash: new THREE.MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.5, metalness: 0.2 }),
  smoke: new THREE.MeshStandardMaterial({ color: '#7a828c', roughness: 0.6, metalness: 0.3 }),
};

export function throwGrenade(state, scene, actor, kind, origin, dir) {
  const def = GRENADE_DEFS[kind];
  const mesh = new THREE.Mesh(MESH_GEO, MESH_MATS[kind]);
  mesh.position.copy(origin);
  scene.add(mesh);
  const grenade = {
    kind,
    def,
    thrower: actor,
    mesh,
    position: origin.clone(),
    velocity: new THREE.Vector3().copy(dir).multiplyScalar(13).add(new THREE.Vector3(0, 3.2, 0)),
    fuse: def.fuse,
    rest: false,
  };
  state.grenades.push(grenade);
  return grenade;
}

function bounceAxis(grenade, colliders, axis) {
  const p = grenade.position;
  const r = 0.1;
  for (const c of colliders) {
    if (p.x > c.min.x - r && p.x < c.max.x + r
      && p.y > c.min.y - r && p.y < c.max.y + r
      && p.z > c.min.z - r && p.z < c.max.z + r) {
      grenade.velocity[axis] *= -0.42;
      if (axis === 'x') p.x = grenade.velocity.x > 0 ? c.max.x + r : c.min.x - r;
      if (axis === 'y') p.y = grenade.velocity.y > 0 ? c.max.y + r : c.min.y - r;
      if (axis === 'z') p.z = grenade.velocity.z > 0 ? c.max.z + r : c.min.z - r;
      grenade.velocity.multiplyScalar(0.82);
      return true;
    }
  }
  return false;
}

export function stepGrenades(state, scene, colliders, dt) {
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.fuse -= dt;
    if (!g.rest) {
      g.velocity.y -= 18 * dt;
      g.position.x += g.velocity.x * dt;
      bounceAxis(g, colliders, 'x');
      g.position.z += g.velocity.z * dt;
      bounceAxis(g, colliders, 'z');
      g.position.y += g.velocity.y * dt;
      if (g.position.y <= 0.1) {
        g.position.y = 0.1;
        if (Math.abs(g.velocity.y) > 1.6) {
          g.velocity.y *= -0.42;
          g.velocity.x *= 0.7;
          g.velocity.z *= 0.7;
        } else {
          g.velocity.set(0, 0, 0);
          g.rest = true;
        }
      } else {
        bounceAxis(g, colliders, 'y');
      }
      if (g.velocity.lengthSq() < 0.4 && g.position.y <= 0.12) {
        g.velocity.set(0, 0, 0);
        g.rest = true;
      }
      g.mesh.position.copy(g.position);
    }
    if (g.fuse <= 0) {
      detonate(state, g);
      scene.remove(g.mesh);
      state.grenades.splice(i, 1);
    }
  }
  for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
    state.smokes[i].life -= dt;
    if (state.smokes[i].life <= 0) state.smokes.splice(i, 1);
  }
}

function detonate(state, g) {
  const p = g.position;
  if (g.kind === 'frag') {
    pushEvent(state, { type: 'explosion', x: p.x, y: p.y, z: p.z, radius: g.def.radius });
    pushEvent(state, { type: 'noise', x: p.x, z: p.z, radius: 40 });
    for (const actor of state.actors) {
      if (!actor.alive) continue;
      const dx = actor.position.x - p.x;
      const dy = actor.position.y + 1 - p.y;
      const dz = actor.position.z - p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > g.def.radius) continue;
      // Blast needs a path: cover saves lives.
      if (segmentBlocked(p.x, p.y, p.z, actor.position.x, actor.position.y + 1, actor.position.z, state.colliders)) continue;
      const damage = g.def.damage * (1 - (dist / g.def.radius) * 0.75);
      damageActor(state, actor, damage, 'body', g.thrower, true);
    }
  } else if (g.kind === 'flash') {
    pushEvent(state, { type: 'flashPop', x: p.x, y: p.y, z: p.z, radius: g.def.radius });
    pushEvent(state, { type: 'noise', x: p.x, z: p.z, radius: 30 });
    for (const actor of state.actors) {
      if (!actor.alive) continue;
      const dx = actor.position.x - p.x;
      const dy = actor.position.y + actor.eye - p.y;
      const dz = actor.position.z - p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > g.def.radius) continue;
      if (segmentBlocked(p.x, p.y, p.z, actor.position.x, actor.position.y + actor.eye, actor.position.z, state.colliders)) continue;
      // Facing the pop matters: looking away halves the blind.
      const lookX = -Math.sin(actor.yaw);
      const lookZ = -Math.cos(actor.yaw);
      const facing = (dx * lookX + dz * lookZ) / Math.max(0.001, dist);
      const strength = (1 - dist / g.def.radius) * (facing > 0 ? 1 : 0.45);
      if (strength > 0.15) {
        actor.blind = Math.max(actor.blind, strength * 3.2);
      }
    }
  } else {
    state.smokes.push({ x: p.x, y: 1.1, z: p.z, radius: g.def.radius, life: g.def.life });
    pushEvent(state, { type: 'smoke', x: p.x, y: p.y, z: p.z });
  }
}
