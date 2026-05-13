import * as THREE from 'three';
import { buildGlobe, RADIUS } from './globe.js';
import { setupHands } from './hands.js';
import {
  submitScore,
  fetchRank,
  fetchTop,
  getStoredName,
  leaderboardAvailable,
} from './leaderboard.js';

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
const livesEl = document.getElementById('lives-box');
const gameOverEl = document.getElementById('game-over');
const gameOverScoreEl = document.getElementById('gameover-score-value');
const playAgainBtn = document.getElementById('play-again-btn');
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
const MAX_LIVES = 3;
const BEST_SCORE_KEY = 'countries-vision:best-score';
let score = 0;
let lives = MAX_LIVES;
let gameIsOver = false;
let targetCountry = null;

function getBestScore() {
  const v = parseInt(localStorage.getItem(BEST_SCORE_KEY) || '0', 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function setBestScore(v) {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(v));
  } catch {
    // localStorage can throw in private mode — silently ignore
  }
}

function renderLives() {
  if (!livesEl) return;
  let html = '';
  for (let i = 0; i < MAX_LIVES; i++) {
    const lost = i >= lives;
    html += `<span class="heart${lost ? ' lost' : ''}">${lost ? '🤍' : '❤️'}</span>`;
  }
  livesEl.innerHTML = html;
}
renderLives();

function launchFireworks(durationMs = 2200) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:71;';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const colors = ['#fbbf24', '#ef4444', '#5aa4ff', '#4ade80', '#a855f7', '#f97316', '#ec4899'];
  const particles = [];

  function spawnBurst(x, y) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const count = 50 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.15;
      const speed = 3 + Math.random() * 4;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }

  const startTime = performance.now();
  let burstsLaunched = 0;
  const totalBursts = 6;
  let nextBurstAt = 0;

  function frame() {
    const elapsed = performance.now() - startTime;

    if (burstsLaunched < totalBursts && elapsed >= nextBurstAt) {
      const x = canvas.width * (0.15 + Math.random() * 0.7);
      const y = canvas.height * (0.15 + Math.random() * 0.45);
      spawnBurst(x, y);
      burstsLaunched++;
      nextBurstAt = elapsed + 200 + Math.random() * 220;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08; // gravity
      p.vx *= 0.99;
      p.vy *= 0.99;
      p.life -= 0.016;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 14;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (elapsed < durationMs || particles.length > 0) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(frame);
}

function triggerGameOver() {
  gameIsOver = true;
  const previousBest = getBestScore();
  const isNewBest = score > previousBest;
  if (isNewBest) setBestScore(score);

  gameOverScoreEl.textContent = String(score);

  const bestRowEl = document.getElementById('gameover-best');
  const bestLabelEl = document.getElementById('gameover-best-label');
  const bestValueEl = document.getElementById('gameover-best-value');
  const newBestEl = document.getElementById('gameover-new-best');
  if (bestRowEl && bestValueEl && newBestEl && bestLabelEl) {
    if (isNewBest && previousBest > 0) {
      newBestEl.classList.remove('hidden');
      bestRowEl.classList.remove('hidden');
      bestLabelEl.textContent = 'Previous best';
      bestValueEl.textContent = String(previousBest);
      bestValueEl.classList.add('struck');
    } else if (isNewBest && previousBest === 0) {
      // First record ever — celebrate but don't show a "previous best" row
      newBestEl.classList.remove('hidden');
      bestRowEl.classList.add('hidden');
    } else {
      newBestEl.classList.add('hidden');
      bestRowEl.classList.remove('hidden');
      bestLabelEl.textContent = 'Personal best';
      bestValueEl.textContent = String(previousBest);
      bestValueEl.classList.remove('struck');
    }
  }

  setupSubmitUI(isNewBest, score);

  gameOverEl.classList.remove('hidden');

  if (isNewBest && score > 0) launchFireworks();
}

function setupSubmitUI(isNewBest, finalScore) {
  const submitWrap = document.getElementById('gameover-submit');
  const nameInput = document.getElementById('gameover-name');
  const submitBtn = document.getElementById('gameover-submit-btn');
  const statusLine = document.getElementById('gameover-submit-status');
  const rankEl = document.getElementById('gameover-rank');
  if (!submitWrap || !nameInput || !submitBtn || !statusLine || !rankEl) return;

  rankEl.classList.add('hidden');
  rankEl.textContent = '';
  statusLine.textContent = '';
  submitBtn.disabled = false;

  if (!isNewBest || finalScore <= 0 || !leaderboardAvailable()) {
    submitWrap.classList.add('hidden');
    return;
  }

  submitWrap.classList.remove('hidden');
  const stored = getStoredName();
  nameInput.value = stored;
  if (stored) {
    submitBtn.textContent = 'Update ranking';
  } else {
    submitBtn.textContent = 'Submit';
  }

  submitBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      statusLine.textContent = 'Please enter a name.';
      statusLine.className = 'gameover-submit-status error';
      return;
    }
    submitBtn.disabled = true;
    statusLine.textContent = 'Submitting…';
    statusLine.className = 'gameover-submit-status';

    const result = await submitScore(name, finalScore);
    if (result.ok) {
      statusLine.textContent = 'Saved!';
      statusLine.className = 'gameover-submit-status success';
      submitWrap.classList.add('submitted');
      const rank = await fetchRank(finalScore);
      if (rank) {
        rankEl.textContent = `You're ranked #${rank} worldwide`;
        rankEl.classList.remove('hidden');
      }
    } else {
      submitBtn.disabled = false;
      statusLine.textContent = "Couldn't save score. Try again?";
      statusLine.className = 'gameover-submit-status error';
    }
  };
}

