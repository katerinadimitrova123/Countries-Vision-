import * as THREE from 'three';
import { buildGlobe, RADIUS } from './globe.js';
import { setupHands } from './hands.js';

const canvas = document.getElementById('globe');
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const uiEl = document.getElementById('ui');
const countryNameEl = document.getElementById('country-name');
const countryFlagEl = document.getElementById('country-flag');
const countryCapitalEl = document.getElementById('country-capital');
const countryPopulationEl = document.getElementById('country-population');
const countryCurrencyEl = document.getElementById('country-currency');
const scoreEl = document.getElementById('score-value');
const statusEl = document.getElementById('status');
const fillEl = document.getElementById('select-fill');
const progressEl = document.getElementById('select-progress');
const cursorEl = document.getElementById('cursor');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 3.2);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Soft ambient feel
scene.add(new THREE.AmbientLight(0xffffff, 1));

const globeGroup = new THREE.Group();
scene.add(globeGroup);

countryNameEl.textContent = 'Loading...';
const { countryMeshes, ocean, lines } = await buildGlobe(globeGroup);

// ---------- Game state ----------
let score = 0;
let targetCountry = null;
let hoveredMesh = null;
let lastHoveredMesh = null;
let fistHoldStart = null;
let lockedAt = 0;
const FIST_HOLD_MS = 3000;
const LOCKOUT_MS = 800; // brief lockout after a correct pick
const REVEAL_MS = 4500; // how long the actual country stays red after a wrong pick
let revealMesh = null;
let redOverlay = null;
let revealEndAt = 0;
let revealRotateActive = false;
let revealTargetRotX = 0;
let revealTargetRotY = 0;

function showRedOverlay(target) {
  hideRedOverlay();

  // Build a country-shaped red layer by cloning the country's geometry and
  // pushing every vertex outward so it sits clearly above the globe surface.
  const geo = target.geometry.clone();
  const pos = geo.attributes.position;
  const LIFT = 0.08;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const s = (len + LIFT) / len;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();

  const mat = new THREE.MeshBasicMaterial({
    color: 0xcc0000,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 1,
  });
  const shape = new THREE.Mesh(geo, mat);
  shape.renderOrder = 99999;
  shape.frustumCulled = false;

  redOverlay = shape;
  globeGroup.add(redOverlay);
}

function hideRedOverlay() {
  if (redOverlay) {
    globeGroup.remove(redOverlay);
    redOverlay.geometry.dispose();
    redOverlay.material.dispose();
    redOverlay = null;
  }
}

// Zoom state (two-hand spread controls camera distance)
const ZOOM_NEAR = 1.8;     // closest camera position
const ZOOM_FAR = 4.6;      // farthest camera position
const HAND_DIST_NEAR = 0.10; // hands touching
const HAND_DIST_FAR = 0.55;  // hands wide apart
let cameraTargetZ = camera.position.z;

function isLocked() {
  const now = performance.now();
  return (
    now < revealEndAt ||
    now - lockedAt < LOCKOUT_MS
  );
}

function getCountryCenterDir(mesh) {
  const pos = mesh.geometry.attributes.position;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < pos.count; i++) {
    sx += pos.getX(i);
    sy += pos.getY(i);
    sz += pos.getZ(i);
  }
  const len = Math.hypot(sx, sy, sz) || 1;
  return { x: sx / len, y: sy / len, z: sz / len };
}

