import { AdjustableDpi, Battery, BatteryLevel1004, OnBoardProfile, BatteryStatus1000, BatteryStatus1001, BatteryStatus1f20, DeviceType, FeatureSet, FirmwareInfo, FirmwareType, Hidpp, isHidppDevice, Receiver, ReportRate, requestDevice, TypeAndName, OnBoardProfileMode, RgbEffect, RgbEffectId, RgbEffects, RgbZoneLocation } from "@yume-chan/hidpp";

const root = document.getElementById('root') as HTMLElement;

const devices: HIDDevice[] = [];

const EFFECT_LABELS: Partial<Record<RgbEffectId, string>> = {
  [RgbEffectId.Static]: 'Static',
  [RgbEffectId.Cycle]: 'Color cycle',
  [RgbEffectId.Breathing]: 'Breathing',
};

/** Turns enum names like `ChargingComplete` into `Charging complete` */
function humanize(name: string | undefined) {
  if (!name) {
    return 'Unknown';
  }
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const result = document.createElement(tag);
  if (className) {
    result.className = className;
  }
  if (text !== undefined) {
    result.textContent = text;
  }
  return result;
}

function addSection(parent: HTMLElement, title: string) {
  const section = element('section', 'section');
  section.append(element('h3', undefined, title));
  parent.append(section);
  return section;
}

function addRow(parent: HTMLElement, label: string, ...content: (Node | string)[]) {
  const row = element('div', 'row');
  const value = element('div', 'value');
  value.append(...content);
  row.append(element('span', 'label', label), value);
  parent.append(row);
  return row;
}

function labeled(text: string, control: HTMLElement, suffix?: string) {
  const label = element('label');
  label.append(text, control);
  if (suffix) {
    label.append(suffix);
  }
  return label;
}

function formatReportRate(ms: number) {
  return `${Math.round(1000 / ms)} Hz`;
}

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
}

function queueChange(control: HTMLElement, apply: () => Promise<void>) {
  pendingChanges.set(control, apply);
  updateApplyButton();
  applyStatus.textContent = `${pendingChanges.size} unsent ${pendingChanges.size === 1 ? 'change' : 'changes'}`;
}

