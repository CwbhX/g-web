import { Hidpp } from "./hidpp";

export enum RgbZoneLocation {
  Unknown = 0x00,
  Primary = 0x01,
  Logo = 0x02,
  LeftSide = 0x03,
  RightSide = 0x04,
  Combined = 0x05,
  Primary1 = 0x06,
  Primary2 = 0x07,
  Primary3 = 0x08,
  Primary4 = 0x09,
  Primary5 = 0x0a,
  Primary6 = 0x0b,
}

export enum RgbEffectId {
  Off = 0x00,
  Static = 0x01,
  Pulse = 0x02,
  Cycle = 0x03,
  Boot = 0x08,
  Demo = 0x09,
  Breathing = 0x0a,
  Ripple = 0x0b,
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export type RgbEffect =
  | { id: RgbEffectId.Off; }
  | { id: RgbEffectId.Static; color: RgbColor; }
  // `period` is in milliseconds, `intensity` is 1-100 (0 means device default)
  | { id: RgbEffectId.Cycle; period: number; intensity: number; }
  | { id: RgbEffectId.Breathing; color: RgbColor; period: number; intensity: number; };

export interface RgbEffectInfo {
  zoneIndex: number;
  index: number;
  id: RgbEffectId;
  capabilities: number;
  period: number;
}

export interface RgbZoneInfo {
  index: number;
  location: RgbZoneLocation;
  effects: RgbEffectInfo[];
}

const EFFECT_PARAMS_SIZE = 10;

export function encodeRgbEffectParams(effect: RgbEffect): ArrayBuffer {
  const data = new ArrayBuffer(EFFECT_PARAMS_SIZE);
  const view = new DataView(data);
  switch (effect.id) {
    case RgbEffectId.Off:
      break;
    case RgbEffectId.Static:
      view.setUint8(0, effect.color.r);
      view.setUint8(1, effect.color.g);
      view.setUint8(2, effect.color.b);
      break;
    case RgbEffectId.Cycle:
      view.setUint16(5, effect.period);
      view.setUint8(7, effect.intensity);
      break;
    case RgbEffectId.Breathing:
      view.setUint8(0, effect.color.r);
      view.setUint8(1, effect.color.g);
      view.setUint8(2, effect.color.b);
      view.setUint16(3, effect.period);
      view.setUint8(6, effect.intensity);
      break;
  }
  return data;
}

/**
 * Decodes an effect stored as effect ID followed by its params,
 * the layout used by on-board profiles.
 */
export function decodeRgbEffect(view: DataView, offset = 0): RgbEffect | undefined {
  const id = view.getUint8(offset);
  const params = offset + 1;
  const color = () => ({
    r: view.getUint8(params),
    g: view.getUint8(params + 1),
    b: view.getUint8(params + 2),
  });
  switch (id) {
    case RgbEffectId.Off:
      return { id };
    case RgbEffectId.Static:
      return { id, color: color() };
    case RgbEffectId.Cycle:
      return { id, period: view.getUint16(params + 5), intensity: view.getUint8(params + 7) };
    case RgbEffectId.Breathing:
      return { id, color: color(), period: view.getUint16(params + 3), intensity: view.getUint8(params + 6) };
    default:
      return undefined;
  }
}

/**
 * Feature 0x8071 RGB Effects, used by newer G-series devices (e.g. G703 HERO).
 */
export class RgbEffects {
  hidpp: Hidpp;

  constructor(hidpp: Hidpp) {
    this.hidpp = hidpp;
  }

  private async getFeatureIndex() {
    const { index } = await this.hidpp.getFeature(0x8071);
    return index;
  }

  async getInfo() {
    const featureIndex = await this.getFeatureIndex();
    const response = await this.hidpp.sendLongRequest(
      featureIndex,
      0x0,
      new Uint8Array([0xff, 0xff, 0x00]).buffer
    );
    const view = new DataView(response);
    return {
      zoneCount: view.getUint8(2),
      nvCapabilities: view.getUint16(3),
      extCapabilities: view.getUint16(5),
    };
  }

  async getZoneInfo(zoneIndex: number) {
    const featureIndex = await this.getFeatureIndex();
    const response = await this.hidpp.sendLongRequest(
      featureIndex,
      0x0,
      new Uint8Array([zoneIndex, 0xff, 0x00]).buffer
    );
    const view = new DataView(response);
    return {
      index: view.getUint8(0),
      location: view.getUint16(2) as RgbZoneLocation,
      effectCount: view.getUint8(4),
    };
  }

  async getEffectInfo(zoneIndex: number, effectIndex: number): Promise<RgbEffectInfo> {
    const featureIndex = await this.getFeatureIndex();
    const response = await this.hidpp.sendLongRequest(
      featureIndex,
      0x0,
      new Uint8Array([zoneIndex, effectIndex, 0x00]).buffer
    );
    const view = new DataView(response);
    return {
      zoneIndex: view.getUint8(0),
      index: view.getUint8(1),
      id: view.getUint16(2),
      capabilities: view.getUint16(4),
      period: view.getUint16(6),
    };
  }

  async getZones(): Promise<RgbZoneInfo[]> {
    const { zoneCount } = await this.getInfo();
    const zones: RgbZoneInfo[] = [];
    for (let i = 0; i < zoneCount; i += 1) {
      const { index, location, effectCount } = await this.getZoneInfo(i);
      const effects: RgbEffectInfo[] = [];
      for (let j = 0; j < effectCount; j += 1) {
        effects.push(await this.getEffectInfo(i, j));
      }
      zones.push({ index, location, effects });
    }
    return zones;
  }

  /**
   * @param effectIndex Index of the effect in the zone's effect list, not the effect ID
   * @param persist Whether the device should keep the effect after power cycle
   */
  async setEffect(zoneIndex: number, effectIndex: number, params: ArrayBuffer, persist = false) {
    const featureIndex = await this.getFeatureIndex();
    const data = new Uint8Array(3 + EFFECT_PARAMS_SIZE);
    data[0] = zoneIndex;
    data[1] = effectIndex;
    data.set(new Uint8Array(params, 0, EFFECT_PARAMS_SIZE), 2);
    data[2 + EFFECT_PARAMS_SIZE] = persist ? 0x01 : 0x00;
    await this.hidpp.sendLongRequest(featureIndex, 0x1, data.buffer);
  }

  async setZoneEffect(zone: RgbZoneInfo, effect: RgbEffect, persist = false) {
    const info = zone.effects.find(x => x.id === effect.id);
    if (!info) {
      throw new Error(`Effect ${RgbEffectId[effect.id] ?? effect.id} not supported by zone ${zone.index}`);
    }
    await this.setEffect(zone.index, info.index, encodeRgbEffectParams(effect), persist);
  }
}