async function showRankings() {
  const panel = document.getElementById('rankings-panel');
  const listEl = document.getElementById('rankings-list');
  if (!panel || !listEl) return;
  listEl.innerHTML = '<li class="rankings-loading">Loading…</li>';
  panel.classList.remove('hidden');

  if (!leaderboardAvailable()) {
    listEl.innerHTML = '<li class="rankings-loading">Rankings unavailable.</li>';
    return;
  }

  const rows = await fetchTop(100);
  if (!rows.length) {
    listEl.innerHTML = '<li class="rankings-loading">No scores yet. Be the first!</li>';
    return;
  }
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  listEl.innerHTML = rows.map((row, i) => `
    <li>
      <span class="rank-pos">${i + 1}</span>
      <span class="rank-name">${escape(row.name)}</span>
      <span class="rank-score">${row.score}</span>
    </li>
  `).join('');
}

const viewRankingsBtn = document.getElementById('view-rankings-btn');
if (viewRankingsBtn) viewRankingsBtn.addEventListener('click', showRankings);

const rankingsCloseBtn = document.getElementById('rankings-close');
if (rankingsCloseBtn) {
  rankingsCloseBtn.addEventListener('click', () => {
    document.getElementById('rankings-panel')?.classList.add('hidden');
  });
}

function startNewGame() {
  gameIsOver = false;
  score = 0;
  lives = MAX_LIVES;
  scoreEl.textContent = '0';
  renderLives();
  gameOverEl.classList.add('hidden');
  // Clear any in-flight reveal so the next round starts clean
  if (revealMesh) {
    revealMesh.material.color.setHex(revealMesh.userData.baseColor);
    revealMesh.material.opacity = 0;
    revealMesh = null;
    revealRotateActive = false;
  }
  hideRedOverlay();
  revealEndAt = 0;
  pickRandomCountry();
}

if (playAgainBtn) {
  playAgainBtn.addEventListener('click', startNewGame);
}
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

// Zoom state — Thumbs Up = zoom in, Thumbs Down = zoom out.
// Continuous: as long as the gesture is shown, the camera moves at THUMB_ZOOM_SPEED.
const ZOOM_NEAR = 1.8;        // closest camera position
const ZOOM_FAR = 4.6;         // farthest camera position
const THUMB_ZOOM_SPEED = 0.04; // units per frame
let cameraTargetZ = camera.position.z;

// Hysteresis state machine for hand-gesture mode.
// Raw frame-by-frame gestures get mapped to a stable mode that only
// changes after the new mode has been seen consistently for COMMIT_MS.
const MODE_COMMIT_MS = 150;
let activeMode = 'idle'; // 'idle' | 'pan' | 'zoom' | 'select'
let pendingMode = 'idle';
let pendingSince = 0;

