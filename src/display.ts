export type FrameRate = 'display' | '30' | '60' | '120';
export const frameRates: {value: FrameRate; label: string}[] = [
  {value: 'display', label: '画面に合わせる'},
  {value: '30', label: '30 FPS'},
  {value: '60', label: '60 FPS'},
  {value: '120', label: '120 FPS'},
];
export function frameRate(value: unknown): FrameRate {
  return frameRates.find(option => option.value === value)?.value ?? 'display';
}

/** Frame deadlines stay on a fixed timeline, including on 144/165 Hz displays. */
export class FrameClock {
  rate: FrameRate = 'display';
  private due: number | null = null;
  private last: number | null = null;
  private since: number | null = null;
  private frames = 0;
  fps = 0;
  reset() { this.due = this.last = this.since = null; this.frames = this.fps = 0; }
  setRate(rate: FrameRate) { this.rate = rate; this.reset(); }
  tick(now: number): number | null {
    const interval = this.rate === 'display' ? 0 : 1000 / Number(this.rate);
    if (interval && this.due !== null && now < this.due - .2) return null;
    if (interval) {
      const due = this.due ?? now;
      this.due = due + Math.max(1, Math.floor((now - due + .2) / interval) + 1) * interval;
    }
    const delta = this.last === null ? 1 / 60 : Math.min(.1, (now - this.last) / 1000);
    this.last = now;
    if (this.since === null) this.since = now;
    else {
      this.frames++;
      if (now - this.since >= 1000) {
        this.fps = Math.round(this.frames * 1000 / (now - this.since));
        this.since = now; this.frames = 0;
      }
    }
    return delta;
  }
}
