// 폰 기능(기울기·마이크). 권한 요청은 터치 이벤트 안에서만 되므로(iOS) 게임은 "원한다"고만 표시하고,
// 다음 터치 때 main.ts의 onGesture에서 실제로 요청한다. 권한이 없거나 기기가 지원하지 않으면 게임이 대체 조작을 쓴다.

export type SensorState = 'off' | 'pending' | 'on' | 'denied';

type MotionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

class Sensors {
  motion: SensorState = 'off';
  mic: SensorState = 'off';
  /** 기울기(좌우 x, 앞뒤 y, 각각 -1~1). 가로로 든 폰 기준 */
  tilt = { x: 0, y: 0 };
  /** 마이크 소리 크기(0~1) */
  level = 0;
  private wantMotion = false;
  private wantMic = false;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;

  requestMotion(): void {
    this.wantMotion = true;
  }

  requestMic(): void {
    this.wantMic = true;
  }

  /** 사용자 터치 이벤트 안에서 불린다 */
  onGesture(): void {
    if (this.wantMotion && this.motion === 'off') this.startMotion();
    if (this.wantMic && this.mic === 'off') this.startMic();
  }

  private startMotion(): void {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      this.motion = 'denied';
      return;
    }
    this.motion = 'pending';
    const listen = () => {
      window.addEventListener('deviceorientation', (e) => {
        if (e.beta === null || e.gamma === null) return;
        this.motion = 'on';
        // 가로로 든 화면: 화면 방향에 맞춰 축을 바꾼다
        const angle = (screen.orientation?.angle ?? 0) as number;
        const [lr, fb] = angle === 90 ? [e.beta, -e.gamma] : angle === 270 || angle === -90 ? [-e.beta, e.gamma] : [e.gamma, e.beta];
        this.tilt.x = Math.max(-1, Math.min(1, lr / 30));
        this.tilt.y = Math.max(-1, Math.min(1, fb / 30));
      });
      // 이벤트가 안 오면(데스크톱 등) 대체 조작을 쓴다
      setTimeout(() => {
        if (this.motion === 'pending') this.motion = 'denied';
      }, 1500);
    };
    const ctor = (window as unknown as { DeviceOrientationEvent: MotionCtor }).DeviceOrientationEvent;
    if (typeof ctor.requestPermission === 'function') {
      ctor
        .requestPermission()
        .then((r) => (r === 'granted' ? listen() : (this.motion = 'denied')))
        .catch(() => (this.motion = 'denied'));
    } else listen();
  }

  private startMic(): void {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.mic = 'denied';
      return;
    }
    this.mic = 'pending';
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        const src = ctx.createMediaStreamSource(stream);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 512;
        src.connect(this.analyser);
        this.buf = new Float32Array(this.analyser.fftSize);
        this.mic = 'on';
      })
      .catch(() => (this.mic = 'denied'));
  }

  /** 마이크 소리 크기를 다시 잰다(매 틱) */
  sampleMic(): number {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = Math.min(1, rms * 4);
    return this.level;
  }
}

export const sensors = new Sensors();