function gestureToMode(g) {
  if (g === 'fist') return 'select';
  if (g === 'open') return 'pan';
  if (g === 'victory') return 'zoom_in';   // ✌️
  if (g === 'love') return 'zoom_out';     // 🤟
  return 'idle';
}

function updateMode(rawGesture) {
  const candidate = gestureToMode(rawGesture);
  const now = performance.now();
  if (candidate === activeMode) {
    pendingMode = candidate;
    return activeMode;
  }
  if (candidate !== pendingMode) {
    pendingMode = candidate;
    pendingSince = now;
    return activeMode;
  }
  // Select gets through immediately — fist-hold (3s) is its own delay.
  if (candidate === 'select') {
    activeMode = candidate;
    return activeMode;
  }
  if (now - pendingSince >= MODE_COMMIT_MS) {
    activeMode = candidate;
  }
  return activeMode;
}

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

// Hardcoded fallback for entities not recognized by REST Countries.
// Keyed by the world-atlas dataset name.
const MANUAL_COUNTRY_DATA = {
  'N. Cyprus': {
    capital: 'North Nicosia',
    population: 383000,
    flag: '',
    currency: 'Turkish lira (₺)',
  },
  Somaliland: {
    capital: 'Hargeisa',
    population: 6200000,
    flag: '',
    currency: 'Somaliland shilling (Sh)',
  },
};

// Field-level overrides applied after the API response (e.g. when REST
// Countries is out of date). Keyed by ISO 3166-1 numeric code.
const COUNTRY_PATCHES = {
  '100': { currency: 'Euro (€)' }, // Bulgaria — adopted the Euro on 2026-01-01
};

