// Relay K-7: an original three-lane map. Vanguard spawns south, Aegis north;
// Site A west, Site B east, a connector building with a mid window joining
// the lanes. Boxes become meshes and colliders; a waypoint graph drives bots.
import * as THREE from 'three';
import { PALETTE, TEAM } from './palette.js';
import {
  makeSandTexture,
  makeConcreteTexture,
  makeContainerTexture,
  makeCrateTexture,
  makeHazardTexture,
  makeSiteLetterTexture,
  makeSkyTexture,
} from './textures.js';

export const MAP_BOUNDS = { minX: -28, maxX: 28, minZ: -22, maxZ: 22 };

export const SITES = {
  A: { id: 'A', minX: -26, maxX: -13, minZ: -20, maxZ: -9, center: { x: -20, z: -14.5 } },
  B: { id: 'B', minX: 13, maxX: 26, minZ: -20, maxZ: -9, center: { x: 20, z: -14.5 } },
};

export const SPAWNS = {
  [TEAM.VANGUARD]: [
    { x: 0, z: 18, yaw: 0 },
    { x: -3, z: 19, yaw: 0 },
    { x: 3, z: 19, yaw: 0 },
    { x: -5.5, z: 17, yaw: 0 },
    { x: 5.5, z: 17, yaw: 0 },
  ],
  [TEAM.AEGIS]: [
    { x: 0, z: -18, yaw: Math.PI },
    { x: -3, z: -19, yaw: Math.PI },
    { x: 3, z: -19, yaw: Math.PI },
    { x: -5.5, z: -17, yaw: Math.PI },
    { x: 5.5, z: -17, yaw: Math.PI },
  ],
};

// Waypoint graph: nodes the bots walk between, edges they may use. Every
// lane, doorway and site is on the graph.
export const NAV_NODES = [
  { x: 0, z: 18 }, { x: -8, z: 16 }, { x: 8, z: 16 },
  { x: -14, z: 13 }, { x: 14, z: 13 }, { x: -19, z: 8 }, { x: 19, z: 8 },
  { x: -21, z: 1 }, { x: 21, z: 1 }, { x: -20, z: -6 }, { x: 20, z: -6 },
  { x: -20, z: -13 }, { x: 20, z: -13 }, { x: -24, z: -17 }, { x: 24, z: -17 },
  { x: 0, z: 12 }, { x: 0, z: 7 }, { x: 0, z: 1 }, { x: 0, z: -5 },
  { x: 0, z: -11 }, { x: -9, z: 0 }, { x: 9, z: 0 }, { x: -12, z: -8 },
  { x: 12, z: -8 }, { x: -8, z: -14 }, { x: 8, z: -14 }, { x: 0, z: -17 },
  { x: -4, z: -18 }, { x: 4, z: -18 }, { x: -16, z: -17 }, { x: 16, z: -17 },
];

const NAV_EDGES = [
  [0, 1], [0, 2], [0, 15], [1, 3], [2, 4], [1, 15], [2, 15],
  [3, 5], [4, 6], [3, 20], [4, 21], [5, 7], [6, 8], [5, 20], [6, 21],
  [7, 9], [8, 10], [7, 20], [8, 21], [9, 11], [10, 12], [9, 22], [10, 23],
  [11, 13], [12, 14], [11, 29], [12, 30], [13, 29], [14, 30],
  [15, 16], [16, 17], [17, 18], [18, 19], [19, 26], [19, 24], [19, 25],
  [24, 11], [25, 12], [24, 22], [25, 23], [20, 17], [21, 17], [20, 22], [21, 23],
  [26, 27], [26, 28], [27, 24], [28, 25], [27, 29], [28, 30],
];

export const NAV_ADJACENCY = NAV_NODES.map(() => []);
for (const [a, b] of NAV_EDGES) {
  NAV_ADJACENCY[a].push(b);
  NAV_ADJACENCY[b].push(a);
}

// Defender hold spots: where to stand and what to watch.
export const HOLD_SPOTS = {
  A: [
    { x: -24.5, z: -17.5, lookX: -17, lookZ: -10 },
    { x: -20, z: -5, lookX: -20, lookZ: 3 },
  ],
  B: [
    { x: 22.5, z: -16, lookX: 17, lookZ: -10 },
    { x: 20, z: -5, lookX: 20, lookZ: 3 },
  ],
  MID: [
    { x: 0, z: -11, lookX: 0, lookZ: -3 },
  ],
};

