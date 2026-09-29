/** Mirrors backend TARGET_DEPTHS — model only outputs 5–1000 m. */
export const DEPTHS_M = [
  5, 10, 20, 30, 50, 75, 100, 125, 150, 200,
  300, 500, 700, 1000,
];

export const DEPTH_LABELS = DEPTHS_M.map(d => `${d} m`);
