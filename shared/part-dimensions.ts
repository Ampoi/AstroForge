// Nominal small interface shared by motor flanges and the pod tip.
export const SLIM_DIAMETER=.4;

// Native PyLoN flange diameter and retracted height, scaled uniformly.
export const LINEAR_MODEL_SCALE=SLIM_DIAMETER/.3125;
export const LINEAR_HEIGHT=1.6049312*LINEAR_MODEL_SCALE;
