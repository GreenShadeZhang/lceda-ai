/// <reference types="@jlceda/pro-api-types" />

// Augment the eda global with our custom plugin-layer functions
declare global {
  interface Window {
    eda: typeof eda;
  }
  /** @jlceda/pro-api-types already declares `eda: EDA`. We augment via module augmentation below. */
  // eslint-disable-next-line no-var
  var eda: EDA;
}

/**
 * Extended EDA global with plugin-registered helpers.
 * Access via `(eda as EdaExtended)` to avoid type conflicts with the base declaration.
 */
export interface EdaExtended extends EDA {
  /** Custom: assemble circuit JSON onto canvas (registered by plugin layer) */
  assembleCircuit?: (circuitJson: unknown) => Promise<{ placedCount: number; log: string[] }>;
  /** Custom: read current schematic (registered by plugin layer) */
  getSchematic?: (primitiveIds?: string[]) => Promise<SchematicContext>;
}

export interface SchematicContext {
  components: Array<{
    ref: string;
    name: string;
    value?: string;
    lcsc?: string;
    x?: number;
    y?: number;
  }>;
  netCount?: number;
}

export {};
