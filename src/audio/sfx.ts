import type { Seat } from '../input/seats';

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  /** 끝 주파수. 주면 미끄러지듯 변한다 */
  slideTo?: number;
  delay?: number;
}

type AudioCtor = typeof AudioContext;

/**
 * WebAudio로 만든 8비트 효과음. 오디오는 첫 터치 이후에만 켜진다(iOS 제한).
 * 무음 모드·재생 실패여도 게임은 그대로 동작해야 하므로 모든 재생은 실패를 삼킨다.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.5;

  /** 사용자 제스처 안에서 호출한다. 여러 번 불러도 안전. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor: AudioCtor | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(freq: number, dur: number, { type = 'square', vol = 0.18, slideTo, delay = 0 }: ToneOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    try {
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {
      // 재생 실패는 무시
    }
  }

  private noise(dur: number, vol = 0.15, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    try {
      if (!this.noiseBuf) {
        this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const t0 = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = this.noiseBuf;
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(gain).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    } catch {
      // 재생 실패는 무시
    }
  }

  /** 동전 투입 */
  coin(): void {
    this.tone(988, 0.07, { vol: 0.16 });
    this.tone(1319, 0.28, { vol: 0.16, delay: 0.07 });
  }

  /** 버튼 딸깍 */
  click(): void {
    this.noise(0.03, 0.12);
    this.tone(220, 0.04, { type: 'square', vol: 0.1 });
  }

  /** 화면을 탭했을 때의 짧은 반응음 */
  tap(): void {
    this.tone(660, 0.05, { vol: 0.12, slideTo: 880 });
  }

  /** 카운트다운 숫자 */
  beep(): void {
    this.tone(440, 0.12, { vol: 0.16 });
  }

  go(): void {
    this.tone(880, 0.3, { vol: 0.18 });
    this.tone(1320, 0.3, { vol: 0.12 });
  }

  /** 시작 게이지가 찰 때 올라가는 음 */
  charge(step: number): void {
    this.tone(330 * 2 ** (step / 6), 0.06, { type: 'triangle', vol: 0.14 });
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, { vol: 0.16, delay: i * 0.11 }));
    this.tone(1047, 0.45, { vol: 0.16, delay: 0.45 });
    this.tone(784, 0.45, { vol: 0.1, type: 'triangle', delay: 0.45 });
  }

  /** 패배 "뿅" */
  lose(): void {
    this.tone(520, 0.28, { type: 'square', vol: 0.14, slideTo: 130 });
  }

  /** 캐릭터별 참가음: 꾹이 딸깍, 레버 덜컹, 땡그랑 쨍, 캡슐 뽁 */
  character(seat: Seat): void {
    switch (seat) {
      case 0:
        this.noise(0.03, 0.14);
        this.tone(180, 0.06, { vol: 0.14 });
        this.tone(320, 0.05, { vol: 0.1, delay: 0.05 });
        break;
      case 1:
        this.tone(110, 0.08, { type: 'sawtooth', vol: 0.16 });
        this.tone(90, 0.1, { type: 'sawtooth', vol: 0.14, delay: 0.09 });
        this.noise(0.05, 0.08, 0.09);
        break;
      case 2:
        this.tone(1760, 0.18, { vol: 0.1 });
        this.tone(2349, 0.3, { vol: 0.1, delay: 0.03 });
        this.tone(1568, 0.3, { type: 'triangle', vol: 0.08, delay: 0.03 });
        break;
      default:
        this.tone(300, 0.1, { type: 'sine', vol: 0.22, slideTo: 900 });
        break;
    }
  }
}
