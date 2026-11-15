// Collision and line-of-sight. The map is a list of axis-aligned boxes; every
// mover is an axis-aligned box too, resolved one axis at a time so a wall
// never swallows an actor. Line of sight is a slab test against the same
// boxes, which keeps bot vision cheap and allocation-free.
import * as THREE from 'three';

const probe = new THREE.Box3();

function overlapsBox(x, y, z, radius, height, lift, colliders) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

export function bodyOverlaps(x, y, z, radius, height, colliders) {
  return overlapsBox(x, y, z, radius, height, 0.02, colliders) !== null;
}

// Moves position by velocity * dt with gravity handled by the caller through
// velocity.y. Returns true when the actor is standing on something. The
// caller owns velocity; this function only resolves contacts.
export function slideMove(position, velocity, dt, radius, height, colliders) {
  const nextX = position.x + velocity.x * dt;
  if (!overlapsBox(nextX, position.y, position.z, radius, height, 0.04, colliders)) {
    position.x = nextX;
  } else {
    velocity.x = 0;
  }
  const nextZ = position.z + velocity.z * dt;
  if (!overlapsBox(position.x, position.y, nextZ, radius, height, 0.04, colliders)) {
    position.z = nextZ;
  } else {
    velocity.z = 0;
  }
  position.y += velocity.y * dt;
  let onGround = false;
  const hit = overlapsBox(position.x, position.y, position.z, radius, height, 0, colliders);
  if (hit) {
    if (velocity.y <= 0) {
      position.y = hit.max.y;
      velocity.y = 0;
      onGround = true;
    } else {
      position.y = hit.min.y - height;
      velocity.y = 0;
    }
  }
  if (position.y <= 0) {
    position.y = 0;
    if (velocity.y < 0) velocity.y = 0;
    onGround = true;
  }
  return onGround;
}

// True when the segment a->b crosses any collider. Used for sight checks and
// for deciding whether an explosion's blast reaches an actor.
export function segmentBlocked(ax, ay, az, bx, by, bz, colliders) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    let tmin = 0;
    let tmax = 1;
    if (dx === 0) {
      if (ax < c.min.x || ax > c.max.x) continue;
    } else {
      let t1 = (c.min.x - ax) / dx;
      let t2 = (c.max.x - ax) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (dy === 0) {
      if (ay < c.min.y || ay > c.max.y) continue;
    } else {
      let t1 = (c.min.y - ay) / dy;
      let t2 = (c.max.y - ay) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (dz === 0) {
      if (az < c.min.z || az > c.max.z) continue;
    } else {
      let t1 = (c.min.z - az) / dz;
      let t2 = (c.max.z - az) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

// True when the segment passes through any smoke cloud. Smoke is a list of
// {x, y, z, radius}; a segment counts as blocked when it comes within a
// cloud's radius, which is how a smoke wall hides movement.
export function segmentSmoked(ax, ay, az, bx, by, bz, clouds) {
  for (let i = 0; i < clouds.length; i += 1) {
    const c = clouds[i];
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const lenSq = dx * dx + dy * dy + dz * dz;
    let t = lenSq === 0 ? 0 : ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - c.x;
    const py = ay + dy * t - c.y;
    const pz = az + dz * t - c.z;
    if (px * px + py * py + pz * pz < c.radius * c.radius) return true;
  }
  return false;
}

export function distance2D(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

// Angle in [-PI, PI] between two headings, for turning an actor toward a
// target along the shortest arc.
export function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
