import React, { useState, Suspense, useRef, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

import { pointToLatLon, latLonToVector3, formatLat, formatLon } from './geo';
import { classifyIntersection } from './ocean-detection';
import { fetchTemperatureProfile, fetchHealth } from './ocean-api';
import { temperatureToCSS, temperatureToRGB, makeNormalizer } from './color-scale';
import { CONFIG } from './config';
import { useAlarms } from './use-alarms';
import AlarmPanel from './AlarmPanel';

// ─── Stars ───────────────────────────────────────────────────────────────────

function StarField({ count = 2200, paused }) {
  const groupRef = useRef();

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 800 + Math.random() * 400;
      arr[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  const sizes = useMemo(() => {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) arr[i] = 0.6 + Math.random() * 2.2;
    return arr;
  }, [count]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, [positions, sizes]);

  useFrame((_, delta) => {
    if (paused || !groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.02;
  });

  return (
    <group ref={groupRef}>
      <points geometry={geometry}>
        <pointsMaterial color="#ffffff" size={1.5} sizeAttenuation={false}
          transparent opacity={0.85} depthWrite={false} />
      </points>
    </group>
  );
}

// ─── Shooting stars ───────────────────────────────────────────────────────────

const SHOOTING_COUNT = 3;

function randomShootingStar() {
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const r = 700;
  const sx = r * Math.sin(phi) * Math.cos(theta);
  const sy = r * Math.sin(phi) * Math.sin(theta);
  const sz = r * Math.cos(phi);
  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * 0.6 - sx * 0.003,
    (Math.random() - 0.5) * 0.6 - sy * 0.003,
    (Math.random() - 0.5) * 0.6 - sz * 0.003,
  ).normalize();
  return {
    start: new THREE.Vector3(sx, sy, sz), dir,
    speed: 180 + Math.random() * 320, length: 60 + Math.random() * 120,
    progress: Math.random(), active: Math.random() > 0.5,
    delay: 2 + Math.random() * 8, delayLeft: 0,
  };
}

function ShootingStars({ paused }) {
  const starsRef  = useRef(Array.from({ length: SHOOTING_COUNT }, randomShootingStar));
  const posRef    = useRef(new Float32Array(SHOOTING_COUNT * 2 * 3));
  const colorRef  = useRef(new Float32Array(SHOOTING_COUNT * 2 * 3));
  const geoRef    = useRef();

  useFrame((_, delta) => {
    if (paused) return;
    const pos = posRef.current;
    const col = colorRef.current;
    starsRef.current.forEach((s, i) => {
      if (!s.active) {
        s.delayLeft -= delta;
        if (s.delayLeft <= 0) {
          const fresh = randomShootingStar();
          fresh.active = true; fresh.progress = 0; fresh.delayLeft = 0;
          starsRef.current[i] = fresh;
        }
        const base = i * 6;
        for (let k = 0; k < 6; k++) { pos[base + k] = 0; col[base + k] = 0; }
        return;
      }
      s.progress += delta * s.speed;
      if (s.progress > s.length + 60) { s.active = false; s.delayLeft = s.delay; return; }
      const hx = s.start.x + s.dir.x * s.progress;
      const hy = s.start.y + s.dir.y * s.progress;
      const hz = s.start.z + s.dir.z * s.progress;
      const tailDist = Math.min(s.progress, s.length);
      const base = i * 6;
      pos[base] = hx; pos[base+1] = hy; pos[base+2] = hz;
      pos[base+3] = hx - s.dir.x * tailDist;
      pos[base+4] = hy - s.dir.y * tailDist;
      pos[base+5] = hz - s.dir.z * tailDist;
      const fade = Math.min(1, s.progress / 20);
      col[base] = fade; col[base+1] = fade; col[base+2] = fade;
      col[base+3] = 0; col[base+4] = 0; col[base+5] = 0;
    });
    if (geoRef.current) {
      geoRef.current.attributes.position.needsUpdate = true;
      geoRef.current.attributes.color.needsUpdate = true;
    }
  });

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posRef.current, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colorRef.current, 3));
    geoRef.current = geo;
    return geo;
  }, []);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  );
}

// ─── Asteroids ────────────────────────────────────────────────────────────────

function makeAsteroidGeo(radius, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position;
  const rng = (n) => { const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < pos.count; i++) {
    const j = 0.35 + rng(i) * 0.3;
    pos.setXYZ(i, pos.getX(i) * j * 2.8, pos.getY(i) * j * 2.8, pos.getZ(i) * j * 2.8);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function randomAsteroid(index) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 350 + Math.random() * 320;
  return {
    pos: new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)),
    vel: new THREE.Vector3((Math.random()-0.5)*4, (Math.random()-0.5)*4, (Math.random()-0.5)*4),
    rotAxis: new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize(),
    rotSpeed: 0.1 + Math.random() * 0.4, rot: Math.random() * Math.PI * 2,
    radius: 2.5 + Math.random() * 4.5, seed: index * 17 + Math.random() * 100,
    color: new THREE.Color().setHSL(0.07 + Math.random() * 0.06, 0.25, 0.38 + Math.random() * 0.18),
  };
}