// Pick the rotation that brings a country's center to face the camera (+Z),
// taking the shortest angular path from the current rotation.
function setRevealRotationTarget(mesh) {
  const c = getCountryCenterDir(mesh);
  const lat = Math.asin(Math.max(-1, Math.min(1, c.y)));
  const lng = Math.atan2(-c.z, c.x);
  revealTargetRotX = lat;

  const desiredY = -Math.PI / 2 - lng;
  const cur = globeGroup.rotation.y;
  let delta = ((desiredY - cur) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  revealTargetRotY = cur + delta;
}

const countryInfoCache = new Map();

function formatPopulation(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function formatCurrency(currencies) {
  if (!currencies || typeof currencies !== 'object') return '—';
  const first = Object.values(currencies)[0];
  if (!first) return '—';
  const name = first.name ?? '';
  const symbol = first.symbol ?? '';
  if (name && symbol) return `${name} (${symbol})`;
  return name || symbol || '—';
}

async function fetchCountryInfo(name) {
  if (countryInfoCache.has(name)) return countryInfoCache.get(name);
  const base = `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=capital,population,flag,currencies`;
  const empty = { capital: '—', population: null, flag: '', currency: '—' };
  async function tryFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('lookup failed');
    return res.json();
  }
  try {
    // Exact-name match first to avoid Niger → Nigeria collisions
    let data;
    try {
      data = await tryFetch(base + '&fullText=true');
    } catch {
      data = await tryFetch(base);
    }
    const match = data[0];
    const info = {
      capital: match?.capital?.[0] ?? '—',
      population: match?.population ?? null,
      flag: match?.flag ?? '',
      currency: formatCurrency(match?.currencies),
    };
    countryInfoCache.set(name, info);
    return info;
  } catch {
    countryInfoCache.set(name, empty);
    return empty;
  }
}

async function pickRandomCountry() {
  const idx = Math.floor(Math.random() * countryMeshes.length);
  targetCountry = countryMeshes[idx].userData.name;
  countryNameEl.textContent = targetCountry;
  countryFlagEl.textContent = '';
  countryCapitalEl.textContent = '…';
  countryPopulationEl.textContent = '…';
  countryCurrencyEl.textContent = '…';
  const pickedAt = targetCountry;
  const info = await fetchCountryInfo(targetCountry);
  if (pickedAt !== targetCountry) return;
  countryFlagEl.textContent = info.flag;
  countryCapitalEl.textContent = info.capital;
  countryPopulationEl.textContent =
    info.population != null ? formatPopulation(info.population) : '—';
  countryCurrencyEl.textContent = info.currency;
}

let statusTimeout = null;
function setStatus(text, color = '#fff') {
  statusEl.textContent = text;
  statusEl.style.color = color;
  statusEl.classList.remove('hidden');
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => statusEl.classList.add('hidden'), 1600);
}

function setHovered(mesh) {
  if (hoveredMesh === mesh) return;
  if (hoveredMesh && hoveredMesh !== revealMesh) {
    hoveredMesh.material.color.setHex(hoveredMesh.userData.baseColor);
    hoveredMesh.material.opacity = 0;
  }
  hoveredMesh = mesh;
  if (hoveredMesh && hoveredMesh !== revealMesh) {
    hoveredMesh.material.color.setHex(0x5aa4ff);
    hoveredMesh.material.opacity = 0.85;
  }
}

// ---------- Raycasting ----------
const raycaster = new THREE.Raycaster();
let cursorNDC = new THREE.Vector2(0, 0);

function updateHover() {
  if (isLocked()) {
    setHovered(null);
    return;
  }
  raycaster.setFromCamera(cursorNDC, camera);
  const intersects = raycaster.intersectObjects(countryMeshes, false);
  setHovered(intersects.length ? intersects[0].object : null);
}

// ---------- Rotation ----------
let rotVelX = 0;
let rotVelY = 0;
const ROT_DAMP = 0.9;
let lastHandPos = null;
let dragMode = false;

// ---------- Selection (fist hold) ----------
function handleSelection() {
  if (isLocked()) {
    fistHoldStart = null;
    fillEl.style.width = '0%';
    progressEl.classList.add('hidden');
    return;
  }
  if (currentGesture === 'fist' && hoveredMesh) {
    if (fistHoldStart === null) fistHoldStart = performance.now();
    const elapsed = performance.now() - fistHoldStart;
    const pct = Math.min(100, (elapsed / FIST_HOLD_MS) * 100);
    fillEl.style.width = pct + '%';
    progressEl.classList.remove('hidden');
    if (elapsed >= FIST_HOLD_MS) {
      const picked = hoveredMesh.userData.name;
      if (picked === targetCountry) {
        score++;
        scoreEl.textContent = score;
        setStatus('Correct!', '#4ade80');
        // Flash the correct country in green so the user remembers where it is.
        setHovered(null);
        const target = countryMeshes.find(
          (m) => m.userData.name === targetCountry
        );
        if (target) {
          target.material.color.setHex(0x22c55e);
          target.material.opacity = 0.9;
          revealMesh = target;
        }
        revealEndAt = performance.now() + REVEAL_MS;
      } else {
        setStatus(`Wrong! That was ${targetCountry}`, '#f87171');
        score = 0;
        scoreEl.textContent = score;
        // Clear hover so the wrong-picked country goes back to base color,
        // then flash the actual target in red for REVEAL_MS while rotating
        // the globe to center it on screen.
        setHovered(null);
        const target = countryMeshes.find(
          (m) => m.userData.name === targetCountry
        );
        if (target) {
          showRedOverlay(target);
          revealMesh = target;
          setRevealRotationTarget(target);
          revealRotateActive = true;
        }
        revealEndAt = performance.now() + REVEAL_MS;
      }
      fistHoldStart = null;
      fillEl.style.width = '0%';
      progressEl.classList.add('hidden');
    }
  } else {
    fistHoldStart = null;
    fillEl.style.width = '0%';
    progressEl.classList.add('hidden');
  }
}

