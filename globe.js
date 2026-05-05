import * as THREE from 'three';
import earcut from 'earcut';
import * as topojson from 'topojson-client';

export const RADIUS = 1;

function lngLatToVec3(lng, lat, radius = RADIUS) {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  const x = radius * Math.cos(phi) * Math.cos(lambda);
  const y = radius * Math.sin(phi);
  const z = -radius * Math.cos(phi) * Math.sin(lambda);
  return new THREE.Vector3(x, y, z);
}

function ringCrossesAntimeridian(ring) {
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) return true;
  }
  return false;
}

export async function buildGlobe(parent) {
  const oceanGeo = new THREE.SphereGeometry(RADIUS * 0.998, 96, 96);
  const oceanMat = new THREE.MeshBasicMaterial({ color: 0x0e1a2b });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  parent.add(ocean);

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
      const outer = polygon[0];
      const skipFill = ringCrossesAntimeridian(outer);

      // Borders: always draw
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lng1, lat1] = ring[i];
          const [lng2, lat2] = ring[i + 1];
          if (Math.abs(lng2 - lng1) > 180) continue; // skip antimeridian wrap segment
          const a = lngLatToVec3(lng1, lat1, RADIUS * 1.003);
          const b = lngLatToVec3(lng2, lat2, RADIUS * 1.003);
          linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }

      if (skipFill) continue;

      const flatCoords = [];
      const holes = [];
      let cursor = 0;
      for (let r = 0; r < polygon.length; r++) {
        const ring = polygon[r];
        if (r > 0) holes.push(cursor);
        for (const [lng, lat] of ring) {
          flatCoords.push(lng, lat);
          cursor++;
        }
      }

      const indices = earcut(flatCoords, holes, 2);
      if (indices.length === 0) continue;

      const positions = [];
      for (let i = 0; i < flatCoords.length; i += 2) {
        const v = lngLatToVec3(flatCoords[i], flatCoords[i + 1], RADIUS * 1.001);
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
    geometry.computeVertexNormals();

    const baseColor = 0xf2efe6;
    const material = new THREE.MeshBasicMaterial({
      color: baseColor,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.name = name;
    mesh.userData.baseColor = baseColor;
    countryMeshes.push(mesh);
    countriesGroup.add(mesh);
  }

  parent.add(countriesGroup);

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(linePositions, 3)
  );
  const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  parent.add(lines);

  return { countryMeshes, countriesGroup, lines, ocean };
}
