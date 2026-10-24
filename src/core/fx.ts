import { createRng } from './rng';
import type { Color } from '../render/palette';
import type { Renderer } from '../render/renderer';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: Color;
}

const SHAKE_STEP = 1 / 30;
const GRAVITY = 220;

/**
 * 탭 피드백(진동 대신): 화면 흔들림 2~4px + 픽셀 파편.
 * 움직임은 프레임 단위로 끊어지게 정수 좌표로 찍는다.
 */
export class Fx {
  private readonly rng = createRng(Date.now());
  private particles: Particle[] = [];
  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeClock = 0;
  offsetX = 0;
  offsetY = 0;

  shake(amp = 3, seconds = 0.12): void {
    this.shakeAmp = Math.max(this.shakeAmp, Math.min(4, Math.max(2, amp)));
    this.shakeLeft = Math.max(this.shakeLeft, seconds);
  }

  burst(x: number, y: number, color: Color, count = 8): void {
    for (let i = 0; i < count; i++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const speed = this.rng.range(40, 110);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: this.rng.range(0.25, 0.5),
        size: this.rng.int(2) + 1,
        color,
      });
    }
  }

  update(dt: number): void {
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      this.shakeClock += dt;
      if (this.shakeClock >= SHAKE_STEP) {
        this.shakeClock = 0;
        this.offsetX = this.rng.int(this.shakeAmp * 2 + 1) - this.shakeAmp;
        this.offsetY = this.rng.int(this.shakeAmp * 2 + 1) - this.shakeAmp;
      }
      if (this.shakeLeft <= 0) {
        this.shakeAmp = 0;
        this.offsetX = 0;
        this.offsetY = 0;
      }
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  render(r: Renderer): void {
    for (const p of this.particles) r.rect(p.x, p.y, p.size, p.size, p.color);
  }
}
