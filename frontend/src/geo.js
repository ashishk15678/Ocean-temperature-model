import * as THREE from 'three';
import { CONFIG } from './config';

const _center = new THREE.Vector3();
const _dir    = new THREE.Vector3();

/**
 * Converts a world-space intersection point on the globe into { lat, lon }.
 *
 * The GLB file has three nested Rx rotations that combine to Rx(-π/2).
 * That remaps the sphere's local axes to world axes as:
 *
 *   local +Z (North Pole) → world +Y
 *   local +X (lon=0°)     → world +X
 *   local +Y (lon=90°E)   → world -Z
 *
 * Therefore, from a world-space direction vector (dx, dy, dz):
 *   lat = asin(dy)         — North Pole is +Y
 *   lon = atan2(-dz, dx)   — 90°E is -Z, 0° is +X
 *
 * LONGITUDE_OFFSET can be used to nudge texture alignment if needed.
 */
export function pointToLatLon(point, group) {
  group.getWorldPosition(_center);
  _dir.copy(point).sub(_center).normalize();

  const lat = THREE.MathUtils.radToDeg(
    Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1))   // North Pole = +Y
  );

  let lon = THREE.MathUtils.radToDeg(Math.atan2(-_dir.z, _dir.x))  // 90°E = -Z, 0° = +X
    + CONFIG.LONGITUDE_OFFSET;

  // Normalise to [-180, 180]
  lon = ((lon + 180) % 360 + 360) % 360 - 180;

  if (CONFIG.DEBUG_MODE) {
    console.log(
      `[geo] dir=(${_dir.x.toFixed(3)},${_dir.y.toFixed(3)},${_dir.z.toFixed(3)})` +
      ` → lat=${lat.toFixed(2)} lon=${lon.toFixed(2)}`
    );
  }

  return { lat, lon };
}

/**
 * Inverse of pointToLatLon — geographic coords → world-space THREE.Vector3.
 *
 *   lat = asin(dy)       → dy =  sin(lat)
 *   lon = atan2(-dz, dx) → dx =  cos(lat)·cos(lon)
 *                           dz = -cos(lat)·sin(lon)
 */
export function latLonToVector3(lat, lon, radius = 100) {
  const latRad = lat * (Math.PI / 180);
  const lonRad = (lon + CONFIG.LONGITUDE_OFFSET) * (Math.PI / 180);
  return new THREE.Vector3(
    radius * Math.cos(latRad) * Math.cos(lonRad),   // +X = lon=0°,  lat=0°
    radius * Math.sin(latRad),                       // +Y = North Pole
    -radius * Math.cos(latRad) * Math.sin(lonRad),  // -Z = lon=90°E, lat=0°
  );
}

export function formatCoord(value, positiveSuffix, negativeSuffix) {
  const suffix = value >= 0 ? positiveSuffix : negativeSuffix;
  return `${Math.abs(value).toFixed(2)}\u00B0${suffix}`;
}

export function formatLat(lat) { return formatCoord(lat, 'N', 'S'); }
export function formatLon(lon) { return formatCoord(lon, 'E', 'W'); }

export function formatMonth(targetMonth) {
  if (!targetMonth) return '';
  const [year, month] = targetMonth.split('-');
  return new Date(Number(year), Number(month) - 1, 1)
    .toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}
