import { AdjustableDpi, Battery, BatteryLevel1004, OnBoardProfile, BatteryStatus1000, BatteryStatus1001, BatteryStatus1f20, DeviceType, FeatureSet, FirmwareInfo, FirmwareType, Hidpp, isHidppDevice, Receiver, ReportRate, requestDevice, TypeAndName, OnBoardProfileMode, RgbEffect, RgbEffectId, RgbEffects, RgbZoneLocation } from "@yume-chan/hidpp";

const root = document.getElementById('root') as HTMLDivElement;

const devices: HIDDevice[] = [];

// Keyed by control, so changing the same control twice only sends the latest value
const pendingChanges = new Map<HTMLElement, () => Promise<void>>();
const applyButton = document.getElementById('apply-button') as HTMLButtonElement;
const applyStatus = document.getElementById('apply-status') as HTMLSpanElement;

function updateApplyButton() {
  for (const control of Array.from(pendingChanges.keys())) {
    if (!control.isConnected) {
      pendingChanges.delete(control);
    }
  }
  applyButton.disabled = pendingChanges.size === 0;
  applyButton.textContent = pendingChanges.size
    ? `Send to mouse (${pendingChanges.size} pending)`
    : 'Send to mouse';
}

function queueChange(control: HTMLElement, apply: () => Promise<void>) {
  pendingChanges.set(control, apply);
  applyStatus.textContent = '';
  updateApplyButton();
}

applyButton.onclick = async () => {
  applyButton.disabled = true;
  applyStatus.textContent = 'Sending...';
  let failed = 0;
  for (const [control, apply] of Array.from(pendingChanges)) {
    try {
      await apply();
      pendingChanges.delete(control);
    } catch (e) {
      console.error(e);
      failed += 1;
    }
  }
  applyStatus.textContent = failed ? `${failed} change(s) failed, see console` : 'Sent';
  updateApplyButton();
};

