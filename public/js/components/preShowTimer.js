// public/js/components/preShowTimer.js

class PreShowTimer {
  /**
   * @param {Element} slotEl  – a pre-existing empty container inside .timeline-info
   */
  constructor(slotEl) {
    this.slot     = slotEl;
    this.active   = false;
  }

  /**
   * @param {object|null} timerData  – { label, secondsRemaining, targetTime } | null
   */
  update(timerData) {
    if (!timerData) {
      this._hide();
      return;
    }
    this._show(timerData);
  }

  _show({ label, secondsRemaining, targetTime }) {
    this.active = true;
    this.slot.innerHTML = `
      <div class="time-item preshow-timer">
        <span class="time-label preshow-label">${label}</span>
        <span class="time-value preshow-value">${this._fmt(secondsRemaining)}</span>
        ${targetTime ? `<span class="preshow-target">(${targetTime})</span>` : ''}
      </div>
    `;
    this.slot.classList.remove('hidden');
  }

  _hide() {
    this.active = false;
    this.slot.innerHTML = '';
    this.slot.classList.add('hidden');
  }

  _fmt(totalSec) {
    const s  = Math.max(0, Math.round(totalSec));
    const h  = Math.floor(s / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return `${m}:${String(ss).padStart(2,'0')}`;
  }
}
