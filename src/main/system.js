'use strict';

// CPU, memory, disk, network and battery for the "System" section.
// Sampled only while that section is on screen.

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const koffi = require('koffi');

const SAMPLE_MS = 1500;

const kernel32 = koffi.load('kernel32.dll');
const iphlpapi = koffi.load('iphlpapi.dll');

const SYSTEM_POWER_STATUS = koffi.struct('SYSTEM_POWER_STATUS', {
  ACLineStatus: 'uint8_t',
  BatteryFlag: 'uint8_t',
  BatteryLifePercent: 'uint8_t',
  SystemStatusFlag: 'uint8_t',
  BatteryLifeTime: 'uint32_t',
  BatteryFullLifeTime: 'uint32_t',
});
const GetSystemPowerStatus = kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ SYSTEM_POWER_STATUS *status)');

// Only the layout matters here: koffi works out the offsets of the counters we read.
const GUID = koffi.struct('IF_GUID', { a: 'uint32_t', b: 'uint16_t', c: 'uint16_t', d: koffi.array('uint8_t', 8) });
const MIB_IF_ROW2 = koffi.struct('MIB_IF_ROW2', {
  InterfaceLuid: 'uint64_t',
  InterfaceIndex: 'uint32_t',
  InterfaceGuid: GUID,
  Alias: koffi.array('uint16_t', 257),
  Description: koffi.array('uint16_t', 257),
  PhysicalAddressLength: 'uint32_t',
  PhysicalAddress: koffi.array('uint8_t', 32),
  PermanentPhysicalAddress: koffi.array('uint8_t', 32),
  Mtu: 'uint32_t',
  Type: 'uint32_t',
  TunnelType: 'int32_t',
  MediaType: 'int32_t',
  PhysicalMediumType: 'int32_t',
  AccessType: 'int32_t',
  DirectionType: 'int32_t',
  InterfaceAndOperStatusFlags: 'uint8_t',
  OperStatus: 'int32_t',
  AdminStatus: 'int32_t',
  MediaConnectState: 'int32_t',
  NetworkGuid: GUID,
  ConnectionType: 'int32_t',
  TransmitLinkSpeed: 'uint64_t',
  ReceiveLinkSpeed: 'uint64_t',
  InOctets: 'uint64_t',
  InUcastPkts: 'uint64_t',
  InNUcastPkts: 'uint64_t',
  InDiscards: 'uint64_t',
  InErrors: 'uint64_t',
  InUnknownProtos: 'uint64_t',
  InUcastOctets: 'uint64_t',
  InMulticastOctets: 'uint64_t',
  InBroadcastOctets: 'uint64_t',
  OutOctets: 'uint64_t',
  OutUcastPkts: 'uint64_t',
  OutNUcastPkts: 'uint64_t',
  OutDiscards: 'uint64_t',
  OutErrors: 'uint64_t',
  OutUcastOctets: 'uint64_t',
  OutMulticastOctets: 'uint64_t',
  OutBroadcastOctets: 'uint64_t',
  OutQLen: 'uint64_t',
});
const GetIfTable2 = iphlpapi.func('uint32_t __stdcall GetIfTable2(_Out_ void **table)');
const FreeMibTable = iphlpapi.func('void __stdcall FreeMibTable(void *memory)');

const ROW_SIZE = koffi.sizeof(MIB_IF_ROW2);
const ROWS_OFFSET = 8; // ULONG NumEntries, then rows aligned to 8 bytes
const OFFSET = {
  type: koffi.offsetof(MIB_IF_ROW2, 'Type'),
  flags: koffi.offsetof(MIB_IF_ROW2, 'InterfaceAndOperStatusFlags'),
  oper: koffi.offsetof(MIB_IF_ROW2, 'OperStatus'),
  inOctets: koffi.offsetof(MIB_IF_ROW2, 'InOctets'),
  outOctets: koffi.offsetof(MIB_IF_ROW2, 'OutOctets'),
};
const IF_TYPE_SOFTWARE_LOOPBACK = 24;
const IF_OPER_STATUS_UP = 1;
const HARDWARE_INTERFACE = 0x1;
const FILTER_INTERFACE = 0x2;

/** Total bytes received and sent by physical adapters (filter duplicates skipped). */
function networkTotals() {
  const out = [null];
  if (GetIfTable2(out) !== 0 || !out[0]) return null;
  const table = out[0];
  try {
    const count = koffi.decode(table, 'uint32_t');
    let down = 0n;
    let up = 0n;
    for (let i = 0; i < count; i++) {
      const base = ROWS_OFFSET + i * ROW_SIZE;
      const flags = koffi.decode(table, base + OFFSET.flags, 'uint8_t');
      const type = koffi.decode(table, base + OFFSET.type, 'uint32_t');
      const oper = koffi.decode(table, base + OFFSET.oper, 'int32_t');
      if (!(flags & HARDWARE_INTERFACE) || (flags & FILTER_INTERFACE)) continue;
      if (type === IF_TYPE_SOFTWARE_LOOPBACK || oper !== IF_OPER_STATUS_UP) continue;
      down += BigInt(koffi.decode(table, base + OFFSET.inOctets, 'uint64_t'));
      up += BigInt(koffi.decode(table, base + OFFSET.outOctets, 'uint64_t'));
    }
    return { down, up };
  } finally {
    FreeMibTable(table);
  }
}

function battery() {
  const status = {};
  if (!GetSystemPowerStatus(status)) return null;
  // 128: no system battery, 255: unknown.
  if (status.BatteryFlag & 128 || status.BatteryFlag === 255 || status.BatteryLifePercent > 100) return null;
  return {
    percent: status.BatteryLifePercent,
    plugged: status.ACLineStatus === 1,
    charging: Boolean(status.BatteryFlag & 8),
    secondsLeft: status.BatteryLifeTime === 0xffffffff ? null : status.BatteryLifeTime,
  };
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function disk() {
  const drive = (process.env.SystemDrive || 'C:').toUpperCase();
  try {
    const stats = fs.statfsSync(`${drive}\\`);
    return { drive, free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  } catch {
    return null;
  }
}

class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.previous = null;
  }

  watch(enabled) {
    if (enabled && !this.timer) {
      this.previous = { at: Date.now(), cpu: cpuTimes(), net: safe(networkTotals) };
      this.timer = setInterval(() => this.sample(), SAMPLE_MS);
      setTimeout(() => this.sample(), 300);
    } else if (!enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  sample() {
    const now = Date.now();
    const cpu = cpuTimes();
    const net = safe(networkTotals);
    const prev = this.previous;
    const seconds = Math.max(0.001, (now - prev.at) / 1000);
    const cpuTotal = cpu.total - prev.cpu.total;
    const cpuIdle = cpu.idle - prev.cpu.idle;

    let network = null;
    if (net && prev.net) {
      // Counters only grow; a negative delta means an adapter came or went.
      const down = Number(net.down - prev.net.down);
      const up = Number(net.up - prev.net.up);
      network = { down: Math.max(0, down / seconds), up: Math.max(0, up / seconds) };
    }
    this.previous = { at: now, cpu, net };

    this.emit('sample', {
      cpu: cpuTotal > 0 ? Math.min(1, Math.max(0, 1 - cpuIdle / cpuTotal)) : 0,
      memory: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
      disk: disk(),
      network,
      battery: safe(battery),
      uptime: os.uptime(),
    });
  }
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[system]', err.message);
    return null;
  }
}

module.exports = { SystemMonitor, networkTotals, battery };