async function openHidppDevice(device: Hidpp) {
  await device.getVersion();
  console.log(device);

  // Assume all HID++ 1.0 devices are USB receivers
  // (mouses/keyboards started using HID++ 2.0 since 2013)
  if (device.version === 1) {
    const receiver = new Receiver(device);
    console.log(receiver);

    receiver.onChildConnect(child => openHidppDevice(child));
    await receiver.detectChildren();

    const childrenCount = await receiver.getChildCount();
    console.log('childrenCount', childrenCount);

    return;
  }

  // const friendlyName = new FriendlyName(device);
  // name.textContent = await friendlyName.getDefaultFriendlyName();

  const container = document.createElement('div');
  root.appendChild(container);

  device.onDisconnect(() => {
    container.remove();
    updateApplyButton();
  });

  try {
    const typeAndName = new TypeAndName(device);
    let div = document.createElement('div');
    div.textContent = `${device.index} - ${await typeAndName.getName()}`;
    container.appendChild(div);

    div = document.createElement('div');
    div.textContent = `Type: ${DeviceType[await typeAndName.getType()]}`;
    container.appendChild(div);
  } catch (e) { console.log(e); }

  try {
    const featureSet = new FeatureSet(device);

    const details = document.createElement('details');
    container.appendChild(details);

    const summary = document.createElement('summary');
    summary.textContent = 'Features';
    details.appendChild(summary);

    let i = 0;
    for await (const feature of featureSet.getFeatures()) {
      const id = `0x${feature.id.toString(16).padStart(4, '0')}`;
      const div = document.createElement('div');
      const FEATURE_NAMES: Record<string, string> = {
        '0x0000': 'Root',
        '0x0001': 'Feature Set',
        '0x0002': "Feature Info",
        '0x0003': 'Firmware Info',
        '0x0004': 'Device Unit ID',
        '0x0005': 'Device Name',
        '0x0006': 'Device Groups',
        '0x0007': 'Device Friendly Name',
        '0x0008': 'Keep Alive',
        '0x0020': 'Config Change',
        '0x0021': 'Crypto ID',
        '0x0040': 'Target Software',
        '0x0080': 'Wireless Signal Strength',
        '0x00c0': 'DFU Control v0',
        '0x00c1': 'DFU Control v1',
        '0x00c2': 'DFU Control v2',
        '0x00d0': 'DFU',
        '0x1000': 'Battery v0',
        '0x1001': 'Battery v1',
        '0x1004': 'Battery v4',
        '0x1010': 'Charging Control',
        '0x1300': 'LED Control',
        '0x1800': 'Generic Test',
        '0x1802': 'Device Reset',
        '0x1805': 'OOB State',
        '0x1806': 'Configurable Device Properties',
        '0x1014': 'Change Host',
        '0x1015': 'Hosts Info',
        '0x1981': 'Keyboard Backlight v1',
        '0x1982': 'Keyboard Backlight v2',
        '0x1983': 'Keyboard Backlight v3',
        '0x1a00': 'Presenter Control',
        '0x1b00': 'Reprogrammable Control v0',
        '0x1b01': 'Reprogrammable Control v1',
        '0x1b02': 'Reprogrammable Control v2',
        '0x1b03': 'Reprogrammable Control v3',
        '0x1b04': 'Reprogrammable Control v4',
        '0x1bc0': 'Report HID Usages',
        '0x1c00': 'Persistent Remappable Action',
        '0x1d4b': 'Wireless Status',
        '0x1df0': 'Remaining Pairing',
        '0x1e00': 'Enable Hidden Features',
        '0x1f1f': 'Firmware Properties',
        '0x1f20': 'ADC Measurement',
        '0x2001': 'Button Swap',
        '0x2005': 'Button Swap Cancel',
        '0x2006': 'Pointer Axis Orientation',
        '0x2100': 'Vertical Scrolling',
        '0x2110': 'Smart Shift v0',
        '0x2111': 'Smart Shift v1',
        '0x2120': 'Hi-Res Wheel v0',
        '0x2121': 'Hi-Res Wheel v1',
        '0x2130': 'Ratchet Wheel',
        '0x2150': 'Thumb Wheel',
        '0x2200': 'Mouse Pointer',
        '0x2201': 'Adjustable DPI',
        '0x2205': 'Pointer Motion Scaling',
        '0x2230': 'Angle Snapping',
        '0x2240': 'Surface Tuning',
        '0x2250': 'XY Stats',
        '0x2251': 'Wheel Stats',
        '0x2400': 'Hybrid Tracking',
        '0x40a0': 'Fn Inversion v0',
        '0x40a2': 'Fn Inversion v2',
        '0x40a3': 'Fn Inversion v3',
        '0x4100': 'Encryption',
        '0x4220': 'Lock Key State',
        '0x4301': 'Solar Dashboard',
        '0x4520': 'Keyboard Layout',
        '0x4521': 'Disable Keys',
        '0x4522': 'Disable Keys By Usage',
        '0x4530': 'Dual Platform',
        '0x4531': 'Multi Platform',
        '0x4540': 'Keyboard Layout 2',
        '0x4600': 'Crown',
        '0x6010': 'TouchPad Firmware Items',
        '0x6011': 'TouchPad Software Items',
        '0x6012': 'TouchPad Windows 8 Firmware Items',
        '0x6020': 'Tap Enabled v0',
        '0x6021': 'Tap Enabled v1',
        '0x6030': 'Cursor Ballistic',
        '0x6040': 'TouchPad Resolution',
        '0x6100': 'TouchPad Raw XY',
        '0x6110': 'Touch Mouse Raw Points',
        '0x6500': 'TouchPad Gestures v0',
        '0x6501': 'TouchPad Gestures v1',
        '0x8010': 'G-key',
        '0x8040': 'Brightness Control',
        '0x8060': 'Adjustable Report Rate',
        '0x8070': 'Color LED Effects',
        '0x8071': 'RGB Effects',
        '0x8080': 'Per Key Lighting v0',
        '0x8081': 'Per Key Lighting v1',
        '0x8090': 'Mode Status',
        '0x8100': 'On-board Profiles',
        '0x8110': 'Mouse Button Spy',
        '0x8111': 'Latency Monitoring',
        '0x8120': 'Gaming Attachments',
        '0x8123': 'Force Feedback',
        '0x8300': 'Side Tone',
        '0x8310': 'Equalizer',
        '0x8320': 'Headset Out',
      };
      const flags: string[] = [];
      if (feature.obsolete) {
        flags.push('obsolete');
      }
      if (feature.hidden) {
        flags.push('hidden');
      }
      if (feature.internal) {
        flags.push('internal');
      }
      div.textContent = `Index 0x${i.toString(16).padStart(2, '0')}: ${id}${FEATURE_NAMES[id] ? ` ${FEATURE_NAMES[id]}` : ''}${flags.length ? ` (${flags.join(', ')})` : ''}`;
      details.appendChild(div);
      i += 1;
    }
  } catch (e) { console.log(e); }

  try {
    const firmwareInfo = new FirmwareInfo(device);
    const deviceInfo = await firmwareInfo.getDeviceInfo();
    console.error(deviceInfo);
    for (let i = 0; i < deviceInfo.entityCount; i += 1) {
      const firmware = await firmwareInfo.getFirmwareInfo(i);
      const div = document.createElement('div');
      div.textContent = [
        `Firmware ${i}:`,
        FirmwareType[firmware.type] ?? 'Unknown',
        firmware.name,
        `${firmware.major.toString(16)}.${firmware.minor.toString(16)}.${firmware.build.toString(16)}`,
        firmware.active ? ' (active)' : '',
        firmware.pid ? ` pid=${firmware.pid.toString(16).padStart(2, '0')}` : '',
      ].filter(Boolean).join(' ');
      container.appendChild(div);
    }

    let serialNumber = deviceInfo.unitId.toString(16).padStart(8, '0');
    if (deviceInfo.supportSerialNumber) {
      serialNumber = await firmwareInfo.getSerialNumber();
    }
    const div = document.createElement('div');
    div.textContent = `Serial Number: ${serialNumber}`;
    container.appendChild(div);
  } catch (e) { console.error(e); }

  try {
    const battery = new Battery(device);
    const { level, nextLevel, status } = await battery.getBattery1000();
    console.log('battery', level, nextLevel, status);

    const div = document.createElement('div');
    div.textContent = `Battery: about ${level}%, ${BatteryStatus1000[status]}`;
    container.appendChild(div);
  } catch (e) { console.log(e); }

  try {
    const battery = new Battery(device);
    const { voltage, status } = await battery.getBattery1001();
    console.log('battery', voltage, status);

    const div = document.createElement('div');
    div.textContent = `Battery: ${voltage}mV (~${Battery.mapVoltageToSoc(voltage)}%), ${BatteryStatus1001[status] ?? 'Discharging'}`;
    container.appendChild(div);
  } catch (e) { console.log(e); }

  try {
    const battery = new Battery(device);
    const { percentage, level, status } = await battery.getBattery1004();
    console.log('battery', percentage, level, status);

    const div = document.createElement('div');
    div.textContent = `Battery: ${percentage ? `${percentage}%` : BatteryLevel1004[level]}, ${BatteryStatus1000[status]}`;
    container.appendChild(div);
  } catch (e) { console.log(e); }

  try {
    const battery = new Battery(device);
    const { voltage, status } = await battery.getBattery1f20();

    const div = document.createElement('div');
    div.textContent = `Battery: ${voltage}mV (~${Battery.mapVoltageToSoc(voltage)}%), ${BatteryStatus1f20[status]}`;
    container.appendChild(div);
  } catch (e) { console.log(e); }

  try {
    const dpi = new AdjustableDpi(device);
    const sensorCount = await dpi.getSensorCount();

    for (let i = 0; i < sensorCount; i += 1) {
      const index = i;

      const dpiList = await dpi.getDpiList(index);
      const currentDpi = await dpi.getDpi(index);

      const div = document.createElement('div');
      div.textContent = `Sensor ${index} DPI: `;

      const select = document.createElement('select');
      for (const value of dpiList) {
        const option = document.createElement('option');
        option.value = value.toString();
        option.innerText = value.toString();
        select.appendChild(option);
      }
      select.value = currentDpi.toString();
      select.onchange = () => {
        const value = parseInt(select.value, 10);
        queueChange(select, async () => { await dpi.setDpi(index, value); });
      };

      div.appendChild(select);
      container.appendChild(div);
    }
  } catch (e) { console.log(e); }

  try {
    const reportRate = new ReportRate(device);
    const reportRateList = await reportRate.getReportRateList();
    const currentReportRate = await reportRate.getReportRate();

    const div = document.createElement('div');
    div.textContent = 'Report Rate: ';

    const select = document.createElement('select');
    for (const value of reportRateList) {
      const option = document.createElement('option');
      option.value = value.toString();
      option.innerText = `${value}ms`;
      select.appendChild(option);
    }
    select.value = currentReportRate.toString();
    select.onchange = () => {
      const value = parseInt(select.value, 10);
      queueChange(select, () => reportRate.setReportRate(value));
    };

    div.appendChild(select);
    container.appendChild(div);
  } catch (e) { console.log(e); }

  try {
    const rgbEffects = new RgbEffects(device);
    const zones = await rgbEffects.getZones();

    // The device can't report its live effect, so start from the active on-board profile
    const onBoardProfile = new OnBoardProfile(device);
    let savedEffects: (RgbEffect | undefined)[] = [];
    let profileAddress: number | undefined;
    try {
      if (await onBoardProfile.getMode() === OnBoardProfileMode.OnBoard) {
        const profilesInfo = await onBoardProfile.getProfilesInfo();
        profileAddress = profilesInfo[await onBoardProfile.getCurrentProfile() - 1]?.address;
        if (profileAddress !== undefined) {
          savedEffects = (await onBoardProfile.readProfile(profileAddress)).leds;
        }
      }
    } catch (e) { console.log(e); }

    const zoneEffects: (() => RgbEffect)[] = [];

    const details = document.createElement('details');
    details.open = true;
    container.appendChild(details);

    const summary = document.createElement('summary');
    summary.textContent = 'Lighting';
    details.appendChild(summary);

    for (const zone of zones) {
      const div = document.createElement('div');
      div.append(`${RgbZoneLocation[zone.location] ?? `Zone ${zone.index}`}: `);

      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = true;

      const select = document.createElement('select');
      for (const effect of zone.effects) {
        if (effect.id === RgbEffectId.Off || !RgbEffectId[effect.id]) {
          continue;
        }
        const option = document.createElement('option');
        option.value = effect.id.toString();
        option.textContent = RgbEffectId[effect.id];
        select.appendChild(option);
      }

      const color = document.createElement('input');
      color.type = 'color';
      color.value = '#00b4ff';

      const period = document.createElement('input');
      period.type = 'number';
      period.min = '1000';
      period.max = '20000';
      period.step = '500';
      period.value = '5000';
      period.title = 'Period (ms)';

      const intensity = document.createElement('input');
      intensity.type = 'range';
      intensity.min = '1';
      intensity.max = '100';
      intensity.value = '100';
      intensity.title = 'Brightness';

      const saved = savedEffects[zone.index];
      if (saved) {
        enabled.checked = saved.id !== RgbEffectId.Off;
        if (saved.id !== RgbEffectId.Off) {
          select.value = saved.id.toString();
        }
        if ('color' in saved) {
          const { r, g, b } = saved.color;
          color.value = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
        }
        if ('period' in saved) {
          period.value = saved.period.toString();
          intensity.value = (saved.intensity || 100).toString();
        }
      }

      const buildEffect = (): RgbEffect => {
        if (!enabled.checked) {
          return { id: RgbEffectId.Off };
        }
        const hex = parseInt(color.value.slice(1), 16);
        const rgb = { r: hex >> 16, g: (hex >> 8) & 0xff, b: hex & 0xff };
        switch (parseInt(select.value, 10)) {
          case RgbEffectId.Cycle:
            return { id: RgbEffectId.Cycle, period: parseInt(period.value, 10), intensity: parseInt(intensity.value, 10) };
          case RgbEffectId.Breathing:
            return { id: RgbEffectId.Breathing, color: rgb, period: parseInt(period.value, 10), intensity: parseInt(intensity.value, 10) };
          default:
            return { id: RgbEffectId.Static, color: rgb };
        }
      };

      const updateVisibility = () => {
        const id = parseInt(select.value, 10);
        select.disabled = !enabled.checked;
        color.hidden = !enabled.checked || id === RgbEffectId.Cycle;
        period.hidden = !enabled.checked || id === RgbEffectId.Static;
        intensity.hidden = !enabled.checked || id === RgbEffectId.Static;
      };
      updateVisibility();

      const queue = () => {
        updateVisibility();
        const effect = buildEffect();
        queueChange(div, () => rgbEffects.setZoneEffect(zone, effect));
        if (profileAddress !== undefined) {
          const address = profileAddress;
          const effects = zoneEffects.map(build => build());
          queueChange(details, () => onBoardProfile.writeProfileLeds(address, effects));
        }
      };
      zoneEffects.push(buildEffect);
      enabled.onchange = queue;
      select.onchange = queue;
      color.oninput = queue;
      period.oninput = queue;
      intensity.oninput = queue;

      div.append(enabled, select, color, period, intensity);
      details.appendChild(div);
    }
  } catch (e) { console.log(e); }

  try {
    const onBoardProfile = new OnBoardProfile(device);
    const mode = await onBoardProfile.getMode();

    const details = document.createElement('details');
    container.appendChild(details);

    const summary = document.createElement('summary');
    summary.textContent = `On Board Profile Mode: `;
    details.appendChild(summary);

    const select = document.createElement('select');
    for (const value of [1, 2]) {
      const option = document.createElement('option');
      option.value = value.toString();
      option.textContent = OnBoardProfileMode[value];
      select.appendChild(option);
    }
    select.value = mode.toString();
    select.onchange = () => {
      const value = parseInt(select.value, 10);
      queueChange(select, () => onBoardProfile.setMode(value));
    };
    summary.appendChild(select);


    const profilesInfo = await onBoardProfile.getProfilesInfo();
    const activeAddress = profilesInfo[await onBoardProfile.getCurrentProfile() - 1]?.address;

    for (const profileInfo of profilesInfo) {
      const details2 = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `Profile ${profileInfo.address} (${profileInfo.enabled ? 'Enabled' : 'Disabled'}${profileInfo.address === activeAddress ? ', Active' : ''})`;
      details2.appendChild(summary);

      if (profileInfo.enabled) {
        const profile = await onBoardProfile.readProfile(profileInfo.address);
        console.log('profile', profileInfo.address, profile);
        const div3 = document.createElement('div');
        div3.textContent = `Report Rate: ${profile.reportRate}ms`;
        details2.appendChild(div3);

        const div4 = document.createElement('div');
        div4.textContent = `DPI List: ${profile.dpi.filter(Boolean).map((x, i) => {
          const attributes: string[] = [];
          if (i === profile.defaultDpi) {
            attributes.push('default');
          }
          if (i === profile.switchedDpi) {
            attributes.push('switched');
          }
          return `${x}${attributes.length ? ` (${attributes.join(', ')})` : ''}`;
        }).join(', ')}`;
        details2.appendChild(div4);

        if (profileInfo.address === activeAddress) {
          const currentDpiIndex = await onBoardProfile.getCurrentDpiIndex();
          const div5 = document.createElement('div');
          div5.textContent = `Current DPI: ${profile.dpi[currentDpiIndex]}`;
          details2.appendChild(div5);
        }
      }

      details.appendChild(details2);
    }
  } catch (e) { console.log(e); }
}

async function openHidDevice(device: HIDDevice) {
  if (devices.includes(device)) {
    return;
  }
  devices.push(device);

  console.log(device);
  await openHidppDevice(new Hidpp(device, 0xff));
}

(async () => {
  // Open known devices
  const devices = await navigator.hid.getDevices();
  for (const device of devices) {
    // One physical device may contain multiple HID devices
    // Find the HID device that implements HID++
    if (isHidppDevice(device))
      await openHidDevice(device);
  }
})();

document.getElementById('select-button')!.onclick = async () => {
  const device = await requestDevice();
  if (devices.includes(device)) {
    return;
  }

  console.log(device);
  await openHidDevice(device);
};
