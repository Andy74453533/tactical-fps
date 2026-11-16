// Pooled effects: tracers, sparks, blood, smoke and explosions. Every pool
// is allocated once at boot and reused; the hot loop never creates objects.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_TRACERS = 24;
const MAX_SPRITES = 160;

function dotTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
  g.addColorStop(0, inner);
  g.addColorStop(0.5, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createParticles(scene) {
  const softTex = dotTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)');
  const smokeTex = dotTexture('rgba(220,218,210,0.9)', 'rgba(200,196,188,0.5)');

  // Tracers: one LineSegments with a fixed vertex buffer; each tracer owns
  // two vertices and a life, and dead tracers collapse to a point.
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: '#ffe9b0', transparent: true, opacity: 0.85 });
  const tracerLines = new THREE.LineSegments(tracerGeo, tracerMat);
  tracerLines.frustumCulled = false;
  scene.add(tracerLines);
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) tracers.push({ life: 0, index: i });

  // Sprites: one SpriteMaterial per sprite (colour differs), pooled.
  const sprites = [];
  for (let i = 0; i < MAX_SPRITES; i += 1) {
    const mat = new THREE.SpriteMaterial({ map: softTex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    sprites.push({
      sprite, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0,
      grow: 0, startScale: 1, fade: 1, gravity: 0,
    });
  }
  let spriteCursor = 0;

  function spawnSprite(x, y, z, opts) {
    const s = sprites[spriteCursor];
    spriteCursor = (spriteCursor + 1) % MAX_SPRITES;
    s.sprite.visible = true;
    s.sprite.position.set(x, y, z);
    s.sprite.material.map = opts.smoke ? smokeTex : softTex;
    s.sprite.material.color.set(opts.color);
    s.sprite.material.opacity = opts.opacity ?? 1;
    s.sprite.material.rotation = Math.random() * Math.PI * 2;
    s.life = opts.life;
    s.maxLife = opts.life;
    s.vx = opts.vx || 0;
    s.vy = opts.vy || 0;
    s.vz = opts.vz || 0;
    s.grow = opts.grow || 0;
    s.startScale = opts.scale || 0.2;
    s.fade = opts.fade ?? 1;
    s.gravity = opts.gravity ?? 0;
    s.sprite.scale.setScalar(s.startScale);
    return s;
  }

  let tracerCursor = 0;

  return {
    spawnTracer(from, to) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const o = t.index * 6;
      tracerPos[o] = from.x;
      tracerPos[o + 1] = from.y;
      tracerPos[o + 2] = from.z;
      tracerPos[o + 3] = to.x;
      tracerPos[o + 4] = to.y;
      tracerPos[o + 5] = to.z;
      t.life = 0.07;
      tracerGeo.attributes.position.needsUpdate = true;
    },
    spawnSparks(x, y, z, count, rng) {
      for (let i = 0; i < count; i += 1) {
        spawnSprite(x, y, z, {
          color: '#ffd9a0', life: 0.25 + rng.next() * 0.2, scale: 0.06 + rng.next() * 0.06,
          vx: (rng.next() - 0.5) * 6, vy: rng.next() * 4, vz: (rng.next() - 0.5) * 6,
          gravity: -12,
        });
      }
    },
    spawnBlood(x, y, z, rng) {
      for (let i = 0; i < 5; i += 1) {
        spawnSprite(x, y, z, {
          color: '#a8231a', life: 0.4 + rng.next() * 0.25, scale: 0.09 + rng.next() * 0.08,
          vx: (rng.next() - 0.5) * 3, vy: rng.next() * 2, vz: (rng.next() - 0.5) * 3,
          gravity: -9,
        });
      }
    },
    spawnSmokePuff(x, y, z, radius, rng) {
      for (let i = 0; i < 10; i += 1) {
        const a = rng.next() * Math.PI * 2;
        const r = rng.next() * radius * 0.7;
        spawnSprite(x + Math.cos(a) * r, y + rng.next() * 1.4, z + Math.sin(a) * r, {
          color: PALETTE.smoke, smoke: true, life: 2.5 + rng.next() * 2, scale: 1.2 + rng.next() * 1.2,
          vx: (rng.next() - 0.5) * 0.5, vy: 0.25 + rng.next() * 0.3, vz: (rng.next() - 0.5) * 0.5,
          grow: 0.55, opacity: 0.75, fade: 0.8,
        });
      }
    },
    spawnExplosion(x, y, z, rng) {
      spawnSprite(x, y + 0.4, z, {
        color: '#ff9a3a', life: 0.45, scale: 2.2, grow: 6, opacity: 1,
      });
      spawnSprite(x, y + 0.6, z, {
        color: '#ffd9a0', life: 0.3, scale: 1.4, grow: 5, opacity: 1,
      });
      for (let i = 0; i < 14; i += 1) {
        const a = rng.next() * Math.PI * 2;
        spawnSprite(x, y + 0.3, z, {
          color: i % 2 ? '#5a5348' : '#ff7a2a', life: 0.6 + rng.next() * 0.5,
          scale: 0.2 + rng.next() * 0.25,
          vx: Math.cos(a) * (3 + rng.next() * 6), vy: 2 + rng.next() * 5, vz: Math.sin(a) * (3 + rng.next() * 6),
          gravity: -10,
        });
      }
      for (let i = 0; i < 8; i += 1) {
        spawnSprite(x + (rng.next() - 0.5) * 2, y + 1 + rng.next(), z + (rng.next() - 0.5) * 2, {
          color: '#8a857c', smoke: true, life: 1.6 + rng.next(), scale: 1.4,
          vy: 1.2, grow: 1.1, opacity: 0.6,
        });
      }
    },
    spawnMuzzle(x, y, z, rng) {
      spawnSprite(x, y, z, {
        color: '#ffe9b0', life: 0.06, scale: 0.3 + rng.next() * 0.15, opacity: 0.95,
      });
    },
    step(dt) {
      let tracerDirty = false;
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          if (t.life <= 0) {
            const o = t.index * 6;
            tracerPos[o + 3] = tracerPos[o];
            tracerPos[o + 4] = tracerPos[o + 1];
            tracerPos[o + 5] = tracerPos[o + 2];
            tracerDirty = true;
          }
        }
      }
      if (tracerDirty) tracerGeo.attributes.position.needsUpdate = true;
      for (const s of sprites) {
        if (s.life <= 0) continue;
        s.life -= dt;
        if (s.life <= 0) {
          s.sprite.visible = false;
          continue;
        }
        s.vy += s.gravity * dt;
        s.sprite.position.x += s.vx * dt;
        s.sprite.position.y += s.vy * dt;
        s.sprite.position.z += s.vz * dt;
        if (s.sprite.position.y < 0.05) s.sprite.position.y = 0.05;
        const age = 1 - s.life / s.maxLife;
        s.sprite.scale.setScalar(s.startScale + s.grow * age * s.maxLife);
        s.sprite.material.opacity = Math.max(0, 1 - age * s.fade) * (s.fade === 1 ? 1 : 0.85);
      }
    },
  };
}