function formatPopulation(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

// ---------- All-countries browser ----------
let allCountriesData = null;
let allCountriesPromise = null;
let countriesSearchQuery = '';

async function loadAllCountries() {
  if (allCountriesData) return allCountriesData;
  if (allCountriesPromise) return allCountriesPromise;
  allCountriesPromise = (async () => {
    const res = await fetch(
      'https://restcountries.com/v3.1/all?fields=name,flag,capital,population,currencies,ccn3'
    );
    if (!res.ok) throw new Error('countries load failed');
    const data = await res.json();
    allCountriesData = data
      .map((c) => {
        const entry = {
          name: c.name?.common ?? '?',
          flag: c.flag ?? '',
          capital: c.capital?.[0] ?? '—',
          population: c.population ?? 0,
          currency: formatCurrency(c.currencies),
        };
        if (c.ccn3 && COUNTRY_PATCHES[c.ccn3]) {
          Object.assign(entry, COUNTRY_PATCHES[c.ccn3]);
        }
        return entry;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return allCountriesData;
  })();
  return allCountriesPromise;
}

function renderCountriesList() {
  const list = document.getElementById('countries-list');
  if (!allCountriesData) {
    list.innerHTML = '<li class="loading">Loading…</li>';
    return;
  }
  const q = countriesSearchQuery.trim().toLowerCase();
  const filtered = q
    ? allCountriesData.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.capital.toLowerCase().includes(q)
      )
    : allCountriesData;
  if (filtered.length === 0) {
    list.innerHTML = '<li class="empty">No countries match.</li>';
    return;
  }
  list.innerHTML = filtered
    .map(
      (c) => `
      <li>
        <span class="flag">${c.flag}</span>
        <div class="info">
          <span class="name">${c.name}</span>
          <span class="meta"><span class="label">Capital:</span>${c.capital} · <span class="label">Pop:</span>${c.population ? formatPopulation(c.population) : '—'} · <span class="label">Currency:</span>${c.currency}</span>
        </div>
      </li>`
    )
    .join('');
}

async function openCountries() {
  const panel = document.getElementById('countries-panel');
  panel.classList.remove('hidden');
  renderCountriesList();
  try {
    await loadAllCountries();
    renderCountriesList();
  } catch {
    document.getElementById('countries-list').innerHTML =
      '<li class="loading">Could not load countries.</li>';
  }
}

function closeCountries() {
  document.getElementById('countries-panel').classList.add('hidden');
}

document.getElementById('countries-btn').addEventListener('click', openCountries);
document.getElementById('countries-close').addEventListener('click', closeCountries);
document.getElementById('countries-panel').addEventListener('click', (e) => {
  if (e.target.id === 'countries-panel') closeCountries();
});
document.getElementById('countries-search').addEventListener('input', (e) => {
  countriesSearchQuery = e.target.value;
  renderCountriesList();
});

function formatCurrency(currencies) {
  if (!currencies || typeof currencies !== 'object') return '—';
  const first = Object.values(currencies)[0];
  if (!first) return '—';
  const name = first.name ?? '';
  const symbol = first.symbol ?? '';
  if (name && symbol) return `${name} (${symbol})`;
  return name || symbol || '—';
}

async function fetchCountryInfo(name, id) {
  const cacheKey = id ? `id:${id}` : `name:${name}`;
  if (countryInfoCache.has(cacheKey)) return countryInfoCache.get(cacheKey);
  // Manual overrides for non-ISO entities (Northern Cyprus, Somaliland, …)
  if (MANUAL_COUNTRY_DATA[name]) {
    const info = MANUAL_COUNTRY_DATA[name];
    countryInfoCache.set(cacheKey, info);
    return info;
  }
  const fields = 'fields=capital,population,flag,currencies';
  const empty = { capital: '—', population: null, flag: '', currency: '—' };
  async function tryFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('lookup failed');
    return res.json();
  }
  try {
    let data;
    // ISO numeric code lookup is the most reliable; falls back to name search.
    if (id) {
      try {
        data = await tryFetch(
          `https://restcountries.com/v3.1/alpha/${encodeURIComponent(id)}?${fields}`
        );
        // alpha endpoint returns a single object, not an array
        if (!Array.isArray(data)) data = [data];
      } catch {
        // fall through to name-based lookup
      }
    }
    if (!data) {
      const base = `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?${fields}`;
      try {
        data = await tryFetch(base + '&fullText=true');
      } catch {
        data = await tryFetch(base);
      }
    }
    const match = data[0];
    const info = {
      capital: match?.capital?.[0] ?? '—',
      population: match?.population ?? null,
      flag: match?.flag ?? '',
      currency: formatCurrency(match?.currencies),
    };
    if (id && COUNTRY_PATCHES[id]) Object.assign(info, COUNTRY_PATCHES[id]);
    countryInfoCache.set(cacheKey, info);
    return info;
  } catch {
    countryInfoCache.set(cacheKey, empty);
    return empty;
  }
}

async function pickRandomCountry() {
  const idx = Math.floor(Math.random() * countryMeshes.length);
  const picked = countryMeshes[idx];
  targetCountry = picked.userData.name;
  const targetId = picked.userData.id;
  countryNameEl.textContent = targetCountry;
  countryFlagEl.textContent = '';
  countryCapitalEl.textContent = '…';
  countryPopulationEl.textContent = '…';
  countryCurrencyEl.textContent = '…';
  const pickedAt = targetCountry;
  const info = await fetchCountryInfo(targetCountry, targetId);
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
  // Country meshes use depthTest: false, so the ray can pass through the globe
  // and hit a country on the far side. Only accept hits on the camera-facing
  // hemisphere (hit point on the same side of the origin as the camera).
  const camPos = camera.position;
  const front = intersects.find((hit) => hit.point.dot(camPos) > 0);
  setHovered(front ? front.object : null);
}

// ---------- Rotation ----------
let rotVelX = 0;
let rotVelY = 0;
const ROT_DAMP = 0.9;
let lastHandPos = null;
let dragMode = false;

// ---------- Selection ----------
function commitSelection(mesh) {
  if (!mesh || isLocked() || gameIsOver) return;
  const picked = mesh.userData.name;
  if (picked === targetCountry) {
    score++;
    scoreEl.textContent = score;
    setStatus('Correct!', '#4ade80');
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
    lives = Math.max(0, lives - 1);
    renderLives();
    if (lives === 0) {
      setStatus(`Wrong! That was ${targetCountry}`, '#f87171');
    } else {
      const remaining = lives === 1 ? '1 life left' : `${lives} lives left`;
      setStatus(`Wrong! That was ${targetCountry} — ${remaining}`, '#f87171');
    }
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
}

// Fist-hold (hand) selection
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
      commitSelection(hoveredMesh);
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
    if (lives === 0) {
      triggerGameOver();
    } else {
      pickRandomCountry();
    }
  }
}