export function buildWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const sandTex = makeSandTexture();
  const concreteTex = makeConcreteTexture();
  const containerATex = makeContainerTexture('#b4552d', '#e8c33a');
  const containerBTex = makeContainerTexture('#3f6d6a', '#e8e2d4');
  const crateTex = makeCrateTexture();
  const hazardTex = makeHazardTexture();

  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9, metalness: 0.02 }),
    wallDark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.55, metalness: 0.5 }),
    metalDark: new THREE.MeshStandardMaterial({ color: PALETTE.metalDark, roughness: 0.6, metalness: 0.45 }),
    containerA: new THREE.MeshStandardMaterial({ map: containerATex, roughness: 0.7, metalness: 0.25 }),
    containerB: new THREE.MeshStandardMaterial({ map: containerBTex, roughness: 0.7, metalness: 0.25 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85, metalness: 0.05 }),
    sandbag: new THREE.MeshStandardMaterial({ color: PALETTE.sandbag, roughness: 1, metalness: 0 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8, metalness: 0.05 }),
  };

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function flat(w, d, x, z, mat, y = 0.02) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mats[mat]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Ground and perimeter.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(62, 50), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  box(58, 5, 1, 0, 2.5, -22.5, 'wall');
  box(58, 5, 1, 0, 2.5, 22.5, 'wall');
  box(1, 5, 46, -28.5, 2.5, 0, 'wall');
  box(1, 5, 46, 28.5, 2.5, 0, 'wall');
  box(58, 0.5, 1.4, 0, 5.2, -22.5, 'wallDark', false);
  box(58, 0.5, 1.4, 0, 5.2, 22.5, 'wallDark', false);

  // Connector building (mid): north wall with a centre door, south wall with
  // two doors, solid side walls, two pillars inside.
  box(5, 4.4, 0.6, -3.5, 2.2, -2, 'concrete');
  box(5, 4.4, 0.6, 3.5, 2.2, -2, 'concrete');
  box(2, 4.4, 0.6, -5, 2.2, 4, 'concrete');
  box(4, 4.4, 0.6, 0, 2.2, 4, 'concrete');
  box(2, 4.4, 0.6, 5, 2.2, 4, 'concrete');
  box(0.6, 4.4, 6.6, -6, 2.2, 1, 'concrete');
  box(0.6, 4.4, 6.6, 6, 2.2, 1, 'concrete');
  box(1, 4.4, 1, -3, 2.2, 1, 'concrete');
  box(1, 4.4, 1, 3, 2.2, 1, 'concrete');
  flat(2.4, 1, 0, -2, 'hazard', 0.03);
  flat(2.4, 1, -3, 4, 'hazard', 0.03);
  flat(2.4, 1, 3, 4, 'hazard', 0.03);

  // Mid window wall: a gap to shoot through at head height.
  box(3, 4.4, 0.6, -2.5, 2.2, -8, 'wall');
  box(3, 4.4, 0.6, 2.5, 2.2, -8, 'wall');
  box(2, 1.1, 0.6, 0, 0.55, -8, 'wall');
  box(2, 2.2, 0.6, 0, 3.3, -8, 'wall');

  // Site A: container, crates, sandbags.
  box(6, 2.6, 2.4, -20, 1.3, -15, 'containerA');
  box(1.2, 1.2, 1.2, -16, 0.6, -12, 'crate');
  box(1.2, 1.2, 1.2, -24, 0.6, -12, 'crate');
  box(1.2, 1.2, 1.2, -22, 0.6, -18, 'crate');
  box(1.2, 1.2, 1.2, -22, 1.8, -18, 'crate');
  box(4, 1.1, 0.8, -17, 0.55, -18.5, 'sandbag');
  box(1, 4, 1, -14, 2, -10, 'concrete');

  // Site B: container yard and a silo.
  box(6, 2.6, 2.4, 18, 1.3, -16, 'containerB');
  box(2.4, 2.6, 6, 23.5, 1.3, -12, 'containerA');
  box(1.2, 1.2, 1.2, 16, 0.6, -11, 'crate');
  box(1.2, 1.2, 1.2, 24, 0.6, -18.5, 'crate');
  box(4, 1.1, 0.8, 17, 0.55, -12, 'sandbag');
  box(3, 6, 3, 25, 3, -19.5, 'metalDark');

  // Mid and lane cover (kept off the waypoint lines so bots never wedge).
  box(1.2, 1.2, 1.2, 2.8, 0.6, 8, 'crate');
  box(1.2, 1.2, 1.2, 3.4, 0.6, 11, 'crate');
  box(1.2, 1.2, 1.2, -3.4, 0.6, 11, 'crate');
  box(1.2, 1.2, 1.2, -2.5, 0.6, -11.5, 'crate');
  box(1.2, 1.2, 1.2, 2.5, 0.6, -11.5, 'crate');
  box(1.2, 1.2, 1.2, -22.5, 0.6, 6, 'crate');
  box(1.2, 1.2, 1.2, -22, 0.6, 0, 'crate');
  box(3, 1.1, 0.8, -18, 0.55, 12, 'sandbag');
  box(1.2, 1.2, 1.2, 22.5, 0.6, 6, 'crate');
  box(1.2, 1.2, 1.2, 22, 0.6, 0, 'crate');
  box(3, 1.1, 0.8, 18, 0.55, 12, 'sandbag');
  box(3, 1.1, 0.8, -4, 0.55, 15.5, 'sandbag');
  box(3, 1.1, 0.8, 4, 0.55, 15.5, 'sandbag');

  // Barrels (cylinder look, box collider).
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ color: PALETTE.metalDark, roughness: 0.6, metalness: 0.4 });
  for (const [x, z] of [[-25, -6], [-13, -19], [13, -19], [25, -6], [-9, 18.5], [9, 18.5], [-25, 18], [25, 18]]) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(x, 0.58, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // Site letter decals painted on the ground, south of the site containers
  // so they stay visible instead of hiding underneath them.
  for (const site of Object.values(SITES)) {
    const tex = makeSiteLetterTexture(site.id, site.id === 'A' ? '#f0a832' : '#35c4b5');
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.center.x, 0.04, site.center.z + 3.5);
    group.add(decal);
  }

  // Sky dome, sun disc and distant dunes outside the walls.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: '#ffcf8a', fog: false }),
  );
  sun.position.set(-140, 42, -120);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
  const duneMat = new THREE.MeshStandardMaterial({ color: PALETTE.groundDark, roughness: 1 });
  for (const [x, z, sx, sz] of [[-70, -40, 60, 24], [60, -60, 70, 26], [-50, 60, 55, 22], [70, 50, 65, 24], [0, -80, 90, 26]]) {
    const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), duneMat);
    dune.scale.set(sx, 7, sz);
    dune.position.set(x, -1.5, z);
    scene.add(dune);
  }
  // Relay tower silhouette beyond the north wall.
  const tower = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 26, 0.8), mats.metalDark);
  mast.position.y = 13;
  const cross = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 0.5), mats.metalDark);
  cross.position.y = 24;
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 10, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.danger }),
  );
  beacon.position.y = 26.5;
  tower.add(mast, cross, beacon);
  tower.position.set(14, 0, -38);
  scene.add(tower);

  // Team flags at the spawns.
  for (const [team, x, z] of [[TEAM.VANGUARD, -7, 19], [TEAM.AEGIS, 7, -19]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.4, 8), mats.metalDark);
    pole.position.set(x, 2.2, z);
    pole.castShadow = true;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.9, 6, 1),
      new THREE.MeshStandardMaterial({
        color: team === TEAM.VANGUARD ? PALETTE.vanguard : PALETTE.aegis,
        side: THREE.DoubleSide,
        roughness: 0.9,
      }),
    );
    flag.position.set(x + 0.85, 3.9, z);
    group.add(pole, flag);
  }

  // Light: low warm sun with shadows, cool sky fill, warm lamps over the sites.
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 45, 150);
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8a97b5'), new THREE.Color(PALETTE.ground), 1.0);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(new THREE.Color('#ffb877'), 2.4);
  sunLight.position.set(-38, 30, -28);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -34;
  sunLight.shadow.camera.right = 34;
  sunLight.shadow.camera.top = 30;
  sunLight.shadow.camera.bottom = -30;
  sunLight.shadow.camera.far = 120;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight, sunLight.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6a8a'), 0.5);
  fill.position.set(20, 18, 24);
  scene.add(fill);
  for (const site of Object.values(SITES)) {
    const lamp = new THREE.PointLight(new THREE.Color('#ffd9a0'), 24, 20, 1.8);
    lamp.position.set(site.center.x, 4.6, site.center.z);
    scene.add(lamp);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), mats.metalDark);
    housing.position.set(site.center.x, 4.8, site.center.z);
    group.add(housing);
  }

  return { group, colliders, shootables, sites: SITES, spawns: SPAWNS, navNodes: NAV_NODES, navAdjacency: NAV_ADJACENCY, holdSpots: HOLD_SPOTS };
}
