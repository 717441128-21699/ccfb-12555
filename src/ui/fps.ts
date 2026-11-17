/** 角落实时帧率统计，带 1 秒滑窗与画质降级提示 */
export class FpsCounter {
  private frames = 0;
  private elapsed = 0;
  private fps = 0;
  private lowTime = 0;
  onDegrade?: (fps: number) => void;
  private degraded = false;

  update(dt: number): number {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.fps = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
      if (this.fps < 30) {
        this.lowTime += 0.5;
        if (this.lowTime >= 2 && !this.degraded) {
          this.degraded = true;
          this.onDegrade?.(this.fps);
        }
      } else {
        this.lowTime = 0;
      }
    }
    return this.fps;
  }

  get current(): number {
    return this.fps;
  }
}