function AsteroidMesh({ data, paused }) {
  const meshRef = useRef();
  const geo = useMemo(() => makeAsteroidGeo(1, data.seed), [data.seed]);
  useFrame((_, delta) => {
    if (paused || !meshRef.current) return;
    data.rot += data.rotSpeed * delta;
    meshRef.current.setRotationFromAxisAngle(data.rotAxis, data.rot);
    data.pos.addScaledVector(data.vel, delta);
    if (data.pos.length() > 900) data.vel.negate();
    meshRef.current.position.copy(data.pos);
    meshRef.current.scale.setScalar(data.radius);
  });
  return (
    <mesh ref={meshRef} geometry={geo} position={data.pos}>
      <meshStandardMaterial color={data.color} roughness={0.92} metalness={0.18} flatShading />
    </mesh>
  );
}

function Asteroids({ paused }) {
  const asteroids = useMemo(() => Array.from({ length: 7 }, (_, i) => randomAsteroid(i)), []);
  return <>{asteroids.map((a, i) => <AsteroidMesh key={i} data={a} paused={paused} />)}</>;
}

// ─── Geological cross-section ─────────────────────────────────────────────────

function createWavyLayerShape(width, height, waveIntensity, seed) {
  const shape = new THREE.Shape();
  const segments = 50;
  const sw = width / segments;
  shape.moveTo(-width / 2, -height / 2);
  for (let i = 0; i <= segments; i++) {
    const x = -width / 2 + i * sw;
    const wave = Math.sin((i / segments) * Math.PI * 4 + seed) * waveIntensity
               + Math.sin((i / segments) * Math.PI * 7 + seed * 1.3) * waveIntensity * 0.5;
    i === 0 ? shape.moveTo(x, height / 2 + wave) : shape.lineTo(x, height / 2 + wave);
  }
  shape.lineTo(width / 2, -height / 2);
  for (let i = segments; i >= 0; i--) {
    const x = -width / 2 + i * sw;
    shape.lineTo(x, -height / 2 + Math.sin((i / segments) * Math.PI * 3 + seed + 0.5) * waveIntensity * 0.3);
  }
  shape.closePath();
  return shape;
}