function updateReveal() {
  if (revealMesh && performance.now() >= revealEndAt) {
    revealMesh.material.color.setHex(revealMesh.userData.baseColor);
    revealMesh.material.opacity = 0;
    hideRedOverlay();
    revealMesh = null;
    revealRotateActive = false;
    pickRandomCountry();
  }
}

function updateZoomFromHands(handData) {
  if (!handData || handData.twoHandsDist == null) return;
  const raw = Math.max(
    HAND_DIST_NEAR,
    Math.min(HAND_DIST_FAR, handData.twoHandsDist)
  );
  const t = (raw - HAND_DIST_NEAR) / (HAND_DIST_FAR - HAND_DIST_NEAR);
  // Wider hands → t closer to 1 → camera closer (smaller z)
  cameraTargetZ = ZOOM_FAR + t * (ZOOM_NEAR - ZOOM_FAR);
}

// ---------- Hand input ----------
let currentGesture = 'none';
let cursorPos = { x: 0.5, y: 0.5 };

function onHand(handData) {
  updateZoomFromHands(handData);

  if (!handData) {
    currentGesture = 'none';
    cursorEl.classList.add('hidden');
    lastHandPos = null;
    dragMode = false;
    return;
  }
  cursorEl.classList.remove('hidden');
  currentGesture = handData.gesture;
  cursorPos.x = handData.x;
  cursorPos.y = handData.y;
  cursorEl.style.left = cursorPos.x * 100 + 'vw';
  cursorEl.style.top = cursorPos.y * 100 + 'vh';
  cursorEl.dataset.gesture = handData.gesture;

  cursorNDC.x = cursorPos.x * 2 - 1;
  cursorNDC.y = -(cursorPos.y * 2 - 1);

  // Rotation: open palm acts as a drag-rotate
  if (handData.gesture === 'open') {
    if (lastHandPos && dragMode) {
      const dx = handData.x - lastHandPos.x;
      const dy = handData.y - lastHandPos.y;
      rotVelY += dx * 5;
      rotVelX += dy * 5;
    }
    dragMode = true;
    lastHandPos = { x: handData.x, y: handData.y };
  } else {
    dragMode = false;
    lastHandPos = null;
  }
}

// ---------- Render loop ----------
function animate() {
  requestAnimationFrame(animate);

  if (revealRotateActive) {
    rotVelX = 0;
    rotVelY = 0;
    const ease = 0.12;
    globeGroup.rotation.x +=
      (revealTargetRotX - globeGroup.rotation.x) * ease;
    globeGroup.rotation.y +=
      (revealTargetRotY - globeGroup.rotation.y) * ease;
  } else {
    globeGroup.rotation.y += rotVelY * 0.06;
    globeGroup.rotation.x += rotVelX * 0.06;
    globeGroup.rotation.x = Math.max(
      -Math.PI / 2 + 0.05,
      Math.min(Math.PI / 2 - 0.05, globeGroup.rotation.x)
    );
    rotVelX *= ROT_DAMP;
    rotVelY *= ROT_DAMP;
  }

  // Smooth camera zoom
  camera.position.z += (cameraTargetZ - camera.position.z) * 0.15;

  updateHover();
  handleSelection();
  updateReveal();

  renderer.render(scene, camera);
}

// ---------- Start flow ----------
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Starting camera...';
  try {
    await setupHands(onHand);
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = 'Start Game';
    alert('Could not access webcam: ' + err.message);
    return;
  }
  startScreen.classList.add('hidden');
  uiEl.classList.remove('hidden');
  pickRandomCountry();
  // Slow auto-spin to make the globe feel alive at first
  rotVelY = 0.01;
  animate();
});

// Render an idle preview behind the start screen
globeGroup.rotation.y = -1.0;
renderer.render(scene, camera);
function idleSpin() {
  if (startScreen.classList.contains('hidden')) return;
  globeGroup.rotation.y += 0.0015;
  renderer.render(scene, camera);
  requestAnimationFrame(idleSpin);
}
idleSpin();