function updateZoomFromHands(handData, mode) {
  if (mode === 'zoom_in') {
    cameraTargetZ = Math.max(ZOOM_NEAR, cameraTargetZ - THUMB_ZOOM_SPEED);
  } else if (mode === 'zoom_out') {
    cameraTargetZ = Math.min(ZOOM_FAR, cameraTargetZ + THUMB_ZOOM_SPEED);
  }

  // Debug HUD
  const debugEl = document.getElementById('hand-debug');
  if (debugEl && controlMode === 'hands') {
    debugEl.classList.remove('hidden');
    if (!handData) {
      debugEl.textContent = 'mode: idle\n(no hand)';
    } else {
      debugEl.textContent =
        `mode:   ${mode}\nraw:    ${handData.gesture}\ncamera: ${cameraTargetZ.toFixed(2)}`;
    }
  }
}

// ---------- Hand input ----------
let currentGesture = 'none';
let cursorPos = { x: 0.5, y: 0.5 };

function onHand(handData) {
  if (controlMode !== 'hands') {
    cursorEl.classList.add('hidden');
    return;
  }

  // Run the gesture through the hysteresis state machine once per frame
  const rawGesture = handData ? handData.gesture : null;
  const mode = updateMode(rawGesture);

  // Zoom always evaluates (uses mode internally to decide whether to act)
  updateZoomFromHands(handData, mode);

  if (!handData) {
    currentGesture = 'none';
    cursorEl.classList.add('hidden');
    lastHandPos = null;
    dragMode = false;
    return;
  }
  cursorEl.classList.remove('hidden');
  currentGesture = handData.gesture; // raw — fist-hold selection wants this
  cursorPos.x = handData.x;
  cursorPos.y = handData.y;
  cursorEl.style.left = cursorPos.x * 100 + 'vw';
  cursorEl.style.top = cursorPos.y * 100 + 'vh';
  // Cursor color reflects the committed mode
  cursorEl.dataset.gesture =
    mode === 'pan' ? 'open'
    : mode === 'select' ? 'fist'
    : mode === 'zoom_in' || mode === 'zoom_out' ? 'pinch'
    : 'point';

  cursorNDC.x = cursorPos.x * 2 - 1;
  cursorNDC.y = -(cursorPos.y * 2 - 1);

  // Pan: only when hysteresis confirms 'pan' mode (open palm sustained)
  if (mode === 'pan') {
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

// ---------- Mouse / keyboard / touch input (desktop & mobile fallback) ----------
// Gated by controlMode — only active when the user chose "manual".
let controlMode = 'manual'; // 'hands' | 'manual'
const isManual = () => controlMode === 'manual';

let mouseDragging = false;
let mouseDragStart = null;
let mouseDragMoved = false;
let lastMouseNorm = null;
const DRAG_PX_THRESHOLD = 5;

function setMouseCursor(clientX, clientY, gesture) {
  cursorEl.classList.remove('hidden');
  cursorEl.style.left = clientX + 'px';
  cursorEl.style.top = clientY + 'px';
  cursorEl.dataset.gesture = gesture;
}

canvas.addEventListener('mousemove', (e) => {
  if (!isManual()) return;
  const nx = e.clientX / window.innerWidth;
  const ny = e.clientY / window.innerHeight;
  cursorNDC.x = nx * 2 - 1;
  cursorNDC.y = -(ny * 2 - 1);
  setMouseCursor(e.clientX, e.clientY, mouseDragging ? 'open' : 'point');

  if (mouseDragging) {
    if (mouseDragStart) {
      const dxPx = e.clientX - mouseDragStart.px;
      const dyPx = e.clientY - mouseDragStart.py;
      if (Math.hypot(dxPx, dyPx) > DRAG_PX_THRESHOLD) mouseDragMoved = true;
    }
    if (lastMouseNorm) {
      const dx = nx - lastMouseNorm.x;
      const dy = ny - lastMouseNorm.y;
      rotVelY += dx * 5;
      rotVelX += dy * 5;
    }
  }
  lastMouseNorm = { x: nx, y: ny };
});

canvas.addEventListener('mousedown', (e) => {
  if (!isManual()) return;
  mouseDragging = true;
  mouseDragMoved = false;
  mouseDragStart = { px: e.clientX, py: e.clientY };
  lastMouseNorm = {
    x: e.clientX / window.innerWidth,
    y: e.clientY / window.innerHeight,
  };
});

window.addEventListener('mouseup', () => {
  if (!isManual()) return;
  mouseDragging = false;
  mouseDragStart = null;
  lastMouseNorm = null;
});

let suppressNextClick = false;

canvas.addEventListener('click', () => {
  if (!isManual()) return;
  if (mouseDragMoved || suppressNextClick) {
    mouseDragMoved = false;
    suppressNextClick = false;
    return;
  }
  if (hoveredMesh) commitSelection(hoveredMesh);
});

// ---------- Touch input (mobile / tablet) ----------
let touchState = null; // { mode: 'drag'|'pinch', ... }
const TAP_PX_THRESHOLD = 8;

function touchToNorm(t) {
  return { x: t.clientX / window.innerWidth, y: t.clientY / window.innerHeight };
}

canvas.addEventListener(
  'touchstart',
  (e) => {
    if (!isManual()) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const n = touchToNorm(t);
      touchState = {
        mode: 'drag',
        last: n,
        startPx: { x: t.clientX, y: t.clientY },
        moved: false,
      };
      cursorNDC.x = n.x * 2 - 1;
      cursorNDC.y = -(n.y * 2 - 1);
    } else if (e.touches.length >= 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchState = { mode: 'pinch', lastDist: Math.hypot(dx, dy) };
      suppressNextClick = true;
    }
  },
  { passive: true }
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    if (!isManual()) return;
    if (!touchState) return;
    e.preventDefault();
    if (touchState.mode === 'drag' && e.touches.length === 1) {
      const t = e.touches[0];
      const n = touchToNorm(t);
      const dx = n.x - touchState.last.x;
      const dy = n.y - touchState.last.y;
      rotVelY += dx * 5;
      rotVelX += dy * 5;
      touchState.last = n;
      cursorNDC.x = n.x * 2 - 1;
      cursorNDC.y = -(n.y * 2 - 1);

      const movedPx = Math.hypot(
        t.clientX - touchState.startPx.x,
        t.clientY - touchState.startPx.y
      );
      if (movedPx > TAP_PX_THRESHOLD) {
        touchState.moved = true;
        suppressNextClick = true;
      }
    } else if (touchState.mode === 'pinch' && e.touches.length >= 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const delta = (touchState.lastDist - dist) * 0.005;
      cameraTargetZ = Math.max(
        ZOOM_NEAR,
        Math.min(ZOOM_FAR, cameraTargetZ + delta)
      );
      touchState.lastDist = dist;
    }
  },
  { passive: false }
);

