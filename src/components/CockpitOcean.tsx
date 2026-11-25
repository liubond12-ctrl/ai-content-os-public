"use client";

import { useEffect, useRef } from "react";
import type { OceanEngine } from "@/vendor/cockpit-ocean/engine";

type Preferences = { visible: boolean; paused: boolean; strength: number };

/** Only mounted on /. The engine, listeners and render loop belong to this mount. */
export default function CockpitOcean({ visible, paused, strength }: Preferences) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apply = useRef<((options: Preferences) => void) | null>(null);
  const options = useRef({ visible, paused, strength });
  useEffect(() => {
    options.current = { visible, paused, strength };
    apply.current?.(options.current);
  }, [visible, paused, strength]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const home = canvas?.closest(".cockpit-home");
    const content = home?.closest<HTMLElement>(".content");
    if (!canvas || !home || !content) return;
    const narrow = matchMedia("(max-width:639px)");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const dark = matchMedia("(prefers-color-scheme: dark)");
    let closed = false;
    let cleanup: (() => void) | undefined;

    async function mount(element: HTMLCanvasElement, host: HTMLElement) {
      if (narrow.matches || !options.current.visible || closed) return;
      const { OceanEngine: Engine } = await import("@/vendor/cockpit-ocean/engine");
      if (closed || cleanup || narrow.matches || !options.current.visible) return;
      const engine: OceanEngine = new Engine(element, { host, fadeIn: false });
      engine.bindPointer = () => {};
      function setPalette() {
        const palette = dark.matches
          ? { theme: "dark", sharkColor: "#9daebf", dotPrimary: "#8ba1b5", dotSecondary: "#668099", accent: "#adbfce" }
          : { theme: "light", sharkColor: "#666970", dotPrimary: "#96918a", dotSecondary: "#b2ada5", accent: "#76716b" };
        engine.setSettings(palette);
      }
      engine.setSettings({ species: "shark", transparent: true, cellSize: 8, grid: 0, dotDensity: 0.025 });
      setPalette();
      let masks: number[][] = [];
      let dirty = true;
      let frame = 0;
      let wasVisible = false;
      let wasMoving = false;
      function measure() {
        const origin = element.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const bounds: DOMRect[] = [];
        const range = document.createRange();
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          range.selectNodeContents(walker.currentNode);
          bounds.push(...range.getClientRects());
        }
        for (const block of host.querySelectorAll(".ck-card, a, button, .ck-settings[open]")) {
          bounds.push(...block.getClientRects());
        }
        masks = bounds.filter(r => r.width && r.height).map(r =>
          [r.left+scrollX-origin.left-24, r.top+scrollY-origin.top-24, r.width+48, r.height+48]);
        dirty = false;
      }
      const render = engine.renderer.render.bind(engine.renderer);
      engine.renderer.render = (world, dt) => {
        if (dirty && !element.hidden) measure();
        render(world, dt);
        const { ctx, dpr } = engine.renderer;
        const { scrollX, scrollY } = window;
        const w = element.width / dpr, h = element.height / dpr;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const [x,y,width,height] of masks) {
          const left = x - scrollX, top = y - scrollY;
          if (left < w && top < h && left + width > 0 && top + height > 0) ctx.clearRect(left,top,width,height);
        }
        ctx.restore();
      };
      function moving() {
        return !element.hidden && !options.current.paused && !document.hidden && !reducedMotion.matches;
      }
      function paintStill() {
        if (frame || element.hidden || document.hidden || moving()) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (element.hidden || document.hidden || moving()) return;
          engine.renderer.world = engine.world;
          engine.renderer.render(engine.world, 0);
        });
      }
      const schedule = engine.schedule.bind(engine);
      engine.schedule = () => {
        cancelAnimationFrame(engine.raf);
        if (!engine.disposed && moving()) schedule();
      };
      function sync() {
        const { visible, strength } = options.current;
        element.hidden = !visible || narrow.matches;
        const isVisible = !element.hidden;
        if (isVisible && !wasVisible) {
          dirty = true;
          engine.resize();
        }
        // Strength only affects compositing. Keep the engine's own opacity fixed.
        element.style.opacity = String(strength);
        const isMoving = moving();
        if (isMoving !== wasMoving) engine.schedule();
        if (isVisible && (!wasVisible || dirty)) paintStill();
        wasVisible = isVisible;
        wasMoving = isMoving;
      }
      function layoutChanged() {
        dirty = true;
        paintStill();
      }
      function themeChanged() {
        setPalette();
        paintStill();
      }
      const observer = new ResizeObserver(layoutChanged);
      observer.observe(host);
      const mutations = new MutationObserver(layoutChanged);
      mutations.observe(host, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter:["open","hidden"] });
      window.addEventListener("scroll",paintStill,{passive:true});
      window.addEventListener("resize",layoutChanged);
      document.addEventListener("visibilitychange",sync);
      reducedMotion.addEventListener("change",sync);
      dark.addEventListener("change",themeChanged);
      engine.opacity = 1;
      engine.setSettings({heroOpacity:1,idleOpacity:1});
      element.hidden = false;
      wasVisible = true;
      wasMoving = moving();
      engine.start();
      apply.current = sync;
      sync();
      paintStill();
      cleanup = () => {
        cancelAnimationFrame(frame);
        engine.destroy();
        observer.disconnect();
        mutations.disconnect();
        window.removeEventListener("scroll",paintStill);
        document.removeEventListener("visibilitychange",sync);
        window.removeEventListener("resize",layoutChanged);
        reducedMotion.removeEventListener("change",sync);
        dark.removeEventListener("change",themeChanged);
      };
    }
    function setup() {
      if (cleanup) apply.current?.(options.current);
      else if (canvas && content) void mount(canvas, content).catch(() => { canvas.hidden = true; });
    }
    apply.current = setup;
    setup();
    narrow.addEventListener("change",setup);
    return () => {
      closed = true;
      narrow.removeEventListener("change",setup);
      cleanup?.();
      apply.current = null;
    };
  }, []);
  return <canvas className="ck-ocean" ref={canvasRef} aria-hidden="true" />;
}
