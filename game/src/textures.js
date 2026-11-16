// Procedural textures, painted on canvases at load: no image files, no
// network. The map reuses a handful of them across all its geometry.
import * as THREE from 'three';
import { makeRng } from './rng.js';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function texture(c, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, size, rng, colors, count, maxR) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colors[Math.floor(rng.next() * colors.length)];
    const r = 1 + rng.next() * maxR;
    ctx.beginPath();
    ctx.arc(rng.next() * size, rng.next() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function makeSandTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(11);
  ctx.fillStyle = '#8a6f52';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, rng, ['#7a5f45', '#96795a', '#6e583f', '#a3865f'], 2600, 2.2);
  ctx.strokeStyle = 'rgba(60,45,30,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i += 1) {
    const y = rng.next() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + rng.range(-8, 8), size * 0.7, y + rng.range(-8, 8), size, y);
    ctx.stroke();
  }
  return texture(c, 10, 8);
}

export function makeConcreteTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(23);
  ctx.fillStyle = '#9a938a';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, rng, ['#8a837a', '#a89f94', '#7d766e'], 1800, 2.6);
  ctx.strokeStyle = 'rgba(70,66,60,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = 'rgba(90,80,66,0.10)';
    ctx.beginPath();
    ctx.arc(rng.next() * size, rng.next() * size, 18 + rng.next() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  return texture(c, 2, 2);
}

export function makeContainerTexture(base, stripe) {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(37);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x, 0, 5, size);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x + 5, 0, 3, size);
  }
  speckle(ctx, size, rng, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.08)'], 500, 2);
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 18, size, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('K-7', 14, 200);
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillText('RELAY FREIGHT', 14, 224);
  return texture(c, 1, 1);
}

export function makeCrateTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = makeRng(41);
  ctx.fillStyle = '#a07d4e';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#7d5f38';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, size - 16, size - 16);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(12, 12);
  ctx.lineTo(size - 12, size - 12);
  ctx.moveTo(size - 12, 12);
  ctx.lineTo(12, size - 12);
  ctx.stroke();
  for (let y = 0; y < size; y += 32) {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, y, size, 2);
  }
  speckle(ctx, size, rng, ['rgba(0,0,0,0.10)'], 300, 2);
  return texture(c, 1, 1);
}

export function makeHazardTexture() {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8c33a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#22252a';
  ctx.beginPath();
  for (let x = -size; x < size * 2; x += 32) {
    ctx.moveTo(x, size);
    ctx.lineTo(x + 16, 0);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 16, size);
    ctx.closePath();
  }
  ctx.fill();
  return texture(c, 4, 1);
}

// A painted ground letter for a bomb site: a big letter on a transparent
// tile, laid flat on the ground inside the site zone.
export function makeSiteLetterTexture(letter, color) {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(18, 18, size - 36, size - 36);
  ctx.fillStyle = color;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, size / 2, size / 2 + 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Dusk sky gradient: deep blue up top melting into ember orange at the
// horizon. Painted once, used as the scene background via a large sphere.
export function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#101826');
  g.addColorStop(0.45, '#27344a');
  g.addColorStop(0.68, '#7a5a52');
  g.addColorStop(0.8, '#e8824a');
  g.addColorStop(0.88, '#f0a45a');
  g.addColorStop(1, '#8a6f52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
