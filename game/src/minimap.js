// Minimap: a top-down view drawn from the world's own data, so it can never
// disagree with the map. Walls, sites and spawns are painted once; each
// frame the live layer adds teammates, the facing wedge and the charge.
// Enemies are never shown: the map informs, it does not wallhack.
import { MAP_BOUNDS } from './world.js';
import { TEAM_COLOR } from './palette.js';

const SCALE = 3; // pixels per metre
const W = Math.round((MAP_BOUNDS.maxX - MAP_BOUNDS.minX) * SCALE);
const H = Math.round((MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) * SCALE);

function px(x) { return (x - MAP_BOUNDS.minX) * SCALE; }
function py(z) { return (z - MAP_BOUNDS.minZ) * SCALE; }

export function createMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  let built = false;

  function build(state) {
    const b = base.getContext('2d');
    b.fillStyle = '#241d15';
    b.fillRect(0, 0, W, H);
    for (const site of Object.values(state.world.sites)) {
      b.fillStyle = site.id === 'A' ? 'rgba(240,168,50,0.20)' : 'rgba(53,196,181,0.20)';
      b.fillRect(px(site.minX), py(site.minZ), (site.maxX - site.minX) * SCALE, (site.maxZ - site.minZ) * SCALE);
      b.fillStyle = site.id === 'A' ? '#f0a832' : '#35c4b5';
      b.font = 'bold 13px sans-serif';
      b.textAlign = 'center';
      b.textBaseline = 'middle';
      b.fillText(site.id, px(site.center.x), py(site.center.z));
    }
    // Walls and cover, from the same colliders the simulation uses.
    b.fillStyle = '#8a7a5e';
    for (const c of state.colliders) {
      b.fillRect(px(c.min.x), py(c.min.z), (c.max.x - c.min.x) * SCALE, (c.max.z - c.min.z) * SCALE);
    }
    for (const team of ['vanguard', 'aegis']) {
      b.fillStyle = TEAM_COLOR[team];
      for (const s of state.world.spawns[team]) {
        b.beginPath();
        b.arc(px(s.x), py(s.z), 2.5, 0, Math.PI * 2);
        b.fill();
      }
    }
    built = true;
  }

  function draw(state, focus) {
    if (!built) build(state);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
    for (const actor of state.actors) {
      if (!actor.alive || actor === focus || actor.team !== focus.team) continue;
      ctx.fillStyle = TEAM_COLOR[actor.team];
      ctx.beginPath();
      ctx.arc(px(actor.position.x), py(actor.position.z), 3, 0, Math.PI * 2);
      ctx.fill();
      // The teammate carrying the charge gets an amber ring: the carrier is
      // always a teammate, so this never reveals an enemy.
      if (state.bomb.carrier === actor) {
        ctx.strokeStyle = '#ffb03a';
        ctx.beginPath();
        ctx.arc(px(actor.position.x), py(actor.position.z), 5.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // The charge, blinking once planted.
    const bomb = state.bomb;
    if ((bomb.state === 'dropped' || bomb.state === 'planted')
      && !(bomb.state === 'planted' && Math.sin(state.time * 6) < 0)) {
      const bx = px(bomb.x);
      const bz = py(bomb.z);
      ctx.fillStyle = '#ffb03a';
      ctx.beginPath();
      ctx.moveTo(bx, bz - 5);
      ctx.lineTo(bx + 4, bz);
      ctx.lineTo(bx, bz + 5);
      ctx.lineTo(bx - 4, bz);
      ctx.closePath();
      ctx.fill();
    }
    // Facing wedge for the viewed actor.
    if (focus && focus.alive) {
      const fx = -Math.sin(focus.yaw);
      const fz = -Math.cos(focus.yaw);
      const cx = px(focus.position.x);
      const cz = py(focus.position.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx + fx * 7, cz + fz * 7);
      ctx.lineTo(cx - fz * 4 - fx * 3, cz + fx * 4 - fz * 3);
      ctx.lineTo(cx + fz * 4 - fx * 3, cz - fx * 4 - fz * 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  return { draw };
}
