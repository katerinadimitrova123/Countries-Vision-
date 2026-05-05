import * as THREE from 'three';
import { buildGlobe, RADIUS } from './globe.js';
import { setupHands } from './hands.js';

const canvas = document.getElementById('globe');
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const uiEl = document.getElementById('ui');
const countryNameEl = document.getElementById('country-name');
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

// Precompute outward direction per country (their center on the unit sphere)
// for the clap-explosion effect.
const explosionDirs = new Map();
for (const m of countryMeshes) {
  const pos = m.geometry.attributes.position;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < pos.count; i++) {
    sx += pos.getX(i); sy += pos.getY(i); sz += pos.getZ(i);
  }
  const len = Math.hypot(sx, sy, sz) || 1;
  explosionDirs.set(m, new THREE.Vector3(sx / len, sy / len, sz / len));
}

// ---------- Game state ----------
let score = 0;
let targetCountry = null;
let hoveredMesh = null;
let lastHoveredMesh = null;
let fistHoldStart = null;
let lockedAt = 0;
const FIST_HOLD_MS = 3000;
const LOCKOUT_MS = 800; // brief lockout after a correct pick
const REVEAL_MS = 2500; // how long the actual country stays red after a wrong pick
let revealMesh = null;
let revealEndAt = 0;
let revealRotateActive = false;
let revealTargetRotX = 0;
let revealTargetRotY = 0;

// Clap-explosion state
const EXPLOSION_DURATION = 5000;
const EXPLODE_OUT_MS = 900;
const EXPLODE_RETURN_MS = 1100;
const EXPLODE_DISTANCE = 1.6;
const CLAP_CLOSE_THRESHOLD = 0.22;     // hands close enough = clap impact
const CLAP_APART_THRESHOLD = 0.32;     // need to have been at least this far in the recent past
const CLAP_HISTORY_MS = 800;           // sliding window for "recently apart"
let explosionState = 'none'; // 'none' | 'active'
let explosionStartAt = 0;
let clapCooldownUntil = 0;
const clapHistory = []; // [{ t, d }]

function isLocked() {
  const now = performance.now();
  return (
    explosionState !== 'none' ||
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

function pickRandomCountry() {
  const idx = Math.floor(Math.random() * countryMeshes.length);
  targetCountry = countryMeshes[idx].userData.name;
  countryNameEl.textContent = targetCountry;
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
  }
  hoveredMesh = mesh;
  if (hoveredMesh && hoveredMesh !== revealMesh) {
    hoveredMesh.material.color.setHex(0x5aa4ff);
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
          target.material.color.setHex(0xef4444);
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
    revealMesh = null;
    revealRotateActive = false;
    pickRandomCountry();
  }
}

function triggerExplosion() {
  if (explosionState !== 'none') return;
  explosionState = 'active';
  explosionStartAt = performance.now();
  // Cancel any in-progress reveal cleanly
  if (revealMesh) {
    revealMesh.material.color.setHex(revealMesh.userData.baseColor);
    revealMesh = null;
    revealRotateActive = false;
  }
  fistHoldStart = null;
  fillEl.style.width = '0%';
  progressEl.classList.add('hidden');
  ocean.visible = false;
  lines.visible = false;
  setStatus('💥 BOOM 💥', '#fbbf24');
  // Brief white screen flash
  const flash = document.getElementById('flash');
  if (flash) {
    flash.classList.add('fire');
    setTimeout(() => flash.classList.remove('fire'), 90);
  }
}

function checkClap(handData) {
  const now = performance.now();

  // Prune old samples from the sliding window
  while (clapHistory.length && clapHistory[0].t < now - CLAP_HISTORY_MS) {
    clapHistory.shift();
  }

  const d = handData ? handData.twoHandsDist : null;
  const debugEl = document.getElementById('clap-debug');
  if (debugEl) {
    debugEl.textContent =
      d == null ? 'two hands: not seen' : `two hands dist: ${d.toFixed(2)}`;
  }

  if (d == null) return;
  clapHistory.push({ t: now, d });

  if (now < clapCooldownUntil) return;

  if (d < CLAP_CLOSE_THRESHOLD) {
    const recentMax = clapHistory.reduce((m, e) => Math.max(m, e.d), 0);
    if (recentMax > CLAP_APART_THRESHOLD) {
      triggerExplosion();
      clapCooldownUntil = now + EXPLOSION_DURATION + 1000;
    }
  }
}

function updateExplosion() {
  if (explosionState === 'none') return;
  const t = performance.now() - explosionStartAt;

  if (t >= EXPLOSION_DURATION) {
    for (const m of countryMeshes) m.position.set(0, 0, 0);
    ocean.visible = true;
    lines.visible = true;
    explosionState = 'none';
    return;
  }

  let distance;
  if (t < EXPLODE_OUT_MS) {
    const k = t / EXPLODE_OUT_MS;
    const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
    distance = eased * EXPLODE_DISTANCE;
  } else if (t < EXPLOSION_DURATION - EXPLODE_RETURN_MS) {
    distance = EXPLODE_DISTANCE;
  } else {
    const returnT = t - (EXPLOSION_DURATION - EXPLODE_RETURN_MS);
    const k = returnT / EXPLODE_RETURN_MS;
    const eased = 1 - Math.pow(1 - k, 3);
    distance = (1 - eased) * EXPLODE_DISTANCE;
  }

  for (const m of countryMeshes) {
    const dir = explosionDirs.get(m);
    m.position.set(dir.x * distance, dir.y * distance, dir.z * distance);
  }
}

// ---------- Hand input ----------
let currentGesture = 'none';
let cursorPos = { x: 0.5, y: 0.5 };

function onHand(handData) {
  checkClap(handData);

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

  updateHover();
  handleSelection();
  updateReveal();
  updateExplosion();

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
