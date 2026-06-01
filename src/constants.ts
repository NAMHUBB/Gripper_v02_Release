// ── EYOU PH11B-51-C Motor Specifications ─────────────────────────────────────
// Rated torque : 3.5 Nm
// Peak torque  : 17.0 Nm (instantaneous max)
// Rated current: ~2000 mA (approximation for mA→Nm conversion)

export const PH11_SPEC = {
  rated:       3.5,    // Nm
  peak:        17.0,   // Nm
  fullForceMa: 2000,   // mA at force = 100 / 100
} as const;

/** Convert motor current (mA) → grip force (Nm) */
export const mAtoNm = (mA: number): number =>
  parseFloat(((mA / PH11_SPEC.fullForceMa) * PH11_SPEC.rated).toFixed(3));