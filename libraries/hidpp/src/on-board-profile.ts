import { Hidpp } from "./hidpp";
import { decodeRgbEffect, encodeRgbEffectParams, RgbEffect } from "./rgb-effects";

const PROFILE_LEDS_OFFSET = 208;
const PROFILE_ALT_LEDS_OFFSET = 230;
const PROFILE_LED_COUNT = 2;

export function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export enum OnBoardProfileMode {
  NoChange = 0x0,
  OnBoard = 0x1,
  Host = 0x2,
}

export class OnBoardProfile {
  hidpp: Hidpp;

  constructor(hidpp: Hidpp) {
    this.hidpp = hidpp;
  }

  async getInfo() {
    const { index: featureIndex } = await this.hidpp.getFeature(0x8100);
    const response = await this.hidpp.sendLongRequest(
      featureIndex,
      0x0
    );
    const view = new DataView(response);
    return {
      memoryModelId: view.getUint8(0),
      profileFormatId: view.getUint8(1),
      macroFormatId: view.getUint8(2),
      profileCount: view.getUint8(3),
      profileCountOob: view.getUint8(4),
      buttonCount: view.getUint8(5),
      sectorCount: view.getUint8(6),
      sectorSize: view.getUint16(7),
      mechanicalLayout: view.getUint8(9),
      variousInfo: view.getUint8(10),
    };
  }

  async setMode(mode: OnBoardProfileMode) {
    const { index: featureIndex } = await this.hidpp.getFeature(0x8100);
    await this.hidpp.sendLongRequest(
      featureIndex,
      0x1,
      new Uint8Array([mode]).buffer
    );
  }

  async getMode(): Promise<OnBoardProfileMode> {
    const { index: featureIndex } = await this.hidpp.getFeature(0x8100);
    const response = await this.hidpp.sendLongRequest(
      featureIndex,
      0x2
    );
    const view = new Uint8Array(response);
    return view[0];
  }

  /**
   * @returns 1-based index into `getProfilesInfo()`
   */
  async getCurrentProfile(): Promise<number> {
    const { index: featureIndex } = await this.hidpp.getFeature(0x8100);
    const response = await this.hidpp.sendLongRequest(
      featureIndex,
      0x4
    );
    const view = new Uint8Array(response);
    return view[1];
  }

  async readSector(sector: number, size: number) {
    const { index: featureIndex } = await this.hidpp.getFeature(0x8100);
    const request = new ArrayBuffer(4);
    const view = new DataView(request);
    view.setUint16(0, sector);
    const data = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 16) {
      offset = Math.min(offset, size - 16);
      view.setUint16(2, offset);

      {
        const response = await this.hidpp.sendLongRequest(
          featureIndex,
          0x5,
          request
        );
        const view = new Uint8Array(response);
        data.set(view, offset);
      }
    }
    return data.buffer;
  }

  /**
   * Writes a whole sector, replacing its last two bytes with the CRC the device expects.
   */
  async writeSector(sector: number, data: ArrayBuffer) {
    const { index: featureIndex } = await this.hidpp.getFeature(0x8100);
    const size = data.byteLength;
    const buffer = new Uint8Array(Math.ceil(size / 16) * 16);
    buffer.set(new Uint8Array(data));
    const crc = crc16Ccitt(buffer.subarray(0, size - 2));
    buffer[size - 2] = crc >> 8;
    buffer[size - 1] = crc & 0xff;

    const start = new DataView(new ArrayBuffer(6));
    start.setUint16(0, sector);
    start.setUint16(2, 0);
    start.setUint16(4, size);
    await this.hidpp.sendLongRequest(featureIndex, 0x6, start.buffer);

    for (let offset = 0; offset < size; offset += 16) {
      await this.hidpp.sendLongRequest(
        featureIndex,
        0x7,
        buffer.slice(offset, offset + 16).buffer
      );
    }

    await this.hidpp.sendLongRequest(featureIndex, 0x8);
  }

  /**
   * Replaces the lighting stored in a profile, one effect per zone.
   */
  async writeProfileLeds(address: number, effects: RgbEffect[]) {
    if (effects.length > PROFILE_LED_COUNT) {
      throw new Error(`Profiles only store ${PROFILE_LED_COUNT} lighting zones`);
    }
    const { sectorSize } = await this.getInfo();
    const data = new Uint8Array(await this.readSector(address, sectorSize));
    effects.forEach((effect, zone) => {
      const encoded = new Uint8Array(1 + 10);
      encoded[0] = effect.id;
      encoded.set(new Uint8Array(encodeRgbEffectParams(effect)), 1);
      // Main and alternate (power saving) slots
      data.set(encoded, PROFILE_LEDS_OFFSET + zone * encoded.length);
      data.set(encoded, PROFILE_ALT_LEDS_OFFSET + zone * encoded.length);
    });
    await this.writeSector(address, data.buffer);
  }

  async getProfilesInfo() {
    const { profileCount, sectorSize } = await this.getInfo();
    const data = await this.readSector(0x0000, sectorSize);
    const view = new DataView(data);
    const profiles = [];
    for (let i = 0; i < profileCount; i++) {
      const profile = {
        address: view.getUint16(i * 4),
        enabled: view.getUint8(i * 4 + 2) === 1,
      };
      profiles.push(profile);
    }
    return profiles;
  }

  async readProfile(address: number) {
    const { sectorSize } = await this.getInfo();
    const response = await this.readSector(address, sectorSize);
    const view = new DataView(response);
    return {
      reportRate: view.getUint8(0),
      defaultDpi: view.getUint8(1),
      switchedDpi: view.getUint8(2),
      dpi: (() => {
        const list = [];
        for (let i = 0; i < 5; i += 1) {
          list.push(view.getUint16(3 + i * 2, true));
        }
        return list;
      })(),
      color: {
        r: view.getUint8(11),
        g: view.getUint8(12),
        b: view.getUint8(13),
      },
      powerMode: view.getUint8(14),
      angleSnapping: view.getUint8(15),
      powerSaveTimeout: view.getUint8(26),
      powerOffTimeout: view.getUint8(27),
      // One entry per lighting zone
      leds: [decodeRgbEffect(view, PROFILE_LEDS_OFFSET), decodeRgbEffect(view, PROFILE_LEDS_OFFSET + 11)],
    };
  }

  async getCurrentDpiIndex() {
    const { index: featureIndex } = await this.hidpp.getFeature(0x8100);
    const response = await this.hidpp.sendLongRequest(
      featureIndex,
      0xb
    );
    const view = new Uint8Array(response);
    return view[0];
  }
}