canvas.addEventListener(
  'touchend',
  () => {
    if (!isManual()) return;
    touchState = null;
  },
  { passive: true }
);

canvas.addEventListener(
  'touchcancel',
  () => {
    if (!isManual()) return;
    touchState = null;
  },
  { passive: true }
);

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!isManual()) return;
    e.preventDefault();
    if (e.ctrlKey) {
      // Trackpad pinch arrives as a wheel event with ctrlKey: true → zoom.
      const delta = e.deltaY * 0.012;
      cameraTargetZ = Math.max(
        ZOOM_NEAR,
        Math.min(ZOOM_FAR, cameraTargetZ + delta)
      );
    } else {
      // Two-finger trackpad drag (or mouse-wheel scroll) → rotate the globe.
      // Inverted to match click-and-drag direction (sliding fingers right
      // grabs the globe and pulls it right, just like dragging with a click).
      const sensitivity = 0.0035;
      rotVelY -= e.deltaX * sensitivity;
      rotVelX -= e.deltaY * sensitivity;
    }
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (!isManual()) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const ROT_STEP = 0.08;
  const ZOOM_STEP = 0.25;
  switch (e.key) {
    case 'ArrowLeft':
      rotVelY -= ROT_STEP;
      break;
    case 'ArrowRight':
      rotVelY += ROT_STEP;
      break;
    case 'ArrowUp':
      rotVelX -= ROT_STEP;
      break;
    case 'ArrowDown':
      rotVelX += ROT_STEP;
      break;
    case '+':
    case '=':
      cameraTargetZ = Math.max(ZOOM_NEAR, cameraTargetZ - ZOOM_STEP);
      break;
    case '-':
    case '_':
      cameraTargetZ = Math.min(ZOOM_FAR, cameraTargetZ + ZOOM_STEP);
      break;
    case 'Enter':
    case ' ':
      if (hoveredMesh) commitSelection(hoveredMesh);
      e.preventDefault();
      break;
  }
});

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
let animateStarted = false;
let pushedHistoryState = false;

