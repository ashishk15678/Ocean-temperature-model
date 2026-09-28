import * as THREE from 'three';
import { CONFIG } from './config';

const _center = new THREE.Vector3();
const _dir    = new THREE.Vector3();

/**
 * Converts a world-space intersection point on the globe into { lat, lon }.
 *
 * Derived from the actual GLB node matrices (see BackendProd analysis):
 *
 *   Combined transform maps sphere local axes to world axes as:
 *     sphere +X  (lon=0°,  lat=0°)  →  world +X
 *     sphere +Z  (lon=90°E, lat=0°) →  world +Y
 *     sphere -Y  (South Pole)       →  world +Z   ← North Pole = world -Z
 *
 *   Therefore, from a world-space direction vector (dx, dy, dz):
 *     lat = asin(-dz)           // North Pole is -Z
 *     lon = atan2(dy, dx)       // East is +Y, Prime Meridian is +X
 *
 * LONGITUDE_OFFSET can still be used to nudge texture alignment if needed.
 */
export function pointToLatLon(point, group) {
  group.getWorldPosition(_center);
  _dir.copy(point).sub(_center).normalize();

  const lat = THREE.MathUtils.radToDeg(
    Math.asin(THREE.MathUtils.clamp(-_dir.z, -1, 1))   // North Pole = -Z
  );

  let lon = THREE.MathUtils.radToDeg(Math.atan2(_dir.y, _dir.x))  // East = +Y
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
 * Inverse of pointToLatLon — converts geographic coords to a world-space
 * THREE.Vector3 on a sphere of the given radius.
 *
 * Inverse of:
 *   lat = asin(-dz)  → dz = -sin(lat)
 *   lon = atan2(dy, dx)
 *   |d| = 1 → dx² + dy² + dz² = 1
 *   dx = cos(lat) * cos(lon)
 *   dy = cos(lat) * sin(lon)
 *   dz = -sin(lat)
 */
export function latLonToVector3(lat, lon, radius = 100) {
  const latRad = lat * (Math.PI / 180);
  const lonRad = (lon + CONFIG.LONGITUDE_OFFSET) * (Math.PI / 180);
  return new THREE.Vector3(
    radius * Math.cos(latRad) * Math.cos(lonRad),   // +X = lon=0, lat=0
    radius * Math.cos(latRad) * Math.sin(lonRad),   // +Y = lon=90E, lat=0
    -radius * Math.sin(latRad),                      // -Z = North Pole
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
