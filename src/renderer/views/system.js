import { h, iconEl } from '../lib/dom.js';
import { bytes } from '../lib/format.js';
import { t } from '../lib/i18n.js';

const HISTORY = 40;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A tiny line chart of recent values, scaled to its own maximum. */
function sparkline() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${HISTORY - 1} 20`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('spark');
  const area = document.createElementNS(SVG_NS, 'path');
  const line = document.createElementNS(SVG_NS, 'path');
  area.classList.add('spark-area');
  line.classList.add('spark-line');
  svg.append(area, line);
  return {
    el: svg,
    draw(values, max) {
      const top = Math.max(max ?? Math.max(...values), 1e-9);
      const points = values.map((v, i) => [i + (HISTORY - values.length), 19 - (v / top) * 17]);
      if (points.length < 2) return;
      const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
      line.setAttribute('d', d);
      area.setAttribute('d', `${d} L${points.at(-1)[0]} 20 L${points[0][0]} 20 Z`);
    },
  };
}

function tile(icon, label) {
  const value = h('div', { class: 'tile-value' });
  const detail = h('div', { class: 'tile-detail' });
  const el = h('div', { class: 'tile' },
    h('div', { class: 'tile-label' }, iconEl(icon), h('span', {}, label)),
    value, detail);
  return { el, value, detail };
}

function meter() {
  const fill = h('i');
  return { el: h('div', { class: 'meter' }, fill), set: (ratio) => fill.style.setProperty('--m', String(Math.min(1, Math.max(0, ratio)))) };
}

export function createSystemView(root, api) {
  const history = { cpu: [], down: [] };

  const cpu = tile('cpu', t('sys.cpu'));
  const cpuSpark = sparkline();
  cpu.el.append(cpuSpark.el);

  const memory = tile('memory', t('sys.memory'));
  const memoryMeter = meter();
  memory.el.append(memoryMeter.el);

  const network = tile('network', t('sys.network'));
  const netSpark = sparkline();
  network.el.append(netSpark.el);

  const disk = tile('disk', t('sys.disk', { drive: 'C:' }));
  const diskMeter = meter();
  disk.el.append(diskMeter.el);

  const battery = tile('battery', t('sys.battery'));
  const batteryMeter = meter();
  battery.el.append(batteryMeter.el);

  const uptime = tile('clock', t('sys.uptime'));

  root.append(h('div', { class: 'system' }, cpu.el, memory.el, network.el, disk.el, battery.el, uptime.el));

  const percent = (ratio) => `${Math.round(ratio * 100)}%`;

  function uptimeText(seconds) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days ? t('sys.daysHours', { days, hours }) : t('sys.hoursMinutes', { hours, minutes });
  }

  function batteryState(b) {
    if (!b.plugged) {
      return b.secondsLeft ? `${t('sys.onBattery')}, ${t('sys.left', { time: uptimeText(b.secondsLeft) })}` : t('sys.onBattery');
    }
    return b.percent < 100 ? t('sys.charging') : t('sys.pluggedIn');
  }

  function update(s) {
    history.cpu = [...history.cpu, s.cpu].slice(-HISTORY);
    cpu.value.textContent = percent(s.cpu);
    cpu.detail.textContent = '';
    cpuSpark.draw(history.cpu, 1);

    memory.value.textContent = percent(s.memory.used / s.memory.total);
    memory.detail.textContent = t('sys.of', { used: bytes(s.memory.used), total: bytes(s.memory.total) });
    memoryMeter.set(s.memory.used / s.memory.total);

    network.el.hidden = !s.network;
    if (s.network) {
      history.down = [...history.down, s.network.down].slice(-HISTORY);
      network.value.replaceChildren(
        h('span', { class: 'net-down' }, '↓ ', t('sys.perSecond', { value: bytes(s.network.down) })));
      network.detail.textContent = `${t('sys.up')} ↑ ${t('sys.perSecond', { value: bytes(s.network.up) })}`;
      netSpark.draw(history.down);
    }

    disk.el.hidden = !s.disk;
    if (s.disk) {
      disk.el.querySelector('.tile-label span').textContent = t('sys.disk', { drive: s.disk.drive });
      disk.value.textContent = bytes(s.disk.free);
      disk.detail.textContent = t('sys.free', { free: bytes(s.disk.free), total: bytes(s.disk.total) });
      diskMeter.set(1 - s.disk.free / s.disk.total);
    }

    battery.el.hidden = !s.battery;
    if (s.battery) {
      battery.value.replaceChildren(`${s.battery.percent}%`, s.battery.plugged ? iconEl('bolt') : '');
      battery.detail.textContent = batteryState(s.battery);
      batteryMeter.set(s.battery.percent / 100);
      battery.el.classList.toggle('is-low', !s.battery.plugged && s.battery.percent <= 20);
    }

    uptime.value.textContent = uptimeText(s.uptime);
    uptime.detail.textContent = '';
    root.classList.add('has-data');
  }

  api.system.onSample(update);

  return {
    setVisible(value) {
      api.system.watch(value);
    },
  };
}