function goHome() {
  // Restore start screen, clear in-flight game state
  uiEl.classList.add('hidden');
  document.getElementById('home-btn').classList.add('hidden');
  const debugEl = document.getElementById('hand-debug');
  if (debugEl) debugEl.classList.add('hidden');
  document.body.classList.remove('hands-mode');
  startScreen.classList.remove('hidden');
  controlMode = 'manual'; // park between modes; real mode is set when user picks again
  cursorEl.classList.add('hidden');

  // Reset round state
  if (revealMesh) {
    revealMesh.material.color.setHex(revealMesh.userData.baseColor);
    revealMesh.material.opacity = 0;
    revealMesh = null;
    revealRotateActive = false;
  }
  hideRedOverlay();
  revealEndAt = 0;
  fistHoldStart = null;
  fillEl.style.width = '0%';
  progressEl.classList.add('hidden');
  score = 0;
  lives = MAX_LIVES;
  gameIsOver = false;
  scoreEl.textContent = '0';
  renderLives();
  gameOverEl.classList.add('hidden');

  // Reset start button so user can pick a mode again
  startBtn.disabled = false;
  startBtn.textContent = 'Start with hand tracking';
}

window.addEventListener('popstate', () => {
  if (!startScreen.classList.contains('hidden')) return;
  pushedHistoryState = false;
  goHome();
});

async function beginGame({ withHands }) {
  startBtn.disabled = true;
  const videoEl = document.getElementById('video');
  if (withHands) {
    startBtn.textContent = 'Starting camera...';
    try {
      await setupHands(onHand);
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start with hand tracking';
      alert(
        'Could not access webcam: ' +
          err.message +
          '\n\nYou can use the "Play with mouse / keyboard" button instead.'
      );
      return;
    }
    controlMode = 'hands';
    document.body.classList.add('hands-mode');
    if (videoEl) videoEl.style.display = '';
  } else {
    controlMode = 'manual';
    document.body.classList.remove('hands-mode');
    if (videoEl) videoEl.style.display = 'none';
  }
  startScreen.classList.add('hidden');
  uiEl.classList.remove('hidden');
  if (controlMode === 'manual') {
    document.getElementById('home-btn').classList.remove('hidden');
  } else {
    document.getElementById('home-btn').classList.add('hidden');
  }
  pickRandomCountry();
  rotVelY = 0.01;
  if (!animateStarted) {
    animateStarted = true;
    animate();
  }
  // Push a history entry so the device/browser back button returns to start
  if (!pushedHistoryState) {
    history.pushState({ inGame: true }, '');
    pushedHistoryState = true;
  }
}

document.getElementById('home-btn').addEventListener('click', () => {
  if (pushedHistoryState) {
    history.back(); // triggers popstate → goHome
  } else {
    goHome();
  }
});

startBtn.addEventListener('click', () => beginGame({ withHands: true }));
const startNoCamBtn = document.getElementById('start-btn-nocam');
if (startNoCamBtn) {
  startNoCamBtn.addEventListener('click', () =>
    beginGame({ withHands: false })
  );
}

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
