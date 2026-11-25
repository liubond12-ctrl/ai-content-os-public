export class OceanEngine {
  constructor(canvas: HTMLCanvasElement, options: { fadeIn: boolean; host: HTMLElement });
  world: { time: number; sharks: unknown[] };
  renderer: {
    ctx: CanvasRenderingContext2D;
    dpr: number;
    world: OceanEngine["world"];
    render(world: OceanEngine["world"], dt: number): void;
  };
  raf: number;
  opacity: number;
  disposed: boolean;
  schedule(): void;
  bindPointer(): void;
  start(): void;
  resize(): void;
  destroy(): void;
  setSettings(settings: Record<string, string | number | boolean>): void;
}