function OrganicLayer({ depth, temp, index, totalLayers, normalize, show, allTemps }) {
  const meshRef = useRef();
  const [scale, setScale] = useState(0);
  const [opacity, setOpacity] = useState(0);

  const nt = normalize(temp);
  const [r, g, b] = temperatureToRGB(nt);
  const color = useMemo(() => new THREE.Color(r/255, g/255, b/255), [r, g, b]);

  const prev = index > 0 ? allTemps[index-1] : temp;
  const next = index < totalLayers-1 ? allTemps[index+1] : temp;
  const [r1, g1, b1] = temperatureToRGB(normalize(prev));
  const [r2, g2, b2] = temperatureToRGB(normalize(next));

  const layerGeometry = useMemo(() => {
    const shape = createWavyLayerShape(180, 2.5, 0.6 + index * 0.01, index * 2.5);
    return new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.1, bevelSegments: 2 });
  }, [index]);

  const gradientTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `rgb(${r1},${g1},${b1})`);
    grad.addColorStop(0.5, `rgb(${r},${g},${b})`);
    grad.addColorStop(1, `rgb(${r2},${g2},${b2})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [r, g, b, r1, g1, b1, r2, g2, b2]);

  const spacing = 60 / totalLayers;
  const yPosition = (totalLayers / 2 - index - 0.5) * spacing;

  useFrame(() => {
    if (show) {
      if (scale < 1) setScale(p => Math.min(p + 0.04, 1));
      if (opacity < 0.95) setOpacity(p => Math.min(p + 0.04, 0.95));
    } else {
      if (opacity > 0) setOpacity(p => Math.max(p - 0.08, 0));
      if (scale > 0) setScale(p => Math.max(p - 0.08, 0));
    }
  });

  if (opacity === 0) return null;

  return (
    <group position={[0, yPosition, 0]}>
      <mesh ref={meshRef} geometry={layerGeometry} scale={[scale, 1, 1]}>
        <meshStandardMaterial map={gradientTexture} transparent opacity={opacity}
          emissive={color} emissiveIntensity={0.2} roughness={0.9} metalness={0.05}
          side={THREE.DoubleSide} />
      </mesh>
      {opacity > 0.3 && (
        <>
          <mesh position={[-92, 0, 1.5]}>
            <cylinderGeometry args={[0.2, 0.2, spacing * 0.6, 8]} />
            <meshBasicMaterial color={color} transparent opacity={opacity * 0.8} />
          </mesh>
          <mesh position={[92, 0, 1.5]}>
            <cylinderGeometry args={[0.2, 0.2, spacing * 0.6, 8]} />
            <meshBasicMaterial color={color} transparent opacity={opacity * 0.8} />
          </mesh>
        </>
      )}
    </group>
  );
}

function GeologicalCrossSection({ profile, show, clickedPoint }) {
  if (!profile) return null;
  const { depths_m, temperature_celsius } = profile;
  const normalize = useMemo(() => makeNormalizer(temperature_celsius), [temperature_celsius]);
  const layerPosition = useMemo(() =>
    clickedPoint ? clickedPoint.clone().normalize().multiplyScalar(102) : new THREE.Vector3(0, 0, 0),
    [clickedPoint]
  );
  return (
    <group position={layerPosition}>
      {depths_m.map((depth, i) => (
        <OrganicLayer key={i} depth={depth} temp={temperature_celsius[i]}
          index={i} totalLayers={depths_m.length} normalize={normalize}
          show={show} allTemps={temperature_celsius} />
      ))}
      {show && (
        <>
          <mesh position={[-93, 0, 1.5]}>
            <cylinderGeometry args={[0.1, 0.1, 60, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
          </mesh>
          <mesh position={[93, 0, 1.5]}>
            <cylinderGeometry args={[0.1, 0.1, 60, 8]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ─── Data overlay ─────────────────────────────────────────────────────────────

const DataOverlay = React.memo(function DataOverlay({ profile, show }) {
  if (!profile || !show) return null;
  const { depths_m, temperature_celsius } = profile;
  const normalize = useMemo(() => makeNormalizer(temperature_celsius), [temperature_celsius]);
  const viewHeight = window.innerHeight * 0.85;
  const itemHeight = viewHeight / depths_m.length;

  return (
    <div style={{
      position: 'absolute', top: '50%', left: 0, right: 0,
      transform: 'translateY(-50%)', pointerEvents: 'none',
      display: 'flex', justifyContent: 'space-between',
      padding: '0 40px', height: viewHeight,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', width: 120 }}>
        {depths_m.map((depth, i) => {
          const nt = normalize(temperature_celsius[i]);
          const [r, g, b]   = temperatureToRGB(nt);
          const [r1, g1, b1] = temperatureToRGB(i > 0 ? normalize(temperature_celsius[i-1]) : nt);
          const [r2, g2, b2] = temperatureToRGB(i < depths_m.length-1 ? normalize(temperature_celsius[i+1]) : nt);
          return (
            <div key={i} style={{
              padding: `${Math.max(8, itemHeight * 0.3)}px 20px`,
              background: `linear-gradient(180deg,rgb(${r1},${g1},${b1}) 0%,rgb(${r},${g},${b}) 50%,rgb(${r2},${g2},${b2}) 100%)`,
              color: 'white', fontSize: Math.max(12, Math.min(15, itemHeight * 0.4)),
              fontWeight: 700, borderRadius: 8, textAlign: 'center',
              boxShadow: `0 4px 16px rgba(${r},${g},${b},0.5)`,
              border: '2px solid rgba(255,255,255,0.4)', backdropFilter: 'blur(8px)',
              animation: `slideInLeft 0.5s ease-out ${i * 0.03}s both`,
              minHeight: Math.max(30, itemHeight * 0.7),
            }}>{depth}m</div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', width: 130 }}>
        {temperature_celsius.map((temp, i) => {
          const [r, g, b] = temperatureToRGB(normalize(temp));
          return (
            <div key={i} style={{
              padding: `${Math.max(8, itemHeight * 0.3)}px 20px`,
              background: 'rgba(0,0,0,0.92)', color: `rgb(${r},${g},${b})`,
              fontSize: Math.max(13, Math.min(16, itemHeight * 0.45)),
              fontWeight: 700, fontFamily: 'monospace', borderRadius: 8, textAlign: 'center',
              boxShadow: `0 4px 16px rgba(${r},${g},${b},0.6)`,
              border: `2px solid rgb(${r},${g},${b})`, backdropFilter: 'blur(8px)',
              animation: `slideInRight 0.5s ease-out ${i * 0.03}s both`,
              minHeight: Math.max(30, itemHeight * 0.7),
            }}>{temp.toFixed(1)}°C</div>
          );
        })}
      </div>
      <style>{`
        @keyframes slideInLeft  { from { opacity:0; transform:translateX(-50px) } to { opacity:1; transform:translateX(0) } }
        @keyframes slideInRight { from { opacity:0; transform:translateX(50px)  } to { opacity:1; transform:translateX(0) } }
      `}</style>
    </div>
  );
});

// ─── Info sidebar ─────────────────────────────────────────────────────────────

const InfoSidebar = React.memo(function InfoSidebar({ profile, latitude, longitude }) {
  if (!profile) return null;
  const { temperature_celsius } = profile;
  const surface = temperature_celsius[0];
  const deep = temperature_celsius[temperature_celsius.length - 1];
  return (
    <div style={{
      position: 'absolute', top: 20, left: 20, maxWidth: 300,
      backgroundColor: 'rgba(10,10,15,0.95)', color: 'white',
      padding: 20, borderRadius: 12, fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.8)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 700 }}>
        {profile.region_name ?? 'Ocean Location'}
      </h3>
      <p style={{ fontSize: 14, margin: 0, opacity: 0.9 }}>
        {formatLat(latitude)} {formatLon(longitude)}
      </p>
      {profile.date && (
        <p style={{ fontSize: 12, margin: '4px 0 0', opacity: 0.6 }}>Date: {profile.date}</p>
      )}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {[['Surface', surface], ['Deep (1000 m)', deep], ['Range', (surface - deep)]].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ opacity: 0.8 }}>{label}:</span>
            <span style={{ fontWeight: 700 }}>{val.toFixed(1)}°C</span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── Error boundary ───────────────────────────────────────────────────────────

class ModelErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <mesh><sphereGeometry args={[50, 32, 32]} /><meshStandardMaterial color="red" wireframe /></mesh>
    );
    return this.props.children;
  }
}

// ─── Camera controller ────────────────────────────────────────────────────────

function CameraController({ stage, clickedPoint, onComplete }) {
  const { camera, controls } = useThree();
  const animRef = useRef({ isAnimating: false });

  React.useEffect(() => {
    if (!stage || animRef.current.isAnimating) return;
    animRef.current.isAnimating = true;

    if (stage === 'zoom-in' && clickedPoint) {
      if (controls) { controls.enabled = false; controls.autoRotate = false; }
      const startPos = camera.position.clone();
      const endPos = clickedPoint.clone().normalize().multiplyScalar(140);
      const startLookAt = new THREE.Vector3(0, 0, 0);
      const endLookAt = clickedPoint.clone().normalize().multiplyScalar(50);
      const duration = 2000; const t0 = Date.now();
      const animate = () => {
        const p = Math.min((Date.now() - t0) / duration, 1);
        const e = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p+2,3)/2;
        camera.position.lerpVectors(startPos, endPos, e);
        const lk = new THREE.Vector3().lerpVectors(startLookAt, endLookAt, e);
        camera.lookAt(lk);
        if (controls) controls.target.copy(lk);
        if (p < 1) requestAnimationFrame(animate);
        else { animRef.current.isAnimating = false; onComplete?.(); }
      };
      animate();
    } else if (stage === 'zoom-out') {
      const startPos = camera.position.clone();
      const endPos = new THREE.Vector3(0, 0, 250);
      const startLookAt = controls?.target.clone() ?? new THREE.Vector3();
      const endLookAt = new THREE.Vector3(0, 0, 0);
      const duration = 1500; const t0 = Date.now();
      const animate = () => {
        const p = Math.min((Date.now() - t0) / duration, 1);
        const e = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2,2)/2;
        camera.position.lerpVectors(startPos, endPos, e);
        const lk = new THREE.Vector3().lerpVectors(startLookAt, endLookAt, e);
        camera.lookAt(lk);
        if (controls) controls.target.copy(lk);
        if (p < 1) requestAnimationFrame(animate);
        else {
          animRef.current.isAnimating = false;
          if (controls) { controls.enabled = true; controls.target.set(0, 0, 0); }
          onComplete?.();
        }
      };
      animate();
    } else if (stage === 'focus') {
      // Fly to a lat/lon on the globe surface — use latLonToVector3 for consistency
      if (controls) { controls.enabled = false; }
      const lat = clickedPoint?.lat ?? 0;
      const lon = clickedPoint?.lon ?? 0;
      // latLonToVector3 gives unit-sphere coords × radius; multiply to camera distance
      const dir = latLonToVector3(lat, lon, 1); // unit vector
      const endPos = dir.multiplyScalar(200);
      const startPos = camera.position.clone();
      const duration = 1800; const t0 = Date.now();
      const animate = () => {
        const p = Math.min((Date.now() - t0) / duration, 1);
        const e = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p+2,3)/2;
        camera.position.lerpVectors(startPos, endPos, e);
        camera.lookAt(0, 0, 0);
        if (controls) controls.target.set(0, 0, 0);
        if (p < 1) requestAnimationFrame(animate);
        else {
          animRef.current.isAnimating = false;
          if (controls) { controls.enabled = true; }
          onComplete?.();
        }
      };
      animate();
    }
  }, [stage, clickedPoint, camera, controls, onComplete]);

  return null;
}

// ─── Earth ────────────────────────────────────────────────────────────────────

function Earth({ onOceanClick, dimmed, onHover }) {
  const { scene } = useGLTF('/earth.glb');
  const groupRef = useRef();

  const earthTexture = useMemo(() => {
    const tex = new THREE.TextureLoader().load('/earth-texture-extracted.jpg');
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  React.useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 100 / Math.max(size.x, size.y, size.z);
    scene.scale.multiplyScalar(scale);
    scene.position.sub(center.multiplyScalar(scale));
    scene.traverse(child => {
      if (!child.isMesh) return;
      child.material = new THREE.MeshStandardMaterial({
        map: earthTexture, roughness: 0.8, metalness: 0.2,
        transparent: dimmed, opacity: dimmed ? 0.15 : 1,
      });
      child.castShadow = true; child.receiveShadow = true;
    });
  }, [scene, earthTexture, dimmed]);

  const handlePointerMove = useCallback((e) => {
    if (dimmed || !onHover) return;
    const intersection = e.intersections[0];
    if (!intersection) return;
    const { lat, lon } = pointToLatLon(intersection.point, scene);
    onHover({ lat, lon });
  }, [dimmed, scene, onHover]);

  const handlePointerLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  const handleClick = useCallback((e) => {
    if (dimmed) return;
    e.stopPropagation();
    const intersection = e.intersections[0];
    if (!intersection) return;
    if (classifyIntersection(intersection) === 'land') {
      alert('Please click on an ocean region.');
      return;
    }
    const { lat, lon } = pointToLatLon(intersection.point, scene);
    onOceanClick({ lat, lon, point: intersection.point.clone() });
  }, [dimmed, scene, onOceanClick]);

  return (
    <primitive
      ref={groupRef}
      object={scene}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    />
  );
}

useGLTF.preload('/earth.glb');

// ─── Health widget ────────────────────────────────────────────────────────────

const HealthWidget = React.memo(function HealthWidget({ healthData, healthStatus, onCheck }) {
  const [showToast, setShowToast] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [dots, setDots] = useState('');

  React.useEffect(() => {
    if (healthStatus !== 'checking') { setDots(''); return; }
    let i = 0;
    const id = setInterval(() => { i = (i+1)%4; setDots('.'.repeat(i)); }, 150);
    return () => clearInterval(id);
  }, [healthStatus]);

  React.useEffect(() => {
    if (healthStatus !== 'healthy') return;
    setShowToast(true);
    const rAF = requestAnimationFrame(() => setToastVisible(true));
    const hide = setTimeout(() => setToastVisible(false), 3000);
    const rem  = setTimeout(() => setShowToast(false), 3400);
    return () => { cancelAnimationFrame(rAF); clearTimeout(hide); clearTimeout(rem); };
  }, [healthStatus]);

  const isChecking = healthStatus === 'checking';
  const isHealthy  = healthStatus === 'healthy';
  const isError    = healthStatus === 'error';

  return (
    <>
      <style>{`
        @keyframes hc-spin { to { transform: rotate(360deg); } }
        @keyframes hc-ping { 0% { transform:scale(1);opacity:0.8 } 70% { transform:scale(2.2);opacity:0 } 100% { transform:scale(2.2);opacity:0 } }
        .hc-btn { all:unset; box-sizing:border-box; position:relative; display:inline-flex; align-items:center; gap:8px; padding:8px 15px 8px 12px; border-radius:9px; background:rgba(9,9,18,0.88); border:1px solid rgba(255,255,255,0.10); color:rgba(220,220,240,0.85); font-family:'SF Mono','Fira Code',ui-monospace,monospace; font-size:12px; letter-spacing:0.04em; cursor:pointer; backdrop-filter:blur(14px); box-shadow:0 2px 12px rgba(0,0,0,0.55); transition:border-color 0.18s,box-shadow 0.18s; user-select:none; }
        .hc-btn:not([data-checking]):hover { border-color:rgba(255,255,255,0.22); background:rgba(14,14,28,0.96); }
        .hc-dot-wrap { position:relative; width:8px; height:8px; flex-shrink:0; }
        .hc-dot { width:8px; height:8px; border-radius:50%; position:absolute; inset:0; }
        .hc-ping { width:8px; height:8px; border-radius:50%; position:absolute; inset:0; animation:hc-ping 1.4s ease-out infinite; }
        .hc-spinner { width:10px; height:10px; border-radius:50%; border:1.5px solid rgba(250,204,21,0.25); border-top-color:#facc15; animation:hc-spin 0.65s linear infinite; flex-shrink:0; }
        .hc-toast { position:fixed; bottom:80px; left:24px; display:flex; align-items:center; gap:10px; padding:11px 16px; border-radius:10px; background:rgba(9,9,18,0.94); border:1px solid rgba(34,197,94,0.30); box-shadow:0 4px 24px rgba(0,0,0,0.55); backdrop-filter:blur(16px); font-family:'SF Mono','Fira Code',ui-monospace,monospace; font-size:12px; color:rgba(220,240,220,0.9); letter-spacing:0.04em; z-index:200; pointer-events:none; transform:translateY(8px); opacity:0; transition:transform 0.28s cubic-bezier(.22,1,.36,1),opacity 0.22s ease; }
        .hc-toast[data-visible] { transform:translateY(0); opacity:1; }
      `}</style>
      <button className="hc-btn" onClick={isChecking ? undefined : onCheck}
        data-checking={isChecking || undefined}
        style={{ position:'absolute', bottom:24, left:24, zIndex:99 }} title="GET /health">
        {isChecking ? (
          <><span className="hc-spinner" /><span style={{ whiteSpace:'nowrap' }}>GET /health{dots}</span></>
        ) : isHealthy ? (
          <>
            <span className="hc-dot-wrap">
              <span className="hc-ping" style={{ background:'rgba(34,197,94,0.4)' }} />
              <span className="hc-dot" style={{ background:'#22c55e', boxShadow:'0 0 6px #22c55e99' }} />
            </span>
            <span style={{ whiteSpace:'nowrap', color:'#22c55e', fontWeight:600 }}>
              {healthData?.device ?? 'healthy'} · 200
            </span>
          </>
        ) : isError ? (
          <>
            <span className="hc-dot-wrap">
              <span className="hc-dot" style={{ background:'#ef4444' }} />
            </span>
            <span style={{ whiteSpace:'nowrap', color:'#ef4444' }}>GET /health · error</span>
          </>
        ) : (
          <>
            <span className="hc-dot-wrap">
              <span className="hc-dot" style={{ background:'rgba(255,255,255,0.2)' }} />
            </span>
            <span style={{ whiteSpace:'nowrap' }}>GET /health</span>
          </>
        )}
      </button>
      {showToast && (
        <div className="hc-toast" data-visible={toastVisible || undefined}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 8px #22c55e', flexShrink:0 }} />
          <span>
            <span style={{ color:'#22c55e', fontWeight:700 }}>200</span>{' '}
            OK — model {healthData?.model_loaded ? 'loaded' : 'not loaded'} · {healthData?.device}
          </span>
        </div>
      )}
    </>
  );
});

// ─── Control buttons (play/pause + focus) ─────────────────────────────────────

const btnBase = {
  all: 'unset', boxSizing: 'border-box', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: 600,
  backdropFilter: 'blur(12px)', transition: 'all 0.2s',
  boxShadow: '0 4px 16px rgba(0,0,0,0.5)', userSelect: 'none',
  border: '1px solid rgba(255,255,255,0.12)', color: '#fff',
};

const ControlBar = React.memo(function ControlBar({ paused, onTogglePause, onFocus, showCrossSection }) {
  const [focusOpen, setFocusOpen] = useState(false);

  const regions = useMemo(() => [CONFIG.ARABIAN_SEA, CONFIG.BAY_OF_BENGAL], []);

  return (
    <div style={{
      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 10, alignItems: 'center', zIndex: 99,
      pointerEvents: showCrossSection ? 'none' : 'auto',
      opacity: showCrossSection ? 0 : 1, transition: 'opacity 0.3s',
    }}>
      {/* Play / Pause */}
      <button
        style={{ ...btnBase, background: paused ? 'rgba(99,102,241,0.85)' : 'rgba(30,30,50,0.85)', minWidth: 44 }}
        onClick={onTogglePause}
        title={paused ? 'Resume rotation' : 'Pause rotation'}
      >
        {paused ? '▶ Play' : '⏸ Pause'}
      </button>

      {/* Focus dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...btnBase, background: 'rgba(14,165,233,0.8)', minWidth: 160 }}
          onClick={() => setFocusOpen(o => !o)}
          title="Fly to a focus region"
        >
          🎯 Focus Region {focusOpen ? '▲' : '▼'}
        </button>
        {focusOpen && (
          <div style={{
            position: 'absolute', bottom: '110%', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(8,8,20,0.97)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, overflow: 'hidden', minWidth: 180,
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)', backdropFilter: 'blur(16px)',
          }}>
            {regions.map(region => (
              <button key={region.label} style={{
                ...btnBase, width: '100%', borderRadius: 0, border: 'none',
                background: 'transparent', padding: '12px 18px', justifyContent: 'flex-start',
                fontSize: 13,
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(14,165,233,0.25)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { setFocusOpen(false); onFocus(region); }}
              >
                🌊 {region.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [showCrossSection, setShowCrossSection] = useState(false);
  const [cameraStage, setCameraStage] = useState(null);
  const [cameraTarget, setCameraTarget] = useState(null); // Vector3 for zoom, {lat,lon} for focus
  const [clickedLocation, setClickedLocation] = useState(null);
  const [showAlarmPanel, setShowAlarmPanel] = useState(false);
  const [healthStatus, setHealthStatus] = useState('idle');
  const [healthData, setHealthData] = useState(null);
  const [paused, setPaused] = useState(false);
  const [hoverCoords, setHoverCoords] = useState(null); // { lat, lon } | null
  const controlsRef = useRef();

  const { alarms, error: alarmError, addAlarm, removeAlarm } = useAlarms(CONFIG.ALARM_POLL_INTERVAL_MS);

  const handleHealthCheck = useCallback(async () => {
    if (healthStatus === 'checking') return;
    setHealthStatus('checking');
    try {
      const data = await fetchHealth();
      setHealthData(data);
      setHealthStatus('healthy');
    } catch {
      setHealthStatus('error');
    }
  }, [healthStatus]);

  const handleOceanClick = useCallback(async ({ lat, lon, point }) => {
    // Validate the click is inside the model's grid before starting any animation
    const { LAT_MIN, LAT_MAX, LON_MIN, LON_MAX } = CONFIG.GRID;
    if (lat < LAT_MIN || lat > LAT_MAX || lon < LON_MIN || lon > LON_MAX) {
      setError(
        `This spot (${lat.toFixed(1)}°N, ${lon.toFixed(1)}°E) is outside the model grid. ` +
        `Supported area: ${LAT_MIN}–${LAT_MAX}°N, ${LON_MIN}–${LON_MAX}°E (Indian Ocean region).`
      );
      return;
    }

    setLoading(true);
    setError(null);
    setShowCrossSection(false);
    setClickedLocation({ lat, lon });
    setCameraTarget(point);
    setCameraStage('zoom-in');
    try {
      const data = await fetchTemperatureProfile({ latitude: lat, longitude: lon });
      setProfile(data);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      setCameraStage(null);
    }
  }, []);

  const handleZoomComplete = useCallback(() => {
    setCameraStage(null);
    setLoading(false);
    setTimeout(() => setShowCrossSection(true), 200);
  }, []);

  const handleZoomOutComplete = useCallback(() => {
    setCameraStage(null);
    setShowCrossSection(false);
    setProfile(null);
    setClickedLocation(null);
    setCameraTarget(null);
  }, []);

  const handleResetView = useCallback(() => {
    setShowCrossSection(false);
    setTimeout(() => { setCameraTarget(null); setCameraStage('zoom-out'); }, 300);
  }, []);

  const handleFocus = useCallback((region) => {
    setCameraTarget(region); // { lat, lon, label }
    setCameraStage('focus');
  }, []);

  const handleFocusComplete = useCallback(() => {
    setCameraStage(null);
    setCameraTarget(null);
  }, []);

  // Route camera complete to the right handler
  const handleCameraComplete = useCallback(() => {
    if (cameraStage === 'zoom-in') handleZoomComplete();
    else if (cameraStage === 'zoom-out') handleZoomOutComplete();
    else if (cameraStage === 'focus') handleFocusComplete();
  }, [cameraStage, handleZoomComplete, handleZoomOutComplete, handleFocusComplete]);

  // autoRotate is driven by paused + showCrossSection
  const autoRotate = !paused && !showCrossSection;

  const activeAlarmCount = useMemo(() => alarms.filter(a => a.status === 'active').length, [alarms]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', backgroundColor: '#0a0a0f', overflow: 'hidden' }}>
      <Canvas camera={{ position: [0, 0, 250], fov: 45, near: 1, far: 2000 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} />
        <hemisphereLight args={['#ffffff', '#080820', 0.6]} />

        <CameraController
          stage={cameraStage}
          clickedPoint={cameraTarget}
          onComplete={handleCameraComplete}
        />

        <ModelErrorBoundary>
          <Suspense fallback={<mesh><sphereGeometry args={[50, 32, 32]} /><meshStandardMaterial color="#4a90e2" wireframe /></mesh>}>
            <StarField paused={paused} />
            <ShootingStars paused={paused} />
            <Asteroids paused={paused} />
            <Earth onOceanClick={handleOceanClick} dimmed={showCrossSection} onHover={setHoverCoords} />
            <GeologicalCrossSection profile={profile} show={showCrossSection} clickedPoint={cameraTarget} />
          </Suspense>
        </ModelErrorBoundary>

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          minDistance={120} maxDistance={500}
          enableDamping dampingFactor={0.05}
          enabled={!showCrossSection}
          autoRotate={autoRotate}
          autoRotateSpeed={0.5}
        />
      </Canvas>

      <DataOverlay profile={profile} show={showCrossSection} />

      {/* Coordinate HUD — shows live lat/lon on hover */}
      {hoverCoords && !showCrossSection && (
        <div style={{
          position: 'absolute', bottom: 90, right: 20,
          background: 'rgba(8,8,18,0.92)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8, padding: '7px 14px',
          fontFamily: "'JetBrains Mono','Fira Code',ui-monospace,monospace",
          fontSize: 12, color: '#e2e8f0', pointerEvents: 'none',
          backdropFilter: 'blur(10px)', zIndex: 99,
          display: 'flex', gap: 12,
        }}>
          <span style={{ color: '#06b6d4' }}>
            {hoverCoords.lat >= 0 ? '+' : ''}{hoverCoords.lat.toFixed(2)}° lat
          </span>
          <span style={{ color: '#8b5cf6' }}>
            {hoverCoords.lon >= 0 ? '+' : ''}{hoverCoords.lon.toFixed(2)}° lon
          </span>
          {/* Show if within model grid */}
          {hoverCoords.lat >= CONFIG.GRID.LAT_MIN && hoverCoords.lat <= CONFIG.GRID.LAT_MAX &&
           hoverCoords.lon >= CONFIG.GRID.LON_MIN && hoverCoords.lon <= CONFIG.GRID.LON_MAX && (
            <span style={{ color: '#10b981' }}>● in grid</span>
          )}
        </div>
      )}

      {showCrossSection && profile && clickedLocation && (
        <InfoSidebar profile={profile} latitude={clickedLocation.lat} longitude={clickedLocation.lon} />
      )}

      {/* Top-right buttons */}
      <div style={{
        position: 'absolute', top: 20, right: showAlarmPanel ? 320 : 20,
        display: 'flex', gap: 10, alignItems: 'center', transition: 'right 0.2s ease',
      }}>
        {showCrossSection && (
          <button onClick={handleResetView} style={{
            ...btnBase, background: 'linear-gradient(135deg,#667eea,#764ba2)',
            boxShadow: '0 4px 16px rgba(102,126,234,0.5)',
          }}>← Back to Earth</button>
        )}
        {/* Dashboard link */}
        <a href="/dashboard" target="_blank" style={{
          ...btnBase, background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(99,102,241,0.4)', textDecoration: 'none',
        }}>📊 Dashboard</a>
        {/* Alarm bell */}
        {!showAlarmPanel && (
          <button onClick={() => setShowAlarmPanel(true)} title="Set temperature alarms" style={{
            ...btnBase, padding: 0, width: 44, height: 44, borderRadius: 10,
            background: alarms.some(a => a.status === 'triggered')
              ? 'linear-gradient(135deg,#ef5350,#c62828)' : 'rgba(10,10,20,0.9)',
            position: 'relative',
          }}>
            🔔
            {activeAlarmCount > 0 && (
              <span style={{
                position: 'absolute', top: 6, right: 6, background: '#4fc3f7',
                borderRadius: '50%', width: 14, height: 14, fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{activeAlarmCount}</span>
            )}
          </button>
        )}
      </div>

      {/* Control bar — play/pause + focus */}
      <ControlBar
        paused={paused}
        onTogglePause={() => setPaused(p => !p)}
        onFocus={handleFocus}
        showCrossSection={showCrossSection}
      />

      {/* Instructions */}
      {!showCrossSection && !loading && (
        <div style={{
          position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          textAlign: 'center', color: 'white', fontFamily: 'system-ui', pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(10,10,15,0.85)', padding: '12px 28px', borderRadius: 12,
            backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, opacity: 0.9 }}>
              🌊 Click any ocean to explore temperature layers · Use Focus to jump to Arabian Sea or Bay of Bengal
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', textAlign:'center' }}>
          <div style={{ width:60, height:60, border:'5px solid rgba(102,126,234,0.2)',
            borderTop:'5px solid #667eea', borderRadius:'50%', margin:'0 auto 20px',
            animation:'spin 1s linear infinite' }} />
          <p style={{ color:'white', fontSize:16, fontWeight:600 }}>Diving deep…</p>
          <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          onClick={() => setError(null)}
          style={{
            position:'absolute', top:20, left:'50%', transform:'translateX(-50%)',
            background:'rgba(20,5,5,0.97)', color:'#fca5a5', padding:'12px 24px',
            borderRadius:8, fontSize:14, fontWeight:600,
            border: '1px solid rgba(239,68,68,0.5)',
            boxShadow:'0 4px 16px rgba(0,0,0,0.6)',
            cursor: 'pointer', maxWidth: 500, textAlign: 'center', zIndex: 200,
          }}
        >⚠ {error} <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 8 }}>(click to dismiss)</span></div>
      )}

      {/* Alarm panel */}
      {showAlarmPanel && (
        <AlarmPanel
          alarms={alarms} onAdd={addAlarm} onRemove={removeAlarm} error={alarmError}
          prefillLat={clickedLocation?.lat} prefillLon={clickedLocation?.lon}
          targetMonth={CONFIG.DEFAULT_DATE.slice(0, 7)}
          onClose={() => setShowAlarmPanel(false)}
        />
      )}

      <HealthWidget healthData={healthData} healthStatus={healthStatus} onCheck={handleHealthCheck} />
    </div>
  );
}
