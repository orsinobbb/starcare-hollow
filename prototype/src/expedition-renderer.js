import { EXPEDITION_HEIGHT, EXPEDITION_WIDTH, isInBounds, isRevealed, targetAt, terrainAt } from "./expedition-engine.js";

const MAX_PARTICLES = 40;
const TAP_DISTANCE_PX = 8;
const FIXED_STEP_SECONDS = 1 / 60;
const EXCAVATION_TIMELINE = {
  aim: 0.22,
  impact: 0.18,
  reveal: 0.36,
  settle: 0.28,
  discovery: 0.68
};

const TERRAIN_COLORS = {
  sand: { fill: "#aa7a41", edge: "#f1c675", accent: "#ffe4a6" },
  vine: { fill: "#547a59", edge: "#b8dc84", accent: "#e6f5a5" },
  crystal: { fill: "#6174a8", edge: "#b9d5ff", accent: "#e5f5ff" }
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function eased(value) {
  return 1 - Math.exp(-value);
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export class ExpeditionRenderer {
  constructor(canvas, { onExcavate = () => {}, onFocusTile = () => {}, onStage = () => {} } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.onExcavate = onExcavate;
    this.onFocusTile = onFocusTile;
    this.onStage = onStage;
    this.state = null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.tileSize = 48;
    this.camera = { x: (EXPEDITION_WIDTH - 1) / 2, y: (EXPEDITION_HEIGHT - 1) / 2, vx: 0, vy: 0 };
    this.keyboardTile = { x: 1, y: 0 };
    this.pointer = null;
    this.hoverTile = null;
    this.particles = [];
    this.excavation = null;
    this.shake = { x: 0, y: 0, energy: 0 };
    this.running = false;
    this.frameHandle = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);

    canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    canvas.addEventListener("pointercancel", (event) => this.releasePointer(event));
    canvas.addEventListener("pointerleave", () => {
      if (!this.pointer) this.hoverTile = null;
    });
    canvas.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.resize();
  }

  setState(state) {
    this.state = state;
    if (!isInBounds(state, this.keyboardTile.x, this.keyboardTile.y)) this.keyboardTile = { x: 0, y: 0 };
    this.constrainCamera();
    this.render();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame((time) => this.frame(time));
  }

  stop() {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.finishExcavation();
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(this.width * this.dpr);
    const pixelHeight = Math.round(this.height * this.dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const columns = this.state?.width ?? EXPEDITION_WIDTH;
    const rows = this.state?.height ?? EXPEDITION_HEIGHT;
    this.tileSize = Math.min(76, Math.max(42, Math.min(this.width / Math.max(1, columns - 0.45), this.height / Math.max(1, rows - 0.45))));
    this.constrainCamera();
    this.render();
  }

  frame(now) {
    if (!this.running) return;
    const elapsed = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.accumulator += elapsed;
    while (this.accumulator >= FIXED_STEP_SECONDS) {
      this.update(FIXED_STEP_SECONDS);
      this.accumulator -= FIXED_STEP_SECONDS;
    }
    this.render();
    this.frameHandle = requestAnimationFrame((time) => this.frame(time));
  }

  update(delta) {
    if (!this.pointer) {
      const damping = Math.exp(-7 * delta);
      this.camera.x += this.camera.vx * delta;
      this.camera.y += this.camera.vy * delta;
      this.camera.vx *= damping;
      this.camera.vy *= damping;
      if (Math.abs(this.camera.vx) < 0.008) this.camera.vx = 0;
      if (Math.abs(this.camera.vy) < 0.008) this.camera.vy = 0;
      this.constrainCamera();
    }

    for (const particle of this.particles) {
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += 0.46 * delta;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    this.updateExcavation(delta);
    this.updateShake(delta);
  }

  updateShake(delta) {
    if (this.reducedMotion || this.shake.energy <= 0) {
      this.shake.x = 0;
      this.shake.y = 0;
      this.shake.energy = 0;
      return;
    }
    this.shake.energy = Math.max(0, this.shake.energy - delta * 8);
    this.shake.x = (Math.random() * 2 - 1) * this.shake.energy;
    this.shake.y = (Math.random() * 2 - 1) * this.shake.energy * 0.62;
  }

  timelineFor(event) {
    const multiplier = this.reducedMotion ? 0.52 : 1;
    const timeline = {
      aim: EXCAVATION_TIMELINE.aim * multiplier,
      impact: EXCAVATION_TIMELINE.impact * multiplier,
      reveal: EXCAVATION_TIMELINE.reveal * multiplier,
      settle: EXCAVATION_TIMELINE.settle * multiplier,
      discovery: event.type === "discovery" ? EXCAVATION_TIMELINE.discovery * multiplier : 0
    };
    timeline.total = timeline.aim + timeline.impact + timeline.reveal + timeline.settle + timeline.discovery;
    return timeline;
  }

  emitExcavationStage(stage) {
    if (!this.excavation || this.excavation.stage === stage) return;
    this.excavation.stage = stage;
    this.onStage({ stage, tile: this.excavation.tile, event: this.excavation.event });
  }

  updateExcavation(delta) {
    const animation = this.excavation;
    if (!animation) return;
    animation.elapsed += delta;
    const { timeline, event, tile } = animation;
    const impactAt = timeline.aim;
    const revealAt = impactAt + timeline.impact;
    const discoveryAt = revealAt + timeline.reveal;

    if (animation.elapsed < impactAt) {
      this.emitExcavationStage("aim");
    } else if (animation.elapsed < revealAt) {
      this.emitExcavationStage("impact");
      if (!animation.impactBurst) {
        animation.impactBurst = true;
        this.shake.energy = this.reducedMotion ? 0 : 3.2;
        this.spawnBurst(tile, event.terrain, 13, "dust");
      }
    } else if (animation.elapsed < discoveryAt) {
      this.emitExcavationStage("reveal");
      if (!animation.revealBurst) {
        animation.revealBurst = true;
        this.spawnBurst(tile, event.terrain, event.type === "discovery" ? 12 : 7, "shard");
      }
    } else if (event.type === "discovery" && animation.elapsed < timeline.total - timeline.settle) {
      this.emitExcavationStage("discovery");
      if (!animation.discoveryBurst) {
        animation.discoveryBurst = true;
        this.shake.energy = this.reducedMotion ? 0 : 1.6;
        this.spawnBurst(tile, event.terrain, 18, "star");
      }
    } else {
      this.emitExcavationStage("settle");
    }

    if (animation.elapsed >= timeline.total) {
      this.finishExcavation();
    }
  }

  finishExcavation() {
    const animation = this.excavation;
    if (!animation) return;
    this.emitExcavationStage("settle");
    this.excavation = null;
    this.shake = { x: 0, y: 0, energy: 0 };
    animation.resolve?.();
  }

  spawnBurst(tile, terrain, count, shape) {
    const terrainColors = TERRAIN_COLORS[terrain?.id] ?? TERRAIN_COLORS.sand;
    const colors = shape === "star"
      ? ["#fff9c8", "#ffd66f", "#8ff2e3"]
      : [terrainColors.accent, terrainColors.edge, terrainColors.fill];
    const maximum = this.reducedMotion ? 0 : Math.min(count, MAX_PARTICLES - this.particles.length);
    for (let index = 0; index < maximum; index += 1) {
      const angle = (Math.PI * 2 * index) / Math.max(1, maximum) + Math.random() * 0.28;
      const speed = shape === "star" ? 1.35 + Math.random() * 1.5 : 0.66 + Math.random() * 1.18;
      this.particles.push({
        x: tile.x + (Math.random() - 0.5) * 0.14,
        y: tile.y + (Math.random() - 0.5) * 0.14,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (shape === "star" ? 0.72 : 0.32),
        life: shape === "star" ? 0.72 + Math.random() * 0.38 : 0.38 + Math.random() * 0.34,
        maxLife: shape === "star" ? 1.1 : 0.72,
        size: shape === "star" ? 2.8 + Math.random() * 2.4 : 2 + Math.random() * 2.1,
        color: colors[index % colors.length],
        shape
      });
    }
  }

  viewBounds() {
    const halfWidth = this.width / this.tileSize / 2;
    const halfHeight = this.height / this.tileSize / 2;
    return { halfWidth, halfHeight };
  }

  constrainCamera() {
    if (!this.state) return;
    const { halfWidth, halfHeight } = this.viewBounds();
    const maxX = Math.max(halfWidth, this.state.width - halfWidth);
    const maxY = Math.max(halfHeight, this.state.height - halfHeight);
    const minX = Math.min(halfWidth, this.state.width - halfWidth);
    const minY = Math.min(halfHeight, this.state.height - halfHeight);
    const targetX = clamp(this.camera.x, minX - 0.35, maxX + 0.35);
    const targetY = clamp(this.camera.y, minY - 0.35, maxY + 0.35);
    this.camera.x += (targetX - this.camera.x) * (this.pointer ? 0.32 : eased(15 / 60));
    this.camera.y += (targetY - this.camera.y) * (this.pointer ? 0.32 : eased(15 / 60));
  }

  screenToTile(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.width / 2) / this.tileSize + this.camera.x;
    const y = (clientY - rect.top - this.height / 2) / this.tileSize + this.camera.y;
    return { x: Math.floor(x + 0.5), y: Math.floor(y + 0.5) };
  }

  tileToScreen(x, y) {
    return {
      x: this.width / 2 + (x - this.camera.x) * this.tileSize,
      y: this.height / 2 + (y - this.camera.y) * this.tileSize
    };
  }

  handlePointerDown(event) {
    if (!this.state || this.excavation || event.button > 0) return;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      startCameraX: this.camera.x,
      startCameraY: this.camera.y,
      moved: false
    };
    this.camera.vx = 0;
    this.camera.vy = 0;
    event.preventDefault();
  }

  handlePointerMove(event) {
    const tile = this.screenToTile(event.clientX, event.clientY);
    this.hoverTile = isInBounds(this.state, tile.x, tile.y) ? tile : null;
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    const deltaX = event.clientX - this.pointer.startX;
    const deltaY = event.clientY - this.pointer.startY;
    if (Math.hypot(deltaX, deltaY) > TAP_DISTANCE_PX) this.pointer.moved = true;
    if (this.pointer.moved) {
      this.camera.x = this.pointer.startCameraX - deltaX / this.tileSize;
      this.camera.y = this.pointer.startCameraY - deltaY / this.tileSize;
      const now = performance.now();
      const elapsed = Math.max(0.016, (now - this.pointer.lastTime) / 1000);
      this.camera.vx = -(event.clientX - this.pointer.lastX) / this.tileSize / elapsed;
      this.camera.vy = -(event.clientY - this.pointer.lastY) / this.tileSize / elapsed;
      this.pointer.lastX = event.clientX;
      this.pointer.lastY = event.clientY;
      this.pointer.lastTime = now;
      this.constrainCamera();
    }
    event.preventDefault();
  }

  handlePointerUp(event) {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    const wasTap = !this.pointer.moved;
    if (wasTap) {
      const tile = this.screenToTile(event.clientX, event.clientY);
      this.setKeyboardTile(tile.x, tile.y);
      if (isInBounds(this.state, tile.x, tile.y)) this.onExcavate(tile);
    }
    this.releasePointer(event);
    event.preventDefault();
  }

  releasePointer(event) {
    if (this.pointer?.id !== event.pointerId) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.pointer = null;
  }

  setKeyboardTile(x, y) {
    if (!this.state) return;
    this.keyboardTile = {
      x: clamp(x, 0, this.state.width - 1),
      y: clamp(y, 0, this.state.height - 1)
    };
    this.onFocusTile(this.keyboardTile);
  }

  handleKeydown(event) {
    if (!this.state || this.excavation) return;
    const steps = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0]
    };
    if (steps[event.key]) {
      const [x, y] = steps[event.key];
      this.setKeyboardTile(this.keyboardTile.x + x, this.keyboardTile.y + y);
      this.camera.vx = 0;
      this.camera.vy = 0;
      this.camera.x += (this.keyboardTile.x - this.camera.x) * 0.45;
      this.camera.y += (this.keyboardTile.y - this.camera.y) * 0.45;
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      this.onExcavate(this.keyboardTile);
      event.preventDefault();
    }
  }

  playExcavation(tile, event) {
    if (this.excavation) return Promise.resolve();
    const timeline = this.timelineFor(event);
    return new Promise((resolve) => {
      this.excavation = {
        tile,
        event,
        timeline,
        elapsed: 0,
        stage: null,
        impactBurst: false,
        revealBurst: false,
        discoveryBurst: false,
        resolve
      };
      this.emitExcavationStage("aim");
      this.render();
      if (!this.running) {
        window.setTimeout(() => {
          if (this.excavation?.resolve === resolve) {
            this.finishExcavation();
            this.render();
          }
        }, Math.ceil(timeline.total * 1000));
      }
    });
  }

  render() {
    const context = this.context;
    if (!context) return;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const background = context.createLinearGradient(0, 0, this.width, this.height);
    background.addColorStop(0, "#172c4f");
    background.addColorStop(0.58, "#263e67");
    background.addColorStop(1, "#111e3a");
    context.fillStyle = background;
    context.fillRect(0, 0, this.width, this.height);
    this.drawAtmosphere(context);
    if (!this.state) return;
    this.drawMap(context);
    this.drawParticles(context);
  }

  drawAtmosphere(context) {
    context.save();
    context.globalAlpha = 0.18;
    for (let index = 0; index < 18; index += 1) {
      const x = ((index * 173) % (this.width + 120)) - 60;
      const y = ((index * 97) % (this.height + 80)) - 40;
      const radius = 12 + (index % 4) * 7;
      const glow = context.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, "#d9ebff");
      glow.addColorStop(1, "rgba(217,235,255,0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  drawMap(context) {
    const padding = this.tileSize * 0.06;
    context.save();
    context.translate(this.shake.x, this.shake.y);
    for (let y = 0; y < this.state.height; y += 1) {
      for (let x = 0; x < this.state.width; x += 1) {
        const screen = this.tileToScreen(x, y);
        if (screen.x < -this.tileSize || screen.y < -this.tileSize || screen.x > this.width + this.tileSize || screen.y > this.height + this.tileSize) continue;
        const left = screen.x - this.tileSize / 2 + padding;
        const top = screen.y - this.tileSize / 2 + padding;
        const size = this.tileSize - padding * 2;
        const revealed = isRevealed(this.state, x, y);
        const selectable = !revealed && this.isSelectable(x, y);
        this.drawTile(context, x, y, left, top, size, revealed, selectable);
      }
    }
    context.restore();
  }

  isSelectable(x, y) {
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nextX, nextY]) => isInBounds(this.state, nextX, nextY) && isRevealed(this.state, nextX, nextY));
  }

  drawTile(context, x, y, left, top, size, revealed, selectable) {
    const isKeyboardTile = this.keyboardTile.x === x && this.keyboardTile.y === y;
    const isHoverTile = this.hoverTile?.x === x && this.hoverTile?.y === y;
    const radius = Math.max(8, size * 0.18);
    context.save();
    context.shadowColor = "rgba(2, 7, 19, 0.4)";
    context.shadowBlur = 8;
    context.shadowOffsetY = 4;
    drawRoundedRect(context, left, top, size, size, radius);
    context.fillStyle = revealed ? "#3c624c" : "#27375c";
    context.fill();
    context.restore();

    if (revealed) {
      const terrain = terrainAt(this.state, x, y);
      const colors = TERRAIN_COLORS[terrain.id];
      const fill = context.createLinearGradient(left, top, left + size, top + size);
      fill.addColorStop(0, colors.accent);
      fill.addColorStop(0.23, colors.fill);
      fill.addColorStop(1, "#263d50");
      drawRoundedRect(context, left, top, size, size, radius);
      context.fillStyle = fill;
      context.fill();
      context.strokeStyle = colors.edge;
      context.lineWidth = 1.25;
      context.stroke();
      this.drawTerrainDetails(context, terrain.id, left, top, size, colors);
      const target = targetAt(this.state, x, y);
      const animation = this.activeExcavationAt(x, y);
      if (target && this.state.foundTargetIds.includes(target.id)) {
        this.drawRelic(context, target, left + size / 2, top + size / 2, size, this.relicRevealProgress(animation));
      }
    } else {
      const fog = context.createLinearGradient(left, top, left + size, top + size);
      fog.addColorStop(0, "#5f69a0");
      fog.addColorStop(0.52, "#34446f");
      fog.addColorStop(1, "#1e2b50");
      drawRoundedRect(context, left, top, size, size, radius);
      context.fillStyle = fog;
      context.fill();
      context.strokeStyle = selectable ? "rgba(206, 245, 187, 0.76)" : "rgba(180, 203, 255, 0.24)";
      context.lineWidth = selectable ? 2 : 1;
      context.stroke();
      context.fillStyle = "rgba(220, 235, 255, 0.46)";
      context.font = `${Math.max(13, size * 0.37)}px Georgia, serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(selectable ? "✦" : "·", left + size / 2, top + size / 2 + 1);
    }

    if (isKeyboardTile || isHoverTile) {
      drawRoundedRect(context, left - 2, top - 2, size + 4, size + 4, radius + 2);
      context.strokeStyle = isKeyboardTile ? "#fff0a2" : "#c9f6cd";
      context.lineWidth = isKeyboardTile ? 2.6 : 1.7;
      context.stroke();
    }

    const animation = this.activeExcavationAt(x, y);
    if (animation) this.drawExcavationOverlay(context, animation, left, top, size, radius);
  }

  activeExcavationAt(x, y) {
    const animation = this.excavation;
    if (!animation || animation.tile.x !== x || animation.tile.y !== y) return null;
    return animation;
  }

  revealProgress(animation) {
    if (!animation) return 1;
    const { timeline } = animation;
    const revealStart = timeline.aim + timeline.impact;
    return clamp((animation.elapsed - revealStart) / Math.max(0.001, timeline.reveal), 0, 1);
  }

  relicRevealProgress(animation) {
    if (!animation) return 1;
    const reveal = this.revealProgress(animation);
    if (animation.event.type !== "discovery") return 1;
    const discoveryStart = animation.timeline.aim + animation.timeline.impact + animation.timeline.reveal * 0.58;
    return reveal * clamp((animation.elapsed - discoveryStart) / Math.max(0.001, animation.timeline.discovery * 0.48), 0, 1);
  }

  drawExcavationOverlay(context, animation, left, top, size, radius) {
    const reveal = this.revealProgress(animation);
    const centerX = left + size / 2;
    const centerY = top + size / 2;
    const { timeline, elapsed, event } = animation;
    const impactStart = timeline.aim;
    const revealStart = impactStart + timeline.impact;
    const discoveryStart = revealStart + timeline.reveal;

    if (reveal < 1) {
      context.save();
      context.globalAlpha = 1 - reveal;
      const cover = context.createLinearGradient(left, top, left + size, top + size);
      cover.addColorStop(0, "#6071a5");
      cover.addColorStop(0.55, "#2e416a");
      cover.addColorStop(1, "#17294e");
      drawRoundedRect(context, left, top, size, size, radius);
      context.fillStyle = cover;
      context.fill();
      context.strokeStyle = "rgba(221, 234, 255, 0.48)";
      context.lineWidth = 1.4;
      context.stroke();
      context.restore();
    }

    const aimProgress = clamp(elapsed / Math.max(0.001, timeline.aim), 0, 1);
    if (elapsed < revealStart) {
      this.drawTargetRing(context, centerX, centerY, size, aimProgress, elapsed >= impactStart);
      this.drawSpade(context, centerX, centerY, size, aimProgress, elapsed >= impactStart);
    }

    if (elapsed >= impactStart && elapsed < revealStart + timeline.reveal * 0.65) {
      const crackProgress = clamp((elapsed - impactStart) / Math.max(0.001, timeline.impact + timeline.reveal * 0.65), 0, 1);
      context.save();
      context.globalAlpha = 0.7 * (1 - reveal * 0.5);
      context.strokeStyle = "#fff0af";
      context.lineWidth = Math.max(1.1, size * 0.038);
      context.beginPath();
      context.moveTo(centerX - size * 0.29, centerY - size * 0.08);
      context.lineTo(centerX - size * 0.06, centerY + size * 0.02);
      context.lineTo(centerX + size * (0.06 + 0.1 * crackProgress), centerY - size * 0.13);
      context.lineTo(centerX + size * 0.27, centerY + size * 0.16);
      context.stroke();
      context.restore();
    }

    if (event.type === "discovery" && elapsed >= discoveryStart - timeline.reveal * 0.2) {
      const discoveryProgress = clamp((elapsed - (discoveryStart - timeline.reveal * 0.2)) / Math.max(0.001, timeline.discovery), 0, 1);
      this.drawDiscoveryAura(context, centerX, centerY, size, discoveryProgress);
    } else if (reveal > 0.16) {
      const shimmer = 0.18 + Math.sin(elapsed * 28) * 0.08;
      context.save();
      context.globalAlpha = shimmer * reveal;
      context.fillStyle = "#fff8c4";
      context.beginPath();
      context.arc(centerX, centerY, size * (0.24 + reveal * 0.16), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  drawTargetRing(context, x, y, size, progress, impacted) {
    const pulse = 1 + Math.sin(progress * Math.PI * 2) * 0.08;
    context.save();
    context.globalAlpha = impacted ? 0.42 : 0.78;
    context.strokeStyle = impacted ? "#ffe8a0" : "#c8f7cf";
    context.lineWidth = Math.max(1.3, size * 0.034);
    context.beginPath();
    context.arc(x, y, size * (0.28 + progress * 0.1) * pulse, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  drawSpade(context, x, y, size, progress, impacted) {
    const fall = impacted ? 1 : progress;
    const bounce = impacted ? Math.sin(clamp((progress - 0.82) / 0.18, 0, 1) * Math.PI) * size * 0.07 : 0;
    const offsetY = size * (-0.86 + fall * 0.72) - bounce;
    context.save();
    context.translate(x, y + offsetY);
    context.rotate(-0.54 + fall * 0.2);
    context.lineCap = "round";
    context.strokeStyle = "#855339";
    context.lineWidth = Math.max(3, size * 0.085);
    context.beginPath();
    context.moveTo(0, -size * 0.36);
    context.lineTo(0, size * 0.11);
    context.stroke();
    context.strokeStyle = "#e8c78d";
    context.lineWidth = Math.max(1.4, size * 0.032);
    context.beginPath();
    context.moveTo(0, -size * 0.37);
    context.lineTo(0, size * 0.1);
    context.stroke();
    context.fillStyle = "#d7e3ef";
    context.strokeStyle = "#6f8ca6";
    context.lineWidth = Math.max(1.2, size * 0.025);
    context.beginPath();
    context.moveTo(-size * 0.16, size * 0.08);
    context.quadraticCurveTo(0, size * 0.35, size * 0.16, size * 0.08);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  drawDiscoveryAura(context, x, y, size, progress) {
    const radius = size * (0.24 + progress * 0.58);
    context.save();
    context.globalAlpha = (1 - progress) * 0.58;
    context.strokeStyle = "#fff0a5";
    context.lineWidth = Math.max(1.2, size * 0.032);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 0.15 + Math.sin(progress * Math.PI) * 0.2;
    context.fillStyle = "#fff6b8";
    context.beginPath();
    context.arc(x, y, size * (0.2 + progress * 0.22), 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  drawTerrainDetails(context, terrainId, left, top, size, colors) {
    context.save();
    context.globalAlpha = 0.25;
    context.fillStyle = colors.accent;
    if (terrainId === "vine") {
      context.strokeStyle = colors.accent;
      context.lineWidth = Math.max(1.4, size * 0.05);
      context.beginPath();
      context.moveTo(left + size * 0.2, top + size * 0.76);
      context.quadraticCurveTo(left + size * 0.48, top + size * 0.2, left + size * 0.8, top + size * 0.36);
      context.stroke();
      context.fillStyle = "rgba(232, 255, 180, 0.54)";
      context.beginPath();
      context.arc(left + size * 0.42, top + size * 0.42, size * 0.09, 0, Math.PI * 2);
      context.arc(left + size * 0.64, top + size * 0.45, size * 0.08, 0, Math.PI * 2);
      context.fill();
    } else if (terrainId === "crystal") {
      context.beginPath();
      context.moveTo(left + size * 0.26, top + size * 0.76);
      context.lineTo(left + size * 0.43, top + size * 0.23);
      context.lineTo(left + size * 0.57, top + size * 0.76);
      context.moveTo(left + size * 0.53, top + size * 0.8);
      context.lineTo(left + size * 0.71, top + size * 0.35);
      context.lineTo(left + size * 0.82, top + size * 0.79);
      context.fill();
    } else {
      for (let dot = 0; dot < 5; dot += 1) {
        context.beginPath();
        context.arc(left + size * (0.18 + ((dot * 0.19) % 0.67)), top + size * (0.28 + ((dot * 0.27) % 0.5)), Math.max(1, size * 0.035), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  drawRelic(context, target, x, y, size, reveal = 1) {
    if (reveal <= 0) return;
    const radius = size * 0.22;
    const spring = 1 + Math.sin(clamp(reveal, 0, 1) * Math.PI) * 0.22;
    context.save();
    context.globalAlpha = clamp(reveal * 1.7, 0, 1);
    context.translate(x, y + (1 - reveal) * size * 0.48);
    context.scale(reveal * spring, reveal * spring);
    context.shadowColor = "rgba(255, 219, 104, 0.86)";
    context.shadowBlur = size * 0.28;
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius * 1.75);
    glow.addColorStop(0, "#fff7ba");
    glow.addColorStop(0.44, "#f7bf4c");
    glow.addColorStop(1, "rgba(247,191,76,0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, radius * 1.75, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "#fff6bc";
    context.font = `bold ${Math.max(14, size * 0.42)}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(target.icon, 0, 1);
    context.restore();
  }

  drawParticles(context) {
    for (const particle of this.particles) {
      const screen = this.tileToScreen(particle.x, particle.y);
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      context.save();
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = 10;
      if (particle.shape === "star") {
        context.translate(screen.x, screen.y);
        context.rotate((1 - alpha) * Math.PI);
        context.beginPath();
        context.moveTo(0, -particle.size * 1.8);
        context.lineTo(particle.size * 0.55, -particle.size * 0.55);
        context.lineTo(particle.size * 1.8, 0);
        context.lineTo(particle.size * 0.55, particle.size * 0.55);
        context.lineTo(0, particle.size * 1.8);
        context.lineTo(-particle.size * 0.55, particle.size * 0.55);
        context.lineTo(-particle.size * 1.8, 0);
        context.lineTo(-particle.size * 0.55, -particle.size * 0.55);
        context.closePath();
        context.fill();
      } else if (particle.shape === "shard") {
        context.translate(screen.x, screen.y);
        context.rotate((1 - alpha) * 4);
        context.beginPath();
        context.moveTo(0, -particle.size * 1.3);
        context.lineTo(particle.size, particle.size);
        context.lineTo(-particle.size, particle.size * 0.72);
        context.closePath();
        context.fill();
      } else {
        context.beginPath();
        context.arc(screen.x, screen.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }
  }
}
