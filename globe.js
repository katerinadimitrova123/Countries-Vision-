import * as THREE from 'three';
import earcut from 'earcut';
import * as topojson from 'topojson-client';




















export const RADIUS = 1;

function lngLatToVec3(lng, lat, radius = RADIUS) {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(phi) * Math.cos(lambda),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(lambda)
  );
}

function ringCrossesAntimeridian(ring) {
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) return true;
  }
  return false;
}

function unwrapRing(ring) {
  if (!ringCrossesAntimeridian(ring)) return ring;
  return ring.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat]);
}

function buildUVSphere(radius, segments, rings) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let r = 0; r <= rings; r++) {
    const lat = 90 - (r / rings) * 180;
    const phi = (lat * Math.PI) / 180;
    for (let s = 0; s <= segments; s++) {
      const lng = -180 + (s / segments) * 360;
      const lambda = (lng * Math.PI) / 180;
      positions.push(
        radius * Math.cos(phi) * Math.cos(lambda),
        radius * Math.sin(phi),
        -radius * Math.cos(phi) * Math.sin(lambda)
      );
      uvs.push(s / segments, 1 - r / rings);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export async function buildGlobe(parent) {
  // ---------- NASA Blue Marble visual sphere ----------
  const textureLoader = new THREE.TextureLoader();
  textureLoader.crossOrigin = 'anonymous';
  const earthTexture = await new Promise((resolve, reject) => {
    textureLoader.load(
      'https://unpkg.com/three-globe@2.34.4/example/img/earth-blue-marble.jpg',
      resolve,
      undefined,
      reject
    );
  });
  earthTexture.colorSpace = THREE.SRGBColorSpace;
  earthTexture.anisotropy = 8;

  const sphereGeo = buildUVSphere(RADIUS, 128, 64);
  const sphereMat = new THREE.MeshBasicMaterial({ map: earthTexture });
  const ocean = new THREE.Mesh(sphereGeo, sphereMat);
  parent.add(ocean);

  // ---------- Country interaction layer ----------
  const res = await fetch(
    'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'
  );
  if (!res.ok) throw new Error('Failed to load world map');
  const topology = await res.json();
  const geo = topojson.feature(topology, topology.objects.countries);

  const countryMeshes = [];
  const countriesGroup = new THREE.Group();
  const linePositions = [];

  for (const feature of geo.features) {
    const name = feature.properties.name;
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;

    const meshPositions = [];
    const meshIndices = [];
    let vertexOffset = 0;

    for (const polygon of polygons) {
      // Borders (skip antimeridian wrap segment)
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lng1, lat1] = ring[i];
          const [lng2, lat2] = ring[i + 1];
          if (Math.abs(lng2 - lng1) > 180) continue;
          const a = lngLatToVec3(lng1, lat1, RADIUS * 1.005);
          const b = lngLatToVec3(lng2, lat2, RADIUS * 1.005);
          linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }

      // Fill: outer ring only, with antimeridian unwrap so every country
      // (including Russia / USA-Alaska) gets a hover mesh.
      const outerRing = unwrapRing(polygon[0]);
      const flatCoords = [];
      for (const [lng, lat] of outerRing) flatCoords.push(lng, lat);
      const indices = earcut(flatCoords, [], 2);
      if (indices.length === 0) continue;

      const positions = [];
      for (let i = 0; i < flatCoords.length; i += 2) {
        const v = lngLatToVec3(flatCoords[i], flatCoords[i + 1], RADIUS * 1.012);
        positions.push(v.x, v.y, v.z);
      }

      meshPositions.push(...positions);
      for (const idx of indices) meshIndices.push(idx + vertexOffset);
      vertexOffset += positions.length / 3;
    }

    if (meshIndices.length === 0) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(meshPositions, 3)
    );
    geometry.setIndex(meshIndices);

    const baseColor = 0xf2efe6;
    // Transparent at opacity 0 by default — invisible, but raycaster still
    // hits it. main.js bumps opacity to 1 on hover/reveal/explosion.
    const material = new THREE.MeshBasicMaterial({
      color: baseColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10;
    mesh.userData.name = name;
    mesh.userData.id = feature.id; // ISO 3166-1 numeric code, e.g. "196" for Cyprus
    mesh.userData.baseColor = baseColor;
    countryMeshes.push(mesh);
    countriesGroup.add(mesh);
  }

  parent.add(countriesGroup);

  // White-ish border lines so countries are visually delineated against
  // the photorealistic texture.
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(linePositions, 3)
  );
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  parent.add(lines);

  return { countryMeshes, countriesGroup, lines, ocean };
}
