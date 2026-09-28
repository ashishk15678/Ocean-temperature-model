import { CONFIG } from './config';

/**
 * Classifies a raycast intersection as 'ocean' | 'land' | 'unknown'.
 *
 * Because we replace every mesh material at load-time with a custom
 * MeshStandardMaterial (losing the original name/color cues), keyword
 * matching almost always returns 'unknown'.
 *
 * Policy: treat 'unknown' as clickable — the model grid covers only the
 * Indian-Ocean region anyway, so out-of-grid coordinates are caught by the
 * backend validator with a helpful 400 message.
 *
 * 'land' is still blocked because some GLBs do embed material names.
 */
export function classifyIntersection(intersection) {
  const object       = intersection.object;
  const name         = (object.name           || '').toLowerCase();
  const materialName = (object.material?.name || '').toLowerCase();

  if (CONFIG.DEBUG_MODE) {
    console.log(
      `[ocean-detection] mesh="${object.name || '(unnamed)'}" mat="${object.material?.name || '(unnamed)'}"`
    );
  }

  const haystacks = [name, materialName];

  if (haystacks.some(h => CONFIG.OCEAN_KEYWORDS.some(k => h.includes(k)))) return 'ocean';
  if (haystacks.some(h => CONFIG.LAND_KEYWORDS.some( k => h.includes(k)))) return 'land';

  // Unknown → allow; grid validation on the backend catches true land coords
  return 'unknown';
}