applyButton.onclick = async () => {
  applyButton.disabled = true;
  applyStatus.textContent = 'Sending…';
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
  applyStatus.textContent = failed
    ? `${failed} ${failed === 1 ? 'change' : 'changes'} failed, see the browser console for details`
    : 'All changes sent';
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

  const card = element('article', 'device');
  root.appendChild(card);

  device.onDisconnect(() => {
    card.remove();
    updateApplyButton();
  });

  const title = element('h2', undefined, 'Logitech device');
  const subtitle = element('div', 'subtitle');
  card.append(title, subtitle);
  const connection = device.index === 0xff ? 'Connected directly' : `Connected via receiver (slot ${device.index})`;
  subtitle.textContent = connection;

  const statusRows = element('div', 'section');
  card.append(statusRows);
  const performance = addSection(card, 'Performance');
  const lighting = addSection(card, 'Lighting');
  const profiles = addSection(card, 'On-board profiles');
  const info = element('details', 'section');
  info.append(element('summary', undefined, 'Device info'));
  const infoRows = element('div');
  info.append(infoRows);
  card.append(info);

  try {
    const typeAndName = new TypeAndName(device);
    title.textContent = await typeAndName.getName();
    subtitle.textContent = `${humanize(DeviceType[await typeAndName.getType()])} · ${connection}`;
  } catch (e) { console.log(e); }

  try {
    const featureSet = new FeatureSet(device);

    const details = element('details');
    const summary = element('summary', undefined, 'Supported HID++ features');
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
      div.className = 'feature';
      div.textContent = `${id} ${FEATURE_NAMES[id] ?? 'Unknown'}${flags.length ? ` (${flags.join(', ')})` : ''}`;
      div.title = `Feature index 0x${i.toString(16).padStart(2, '0')}`;
      details.appendChild(div);
      i += 1;
    }
    summary.textContent = `Supported HID++ features (${i})`;
    info.append(details);
  } catch (e) { console.log(e); }

  try {
    const firmwareInfo = new FirmwareInfo(device);
    const deviceInfo = await firmwareInfo.getDeviceInfo();
    console.log(deviceInfo);

    let serialNumber = deviceInfo.unitId.toString(16).padStart(8, '0');
    if (deviceInfo.supportSerialNumber) {
      serialNumber = await firmwareInfo.getSerialNumber();
    }
    addRow(infoRows, 'Serial number', serialNumber);

    for (let i = 0; i < deviceInfo.entityCount; i += 1) {
      const firmware = await firmwareInfo.getFirmwareInfo(i);
      const version = `${firmware.major.toString(16)}.${firmware.minor.toString(16)}.${firmware.build.toString(16)}`;
      addRow(
        infoRows,
        humanize(FirmwareType[firmware.type]),
        `${firmware.name} ${version}${firmware.active ? ' (active)' : ''}`
      );
    }
  } catch (e) { console.error(e); }

  try {
    const battery = new Battery(device);
    const { level, status } = await battery.getBattery1000();
    addRow(statusRows, 'Battery', `${level}% · ${humanize(BatteryStatus1000[status])}`);
  } catch (e) { console.log(e); }

  try {
    const battery = new Battery(device);
    const { voltage, status } = await battery.getBattery1001();
    addRow(statusRows, 'Battery', `About ${Battery.mapVoltageToSoc(voltage)}% (${voltage} mV) · ${BatteryStatus1001[status] ? humanize(BatteryStatus1001[status]) : 'Discharging'}`);
  } catch (e) { console.log(e); }

  try {
    const battery = new Battery(device);
    const { percentage, level, status } = await battery.getBattery1004();
    addRow(statusRows, 'Battery', `${percentage ? `${percentage}%` : humanize(BatteryLevel1004[level])} · ${humanize(BatteryStatus1000[status])}`);
  } catch (e) { console.log(e); }

  try {
    const battery = new Battery(device);
    const { voltage, status } = await battery.getBattery1f20();
    addRow(statusRows, 'Battery', `About ${Battery.mapVoltageToSoc(voltage)}% (${voltage} mV) · ${humanize(BatteryStatus1f20[status])}`);
  } catch (e) { console.log(e); }

  try {
    const dpi = new AdjustableDpi(device);
    const sensorCount = await dpi.getSensorCount();

    for (let i = 0; i < sensorCount; i += 1) {
      const index = i;

      const dpiList = await dpi.getDpiList(index);
      const currentDpi = await dpi.getDpi(index);

      const select = element('select');
      for (const value of dpiList) {
        const option = element('option', undefined, value.toString());
        option.value = value.toString();
        select.appendChild(option);
      }
      select.value = currentDpi.toString();
      select.onchange = () => {
        const value = parseInt(select.value, 10);
        queueChange(select, async () => { await dpi.setDpi(index, value); });
      };

      addRow(performance, sensorCount > 1 ? `Sensor ${index + 1} DPI` : 'DPI', select);
    }
  } catch (e) { console.log(e); }

  try {
    const reportRate = new ReportRate(device);
    const reportRateList = await reportRate.getReportRateList();
    const currentReportRate = await reportRate.getReportRate();

    const select = element('select');
    for (const value of reportRateList) {
      const option = element('option', undefined, formatReportRate(value));
      option.value = value.toString();
      select.appendChild(option);
    }
    select.value = currentReportRate.toString();
    select.onchange = () => {
      const value = parseInt(select.value, 10);
      queueChange(select, () => reportRate.setReportRate(value));
    };

    addRow(performance, 'Report rate', select);
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

    const sync = element('input');
    sync.type = 'checkbox';
    sync.checked = zones.length > 1 && zones.every(zone =>
      JSON.stringify(savedEffects[zone.index]) === JSON.stringify(savedEffects[zones[0].index]));
    if (zones.length > 1) {
      addRow(lighting, 'Sync zones', labeled('', sync, 'Use the same lighting on every zone'));
    }

    const rows: {
      enabled: HTMLInputElement;
      select: HTMLSelectElement;
      color: HTMLInputElement;
      period: HTMLInputElement;
      intensity: HTMLInputElement;
      buildEffect: () => RgbEffect;
      updateVisibility: () => void;
      queue: () => void;
    }[] = [];

    const copyRow = (source: typeof rows[number], target: typeof rows[number]) => {
      target.enabled.checked = source.enabled.checked;
      if (Array.from(target.select.options).some(option => option.value === source.select.value)) {
        target.select.value = source.select.value;
      }
      target.color.value = source.color.value;
      target.period.value = source.period.value;
      target.intensity.value = source.intensity.value;
      target.updateVisibility();
    };

    sync.onchange = () => {
      if (sync.checked) {
        rows.slice(1).forEach(row => copyRow(rows[0], row));
        rows.forEach(row => row.queue());
      }
    };

    for (const zone of zones) {
      const div = addRow(lighting, RgbZoneLocation[zone.location] ? humanize(RgbZoneLocation[zone.location]) : `Zone ${zone.index + 1}`);
      const value = div.lastElementChild as HTMLElement;

      const enabled = element('input');
      enabled.type = 'checkbox';
      enabled.checked = true;

      const select = element('select');
      for (const effect of zone.effects) {
        const label = EFFECT_LABELS[effect.id];
        if (!label) {
          continue;
        }
        const option = element('option', undefined, label);
        option.value = effect.id.toString();
        select.appendChild(option);
      }

      const color = element('input');
      color.type = 'color';
      color.value = '#00b4ff';
      color.title = 'Color';

      // Shown in seconds, sent in milliseconds
      const period = element('input');
      period.type = 'number';
      period.min = '1';
      period.max = '20';
      period.step = '0.5';
      period.value = '5';
      const periodLabel = labeled('Speed', period, 's');

      const intensity = element('input');
      intensity.type = 'range';
      intensity.min = '1';
      intensity.max = '100';
      intensity.value = '100';
      const intensityLabel = labeled('Brightness', intensity);

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
          period.value = (saved.period / 1000).toString();
          intensity.value = (saved.intensity || 100).toString();
        }
      }

      const buildEffect = (): RgbEffect => {
        if (!enabled.checked) {
          return { id: RgbEffectId.Off };
        }
        const hex = parseInt(color.value.slice(1), 16);
        const rgb = { r: hex >> 16, g: (hex >> 8) & 0xff, b: hex & 0xff };
        const periodMs = Math.round(Math.min(Math.max(parseFloat(period.value) || 5, 1), 20) * 1000);
        switch (parseInt(select.value, 10)) {
          case RgbEffectId.Cycle:
            return { id: RgbEffectId.Cycle, period: periodMs, intensity: parseInt(intensity.value, 10) };
          case RgbEffectId.Breathing:
            return { id: RgbEffectId.Breathing, color: rgb, period: periodMs, intensity: parseInt(intensity.value, 10) };
          default:
            return { id: RgbEffectId.Static, color: rgb };
        }
      };

      const updateVisibility = () => {
        const id = parseInt(select.value, 10);
        select.disabled = !enabled.checked;
        color.hidden = !enabled.checked || id === RgbEffectId.Cycle;
        periodLabel.hidden = !enabled.checked || id === RgbEffectId.Static;
        intensityLabel.hidden = !enabled.checked || id === RgbEffectId.Static;
      };
      updateVisibility();

      const queue = () => {
        updateVisibility();
        const effect = buildEffect();
        queueChange(div, () => rgbEffects.setZoneEffect(zone, effect));
        if (profileAddress !== undefined) {
          const address = profileAddress;
          const effects = rows.map(row => row.buildEffect());
          queueChange(lighting, () => onBoardProfile.writeProfileLeds(address, effects));
        }
      };
      const row = { enabled, select, color, period, intensity, buildEffect, updateVisibility, queue };
      rows.push(row);

      const onEdit = () => {
        if (!sync.checked) {
          queue();
          return;
        }
        for (const other of rows) {
          if (other !== row) {
            copyRow(row, other);
          }
        }
        rows.forEach(row => row.queue());
      };
      enabled.onchange = onEdit;
      select.onchange = onEdit;
      color.oninput = onEdit;
      period.oninput = onEdit;
      intensity.oninput = onEdit;

      value.append(labeled('', enabled, 'On'), select, color, periodLabel, intensityLabel);
    }
  } catch (e) { console.log(e); }

  try {
    const onBoardProfile = new OnBoardProfile(device);
    const mode = await onBoardProfile.getMode();

    const MODE_LABELS: Record<number, string> = {
      [OnBoardProfileMode.OnBoard]: 'On-board (settings saved on the mouse)',
      [OnBoardProfileMode.Host]: 'Host (settings controlled by software)',
    };
    const select = element('select');
    for (const value of [OnBoardProfileMode.OnBoard, OnBoardProfileMode.Host]) {
      const option = element('option', undefined, MODE_LABELS[value]);
      option.value = value.toString();
      select.appendChild(option);
    }
    select.value = mode.toString();
    select.onchange = () => {
      const value = parseInt(select.value, 10);
      queueChange(select, () => onBoardProfile.setMode(value));
    };
    addRow(profiles, 'Mode', select);

    const profilesInfo = await onBoardProfile.getProfilesInfo();
    const activeAddress = profilesInfo[await onBoardProfile.getCurrentProfile() - 1]?.address;

    for (const [i, profileInfo] of profilesInfo.entries()) {
      const details = element('details');
      const active = profileInfo.address === activeAddress;
      details.append(element(
        'summary',
        undefined,
        `Profile ${i + 1}${active ? ' (active)' : profileInfo.enabled ? '' : ' (disabled)'}`
      ));
      profiles.append(details);

      if (!profileInfo.enabled) {
        continue;
      }

      const profile = await onBoardProfile.readProfile(profileInfo.address);
      addRow(details, 'Report rate', formatReportRate(profile.reportRate));
      addRow(details, 'DPI steps', profile.dpi.filter(Boolean).map((x, i) =>
        `${x}${i === profile.defaultDpi ? ' (default)' : ''}${i === profile.switchedDpi ? ' (shift)' : ''}`
      ).join(', '));

      if (active) {
        const currentDpiIndex = await onBoardProfile.getCurrentDpiIndex();
        addRow(details, 'Current DPI', `${profile.dpi[currentDpiIndex]}`);
      }
    }
  } catch (e) { console.log(e); }

  for (const section of [statusRows, performance, lighting, profiles]) {
    if (section.childElementCount <= (section === statusRows ? 0 : 1)) {
      section.remove();
    }
  }
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
