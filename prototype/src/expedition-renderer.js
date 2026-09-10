import {
  EXPEDITION_HEIGHT,
  EXPEDITION_WIDTH,
  canEnterDoor,
  doorAt,
  isInBounds,
  isRevealed,
  keyAt,
  targetAt,
  terrainAt,
  visibilityAt
} from "./expedition-engine.js";

const MAX_PARTICLES = 40;
const TAP_DISTANCE_PX = 8;
const FIXED_STEP_SECONDS = 1 / 60;
const DIG_BEACON_HIT_RADIUS = 0.38;
const WALKABLE_RADIUS = 0.82;
const EXCAVATION_TIMELINE = {
  walk: 0.42,
  aim: 0.22,
  impact: 0.18,
  reveal: 0.36,
  reward: 0.56,
  settle: 0.28,
  discovery: 0.68
};

const TERRAIN_COLORS = {
  sand: { fill: "#b98448", edge: "#f5d486", accent: "#ffe7ab" },
  vine: { fill: "#4f805d", edge: "#b9de83", accent: "#e6f5a5" },
  crystal: { fill: "#596fa4", edge: "#c5d9ff", accent: "#e5f5ff" }
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
  constructor(canvas, { onExcavate = () => {}, onEnterDoor = () => {}, onFocusTile = () => {}, onStage = () => {}, onMove = () => {} } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.onExcavate = onExcavate;
    this.onEnterDoor = onEnterDoor;
    this.onFocusTile = onFocusTile;
    this.onStage = onStage;
    this.onMove = onMove;
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
    this.doorTransition = null;
    this.minerTile = { x: 0, y: 0 };
    this.movement = null;
    this.pendingMove = null;
    this.minerFacing = 1;
    this.lastFootstep = 0;
    this.reaction = null;
    this.queuedTile = null;
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
    const isFirstState = !this.state;
    const mapChanged = this.state?.activeMapId && this.state.activeMapId !== state.activeMapId;
    this.state = state;
    if (isFirstState || mapChanged) {
      // Deliberately show the landing camp first. The island is larger than a
      // phone viewport, so the player discovers it by travelling instead of
      // seeing a complete square board at once.
      this.resize();
      const { halfWidth, halfHeight } = this.viewBounds();
      // Let the player see both the camp and the first lit excavation mark.
      // The small overscan is intentional: it frames the shoreline instead of
      // placing the landing point exactly on the screen edge.
      this.camera.x = Math.min(Math.max(0, halfWidth - 0.7), this.state.width - halfWidth);
      this.camera.y = Math.min(Math.max(0, halfHeight - 0.7), this.state.height - halfHeight);
      this.camera.vx = 0;
      this.camera.vy = 0;
      this.minerTile = { x: 0, y: 0 };
      this.movement = null;
      this.pendingMove = null;
      this.keyboardTile = { x: 1, y: 0 };
    }
    if (!isInBounds(state, this.keyboardTile.x, this.keyboardTile.y)) this.keyboardTile = { x: 0, y: 0 };
    this.constrainCamera();
    this.render();
  }

  setQueuedTile(tile) {
    this.queuedTile = tile && this.state && isInBounds(this.state, tile.x, tile.y)
      ? { x: tile.x, y: tile.y }
      : null;
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
    // Keep the world larger than the viewport. Logical locations are still
    // deterministic for saving and input, but a phone should feel like it is
    // looking over a real island, not at all 64 locations as a board.
    // The island must occupy the whole viewport.  A small tile cap exposed a
    // large, empty ocean margin on wide screens and made the exploration feel
    // like a board embedded in a webpage.  Size the terrain to cover the
    // camera instead; the player can still pan around its fixed-scale world.
    const landscapeScale = Math.max(this.width / 8.5, this.height / 8.4);
    this.tileSize = Math.min(138, Math.max(72, landscapeScale));
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
    if (this.reaction) {
      this.reaction.elapsed += delta;
      if (this.reaction.elapsed >= this.reaction.duration) this.reaction = null;
    }
    this.updateMovement(delta);
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
      walk: EXCAVATION_TIMELINE.walk * multiplier,
      aim: EXCAVATION_TIMELINE.aim * multiplier,
      impact: EXCAVATION_TIMELINE.impact * multiplier,
      reveal: EXCAVATION_TIMELINE.reveal * multiplier,
      reward: EXCAVATION_TIMELINE.reward * multiplier,
      settle: EXCAVATION_TIMELINE.settle * multiplier,
      discovery: ["discovery", "key"].includes(event.type) ? EXCAVATION_TIMELINE.discovery * multiplier : 0
    };
    timeline.total = timeline.walk + timeline.aim + timeline.impact + timeline.reveal + timeline.discovery + timeline.reward + timeline.settle;
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
    const walkAt = timeline.walk;
    const impactAt = walkAt + timeline.aim;
    const revealAt = impactAt + timeline.impact;
    const discoveryAt = revealAt + timeline.reveal;
    const rewardAt = discoveryAt + timeline.discovery;

    if (animation.elapsed < walkAt) {
      this.emitExcavationStage("walk");
    } else if (animation.elapsed < impactAt) {
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
        this.spawnBurst(tile, event.terrain, ["discovery", "key"].includes(event.type) ? 12 : 7, "shard");
      }
    } else if (["discovery", "key"].includes(event.type) && animation.elapsed < rewardAt) {
      this.emitExcavationStage(event.type);
      if (!animation.discoveryBurst) {
        animation.discoveryBurst = true;
        this.shake.energy = this.reducedMotion ? 0 : 1.6;
        this.spawnBurst(tile, event.terrain, 18, "star");
      }
    } else if (animation.elapsed < rewardAt + timeline.reward) {
      this.emitExcavationStage("reward");
      if (!animation.rewardBurst) {
        animation.rewardBurst = true;
        this.spawnBurst(tile, event.terrain, ["discovery", "key"].includes(event.type) ? 16 : 9, "star");
      }
    } else {
      this.emitExcavationStage("settle");
    }

    if (animation.elapsed >= timeline.total) {
      this.finishExcavation();
    }
  }

  updateMovement(delta) {
    if (!this.movement || this.excavation) return;
    const movement = this.movement;
    movement.elapsed += delta;
    const progress = clamp(movement.elapsed / movement.duration, 0, 1);
    const position = this.currentMinerPosition();
    if (!this.reducedMotion && movement.elapsed - this.lastFootstep >= 0.18 && progress < 0.94) {
      this.lastFootstep = movement.elapsed;
      this.spawnBurst(position, terrainAt(this.state, Math.round(position.x), Math.round(position.y)), 2, "dust");
    }
    if (progress < 1) return;
    this.minerTile = { ...movement.destination };
    this.movement = null;
    this.onMove({ stage: "arrive", destination: { ...this.minerTile } });
  }

  finishExcavation() {
    const animation = this.excavation;
    if (!animation) return;
    this.emitExcavationStage("settle");
    this.minerTile = { ...animation.tile };
    this.excavation = null;
    this.shake = { x: 0, y: 0, energy: 0 };
    const destination = this.pendingMove;
    this.pendingMove = null;
    animation.resolve?.();
    if (destination) queueMicrotask(() => {
      if (!this.excavation && !this.movement) this.startMovement(destination);
    });
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
    const shorelineOverscan = 0.92;
    const targetX = clamp(this.camera.x, minX - shorelineOverscan, maxX + shorelineOverscan);
    const targetY = clamp(this.camera.y, minY - shorelineOverscan, maxY + shorelineOverscan);
    this.camera.x += (targetX - this.camera.x) * (this.pointer ? 0.32 : eased(15 / 60));
    this.camera.y += (targetY - this.camera.y) * (this.pointer ? 0.32 : eased(15 / 60));
  }

  screenToTile(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (!this.state) return { x: -1, y: -1 };

    // Visual positions deliberately drift a little from the saved lattice, so
    // a line of excavations reads as a hand-made trail instead of graph paper.
    // Pick the nearest named dig site rather than assuming a square transform.
    let closest = { x: -1, y: -1, distance: Infinity };
    for (let tileY = 0; tileY < this.state.height; tileY += 1) {
      for (let tileX = 0; tileX < this.state.width; tileX += 1) {
        const screen = this.tileToScreen(tileX, tileY);
        const distance = Math.hypot(screen.x - x, screen.y - y);
        if (distance < closest.distance) closest = { x: tileX, y: tileY, distance };
      }
    }
    return closest.distance <= this.tileSize * 0.68 ? closest : { x: -1, y: -1 };
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.camera.x + (clientX - rect.left - this.width / 2) / this.tileSize,
      y: this.camera.y + (clientY - rect.top - this.height / 2) / this.tileSize
    };
  }

  nearestTile(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let closest = { x: -1, y: -1, distance: Infinity };
    for (let tileY = 0; tileY < this.state.height; tileY += 1) {
      for (let tileX = 0; tileX < this.state.width; tileX += 1) {
        const screen = this.tileToScreen(tileX, tileY);
        const distance = Math.hypot(screen.x - x, screen.y - y);
        if (distance < closest.distance) closest = { x: tileX, y: tileY, distance };
      }
    }
    return closest;
  }

  walkableDestination(world) {
    const bounded = {
      x: clamp(world.x, 0, this.state.width - 1),
      y: clamp(world.y, 0, this.state.height - 1)
    };
    let nearest = null;
    for (let y = 0; y < this.state.height; y += 1) {
      for (let x = 0; x < this.state.width; x += 1) {
        if (!isRevealed(this.state, x, y)) continue;
        const distance = Math.hypot(bounded.x - x, bounded.y - y);
        if (!nearest || distance < nearest.distance) nearest = { x, y, distance };
      }
    }
    if (!nearest) return { x: 0, y: 0 };
    if (nearest.distance <= WALKABLE_RADIUS) return bounded;
    return { x: nearest.x, y: nearest.y };
  }

  currentMinerPosition() {
    if (this.doorTransition) {
      const { origin, tile, startedAt, duration } = this.doorTransition;
      const travel = clamp((performance.now() - startedAt) / Math.max(1, duration), 0, 1);
      const progress = travel * travel * (3 - 2 * travel);
      return {
        x: origin.x + (tile.x - origin.x) * progress,
        y: origin.y + (tile.y - origin.y) * progress
      };
    }
    if (this.excavation) {
      const { origin, tile, elapsed, timeline } = this.excavation;
      const travel = clamp(elapsed / Math.max(0.001, timeline.walk), 0, 1);
      const progress = travel * travel * (3 - 2 * travel);
      return {
        x: origin.x + (tile.x - origin.x) * progress,
        y: origin.y + (tile.y - origin.y) * progress
      };
    }
    if (this.movement) {
      const progress = clamp(this.movement.elapsed / this.movement.duration, 0, 1);
      const easedProgress = progress * progress * (3 - 2 * progress);
      return {
        x: this.movement.origin.x + (this.movement.destination.x - this.movement.origin.x) * easedProgress,
        y: this.movement.origin.y + (this.movement.destination.y - this.movement.origin.y) * easedProgress
      };
    }
    return { ...this.minerTile };
  }

  startMovement(destination) {
    const origin = this.currentMinerPosition();
    const distance = Math.hypot(destination.x - origin.x, destination.y - origin.y);
    if (distance < 0.06) {
      this.minerTile = { ...destination };
      return;
    }
    if (Math.abs(destination.x - origin.x) > 0.04) this.minerFacing = destination.x >= origin.x ? 1 : -1;
    this.movement = {
      origin,
      destination: { ...destination },
      elapsed: 0,
      duration: this.reducedMotion ? 0.16 : clamp(distance * 0.19, 0.24, 1.25)
    };
    this.reaction = null;
    this.lastFootstep = -0.18;
    this.onMove({ stage: "walk", destination: { ...destination } });
  }

  requestMovement(destination) {
    const walkable = this.walkableDestination(destination);
    if (this.excavation) {
      this.pendingMove = walkable;
      this.onMove({ stage: "queued", destination: { ...walkable } });
      return;
    }
    this.pendingMove = null;
    this.startMovement(walkable);
  }

  playReaction(type = "blocked") {
    if (this.excavation) return;
    this.reaction = {
      type: type === "focus" ? "tired" : "blocked",
      elapsed: 0,
      duration: this.reducedMotion ? 0.35 : 0.8
    };
  }

  tileToScreen(x, y) {
    const drift = this.visualDrift(x, y);
    return {
      x: this.width / 2 + (x + drift.x - this.camera.x) * this.tileSize,
      y: this.height / 2 + (y + drift.y - this.camera.y) * this.tileSize
    };
  }

  visualDrift(x, y) {
    return {
      x: Math.sin(x * 1.91 + y * 0.73) * 0.075 + Math.cos(x * 0.57 - y * 1.41) * 0.04,
      y: Math.cos(x * 1.27 - y * 0.61) * 0.07 + Math.sin(x * 0.49 + y * 1.77) * 0.035
    };
  }

  handlePointerDown(event) {
    if (!this.state || event.button > 0) return;
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
      const tile = this.nearestTile(event.clientX, event.clientY);
      const door = isInBounds(this.state, tile.x, tile.y) ? doorAt(this.state, tile.x, tile.y) : null;
      const isDoorIntent = door
        && visibilityAt(this.state, tile.x, tile.y) !== "dark"
        && tile.distance <= this.tileSize * 0.55;
      const isDigIntent = isInBounds(this.state, tile.x, tile.y)
        && !isRevealed(this.state, tile.x, tile.y)
        && this.isSelectable(tile.x, tile.y)
        && tile.distance <= this.tileSize * DIG_BEACON_HIT_RADIUS;
      if (isDoorIntent) {
        this.setKeyboardTile(tile.x, tile.y);
        this.onEnterDoor(tile);
      } else if (isDigIntent) {
        this.setKeyboardTile(tile.x, tile.y);
        this.onExcavate(tile);
      } else {
        this.requestMovement(this.screenToWorld(event.clientX, event.clientY));
      }
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

  guideToTile(x, y) {
    if (!this.state) return;
    this.keyboardTile = {
      x: clamp(x, 0, this.state.width - 1),
      y: clamp(y, 0, this.state.height - 1)
    };
    this.camera.vx = 0;
    this.camera.vy = 0;
    this.camera.x = this.keyboardTile.x;
    this.camera.y = this.keyboardTile.y;
    this.constrainCamera();
    this.onFocusTile(this.keyboardTile);
  }

  handleKeydown(event) {
    if (!this.state) return;
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
      if (doorAt(this.state, this.keyboardTile.x, this.keyboardTile.y)) this.onEnterDoor(this.keyboardTile);
      else this.onExcavate(this.keyboardTile);
      event.preventDefault();
    }
  }

  playExcavation(tile, event) {
    if (this.excavation) return Promise.resolve();
    const origin = this.currentMinerPosition();
    this.movement = null;
    this.pendingMove = null;
    if (Math.abs(tile.x - origin.x) > 0.04) this.minerFacing = tile.x >= origin.x ? 1 : -1;
    const timeline = this.timelineFor(event);
    return new Promise((resolve) => {
      this.excavation = {
        tile,
        origin,
        event,
        timeline,
        elapsed: 0,
        stage: null,
        impactBurst: false,
        revealBurst: false,
        discoveryBurst: false,
        rewardBurst: false,
        resolve
      };
      this.emitExcavationStage("walk");
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

  playDoorTransition(tile, event) {
    if (this.doorTransition) return Promise.resolve();
    const duration = this.reducedMotion ? 460 : 920;
    const origin = this.currentMinerPosition();
    this.movement = null;
    this.pendingMove = null;
    if (Math.abs(tile.x - origin.x) > 0.04) this.minerFacing = tile.x >= origin.x ? 1 : -1;
    return new Promise((resolve) => {
      this.doorTransition = { tile: { ...tile }, origin, event, startedAt: performance.now(), duration };
      this.onStage({ stage: "door", tile, event });
      this.spawnBurst(tile, terrainAt(this.state, tile.x, tile.y), 20, "star");
      window.setTimeout(() => {
        this.minerTile = { ...tile };
        this.doorTransition = null;
        resolve();
        this.render();
      }, duration);
    });
  }

  render() {
    const context = this.context;
    if (!context) return;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const background = context.createLinearGradient(0, 0, this.width, this.height);
    background.addColorStop(0, "#0b1321");
    background.addColorStop(0.52, "#172a3a");
    background.addColorStop(1, "#101827");
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
      glow.addColorStop(0, index % 2 ? "#ffd48b" : "#9be8df");
      glow.addColorStop(1, "rgba(217,235,255,0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  drawMap(context) {
    context.save();
    context.translate(this.shake.x, this.shake.y);
    this.drawIslandBase(context);

    // The logical exploration positions sit inside an irregular coastline.
    // That preserves deterministic saving without presenting the player with
    // a literal eight-by-eight board.
    context.save();
    this.clipIsland(context);

    // The board only exists in the saved expedition data. The player sees one
    // painted landmass: sand naturally gives way to the grove and then the
    // crystal ridge. A dig location is an address on that land, never a tile.
    this.drawTerrainLandscape(context);
    this.drawLandmarks(context);
    this.drawExplorationFog(context);

    // Dig beacons and dug hollows are interaction language laid over the
    // landscape, rather than visible cell boundaries.
    for (let y = 0; y < this.state.height; y += 1) {
      for (let x = 0; x < this.state.width; x += 1) {
        const screen = this.tileToScreen(x, y);
        if (screen.x < -this.tileSize || screen.y < -this.tileSize || screen.x > this.width + this.tileSize || screen.y > this.height + this.tileSize) continue;
        const left = screen.x - this.tileSize / 2;
        const top = screen.y - this.tileSize / 2;
        const revealed = isRevealed(this.state, x, y);
        const selectable = !revealed && this.isSelectable(x, y);
        this.drawTile(context, x, y, left, top, this.tileSize, revealed, selectable);
        const door = doorAt(this.state, x, y);
        if (door && visibilityAt(this.state, x, y) !== "dark") {
          this.drawDoor(context, door, screen.x, screen.y, this.tileSize, canEnterDoor(this.state, x, y).ok);
        }
      }
    }
    this.drawMovementTarget(context);
    this.drawMiner(context);
    this.drawRewardPopup(context);
    context.restore();
    context.restore();
  }

  drawIslandBase(context) {
    const start = this.tileToScreen(0, 0);
    const end = this.tileToScreen(this.state.width - 1, this.state.height - 1);
    const margin = this.tileSize * 0.78;
    const left = Math.min(start.x, end.x) - margin;
    const top = Math.min(start.y, end.y) - margin;
    const width = Math.abs(end.x - start.x) + margin * 2;
    const height = Math.abs(end.y - start.y) + margin * 2;

    context.save();
    const cave = context.createRadialGradient(left + width * 0.45, top + height * 0.46, 8, left + width * 0.5, top + height * 0.55, Math.max(width, height));
    cave.addColorStop(0, "rgba(78, 99, 111, 0.55)");
    cave.addColorStop(0.55, "rgba(34, 49, 64, 0.62)");
    cave.addColorStop(1, "rgba(8, 15, 28, 0.94)");
    context.fillStyle = cave;
    context.fillRect(0, 0, this.width, this.height);

    context.globalAlpha = 0.33;
    context.strokeStyle = "#516572";
    context.lineWidth = Math.max(1, this.tileSize * 0.018);
    for (let index = 0; index < 7; index += 1) {
      const y = top + (index + 0.6) * height / 7;
      context.beginPath();
      context.moveTo(left - margin * 0.38, y);
      context.bezierCurveTo(left + width * 0.22, y - this.tileSize * 0.13, left + width * 0.7, y + this.tileSize * 0.16, left + width + margin * 0.3, y - this.tileSize * 0.04);
      context.stroke();
    }
    context.restore();

    // This rim is the wall of the open mine. The logical map stays the same,
    // but there is no sea or floating board around the player.
    context.save();
    this.traceIslandShape(context);
    context.fillStyle = "rgba(31, 42, 51, 0.92)";
    context.fill();
    context.lineWidth = Math.max(4, this.tileSize * 0.19);
    context.strokeStyle = "rgba(194, 151, 91, 0.5)";
    context.stroke();
    context.restore();
  }

  traceIslandShape(context) {
    const point = (x, y) => this.tileToScreen(x, y);
    const start = point(-0.58, 0.42);
    context.beginPath();
    context.moveTo(start.x, start.y);
    const curves = [
      [[-0.22, -0.42], [1.05, -0.48], [1.78, -0.3]],
      [[2.72, -0.62], [3.72, -0.35], [4.5, -0.46]],
      [[5.52, -0.7], [6.78, -0.46], [7.35, 0.24]],
      [[7.72, 1.12], [7.35, 2.14], [7.64, 2.98]],
      [[7.98, 3.96], [7.42, 4.78], [7.66, 5.75]],
      [[7.86, 6.72], [7.26, 7.42], [6.18, 7.48]],
      [[5.1, 7.72], [4.16, 7.38], [3.18, 7.62]],
      [[2.1, 7.88], [1.04, 7.38], [0.25, 7.56]],
      [[-0.52, 7.2], [-0.68, 6.1], [-0.46, 5.16]],
      [[-0.72, 4.02], [-0.38, 3.18], [-0.6, 2.26]],
      [[-0.82, 1.4], [-0.62, 0.78], [-0.58, 0.42]]
    ];
    for (const [first, second, end] of curves) {
      const controlOne = point(...first);
      const controlTwo = point(...second);
      const destination = point(...end);
      context.bezierCurveTo(controlOne.x, controlOne.y, controlTwo.x, controlTwo.y, destination.x, destination.y);
    }
    context.closePath();
  }

  clipIsland(context) {
    this.traceIslandShape(context);
    context.clip();
  }

  drawTerrainLandscape(context) {
    const point = (x, y) => this.tileToScreen(x, y);
    const northwest = point(-0.85, -0.72);
    const southeast = point(7.9, 7.9);
    const width = southeast.x - northwest.x;
    const height = southeast.y - northwest.y;

    // 1. The entire mine begins as a continuous worn shale floor. Repeating
    // strokes, not square texture stamps, give it a material surface.
    context.save();
    const sand = context.createLinearGradient(northwest.x, northwest.y, southeast.x, southeast.y);
    sand.addColorStop(0, "#9f774d");
    sand.addColorStop(0.44, "#73583f");
    sand.addColorStop(1, "#3f3737");
    context.fillStyle = sand;
    context.fillRect(northwest.x, northwest.y, width, height);
    context.globalAlpha = 0.24;
    context.strokeStyle = "#e9bf7b";
    context.lineWidth = Math.max(1, this.tileSize * 0.026);
    for (let index = 0; index < 12; index += 1) {
      const x = northwest.x + ((index * 137) % Math.max(1, width));
      const y = northwest.y + ((index * 79 + 31) % Math.max(1, height));
      context.beginPath();
      context.bezierCurveTo(x - this.tileSize * 0.24, y + this.tileSize * 0.08, x - this.tileSize * 0.06, y - this.tileSize * 0.12, x + this.tileSize * 0.28, y + this.tileSize * 0.04, x + this.tileSize * 0.52, y - this.tileSize * 0.11);
      context.stroke();
    }
    context.restore();

    // 2. A single moon-vine seam covers exactly the middle of the mine where
    // vine terrain is stored. Its irregular edge avoids a hard region seam.
    const grove = [
      // This canopy deliberately encloses every saved vine site, including
      // the first story find at (3, 1), rather than merely suggesting a
      // forest nearby.
      [1.24, 2.16], [2.12, 1.16], [2.76, 0.78], [4.02, 0.92], [4.9, 1.6],
      [5.48, 2.82], [5.18, 4.38], [4.78, 5.9], [3.48, 6.9],
      [2.04, 6.3], [0.72, 5.58], [0.78, 4.7], [1.3, 3.76]
    ];
    context.save();
    context.beginPath();
    const firstGrove = point(...grove[0]);
    context.moveTo(firstGrove.x, firstGrove.y);
    for (let index = 0; index < grove.length; index += 1) {
      const current = grove[index];
      const next = grove[(index + 1) % grove.length];
      const currentPoint = point(...current);
      const nextPoint = point(...next);
      const midpoint = { x: (currentPoint.x + nextPoint.x) / 2, y: (currentPoint.y + nextPoint.y) / 2 };
      context.quadraticCurveTo(currentPoint.x, currentPoint.y, midpoint.x, midpoint.y);
    }
    context.closePath();
    const leaf = context.createRadialGradient(point(3.25, 3.7).x, point(3.25, 3.7).y, this.tileSize * 0.18, point(3.25, 3.7).x, point(3.25, 3.7).y, this.tileSize * 4.1);
    leaf.addColorStop(0, "#9fc776");
    leaf.addColorStop(0.55, "#4e835b");
    leaf.addColorStop(1, "#294d45");
    context.fillStyle = leaf;
    context.fill();
    context.globalAlpha = 0.34;
    context.strokeStyle = "#d9f4a0";
    context.lineWidth = Math.max(1.1, this.tileSize * 0.024);
    for (const [x, y, bend] of [[2.1, 2.55, -1], [3.2, 2.08, 1], [4.1, 2.92, -1], [2.16, 4.22, 1], [3.38, 4.62, -1], [4.42, 5.38, 1], [2.86, 5.82, -1]]) {
      const start = point(x - 0.3, y + 0.28);
      const end = point(x + 0.32, y - 0.3);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(point(x, y + bend * 0.42).x, point(x, y + bend * 0.42).y, end.x, end.y);
      context.stroke();
    }
    context.restore();

    // 3. The right-hand crystal seam is one continuous rock formation. The
    // stored crystal positions live inside this silhouette, so the reward
    // type and the place the player sees always agree.
    context.save();
    context.beginPath();
    const ridgeStart = point(4.76, 2.12);
    context.moveTo(ridgeStart.x, ridgeStart.y);
    const ridge = [
      [[5.8, 1.18], [6.84, 0.78], [7.7, 1.18]],
      [[8.15, 2.1], [7.5, 3.04], [7.78, 3.82]],
      [[8.14, 4.78], [7.5, 5.9], [7.72, 7.28]],
      [[6.7, 7.5], [5.58, 6.88], [5.12, 5.78]],
      [[4.56, 4.96], [4.7, 3.54], [4.74, 2.76]],
      [[4.7, 2.38], [4.66, 2.18], [4.76, 2.12]]
    ];
    for (const [controlOne, controlTwo, end] of ridge) {
      const c1 = point(...controlOne);
      const c2 = point(...controlTwo);
      const destination = point(...end);
      context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, destination.x, destination.y);
    }
    context.closePath();
    const rock = context.createLinearGradient(point(5.1, 1.4).x, point(5.1, 1.4).y, point(7.85, 6.8).x, point(7.85, 6.8).y);
    rock.addColorStop(0, "#90a5d4");
    rock.addColorStop(0.48, "#596e9d");
    rock.addColorStop(1, "#29395f");
    context.fillStyle = rock;
    context.fill();
    context.globalAlpha = 0.42;
    context.strokeStyle = "#d6eaff";
    context.lineWidth = Math.max(1.2, this.tileSize * 0.026);
    for (const [x, y, heightScale] of [[6.0, 2.18, 0.74], [6.8, 2.7, 1], [5.86, 3.8, 0.62], [7.05, 4.55, 0.9], [6.16, 5.5, 0.66], [7.15, 6.35, 0.78]]) {
      const base = point(x, y + 0.35);
      const peak = point(x + 0.1, y - heightScale * 0.44);
      const right = point(x + 0.34, y + 0.34);
      context.beginPath();
      context.moveTo(base.x, base.y);
      context.lineTo(peak.x, peak.y);
      context.lineTo(right.x, right.y);
      context.stroke();
    }
    context.restore();

    // Mine rails make the natural player intent clear: begin at the shaft,
    // follow the tunnel through the vine seam, then reach the crystal face.
    context.save();
    const trail = [point(0.1, 0.12), point(1.25, 1.06), point(2.08, 2.42), point(3.28, 3.08), point(4.48, 3.88), point(5.78, 4.42)];
    const railOffset = this.tileSize * 0.08;
    context.globalAlpha = 0.72;
    context.strokeStyle = "#332a2d";
    context.lineWidth = Math.max(2, this.tileSize * 0.043);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const offset of [-railOffset, railOffset]) {
      context.beginPath();
      context.moveTo(trail[0].x, trail[0].y + offset);
      for (let index = 1; index < trail.length - 1; index += 1) {
        const current = trail[index];
        const next = trail[index + 1];
        context.quadraticCurveTo(current.x, current.y + offset, (current.x + next.x) / 2, (current.y + next.y) / 2 + offset);
      }
      context.lineTo(trail.at(-1).x, trail.at(-1).y + offset);
      context.stroke();
    }
    context.strokeStyle = "rgba(214, 157, 84, 0.72)";
    context.lineWidth = Math.max(2, this.tileSize * 0.09);
    for (const pointOnRail of trail.slice(1, -1)) {
      context.beginPath();
      context.moveTo(pointOnRail.x - railOffset * 1.8, pointOnRail.y - railOffset * 1.2);
      context.lineTo(pointOnRail.x + railOffset * 1.8, pointOnRail.y + railOffset * 1.2);
      context.stroke();
    }
    context.restore();
  }

  drawLandmarks(context) {
    const camp = this.tileToScreen(0, 0);
    const grove = this.tileToScreen(3.5, 3.6);
    const ridge = this.tileToScreen(6.3, 3.1);
    const scale = this.tileSize;
    context.save();

    // The shaft entrance gives the player an unambiguous "we arrived here".
    context.translate(camp.x - scale * 0.1, camp.y + scale * 0.04);
    context.fillStyle = "rgba(28, 25, 28, 0.96)";
    context.beginPath();
    context.arc(0, scale * 0.08, scale * 0.27, Math.PI, 0);
    context.lineTo(scale * 0.27, scale * 0.23);
    context.lineTo(-scale * 0.27, scale * 0.23);
    context.closePath();
    context.fill();
    context.strokeStyle = "#8f623c";
    context.lineWidth = Math.max(2, scale * 0.055);
    context.beginPath();
    context.moveTo(-scale * 0.32, scale * 0.24);
    context.lineTo(-scale * 0.25, -scale * 0.23);
    context.lineTo(scale * 0.25, -scale * 0.23);
    context.lineTo(scale * 0.32, scale * 0.24);
    context.stroke();
    context.strokeStyle = "#c89052";
    context.lineWidth = Math.max(1.4, scale * 0.028);
    context.beginPath();
    context.moveTo(-scale * 0.32, scale * 0.24);
    context.lineTo(scale * 0.32, scale * 0.24);
    context.stroke();
    const lampGlow = context.createRadialGradient(0, -scale * 0.16, 1, 0, -scale * 0.16, scale * 0.3);
    lampGlow.addColorStop(0, "rgba(255, 238, 160, 0.92)");
    lampGlow.addColorStop(1, "rgba(255, 183, 91, 0)");
    context.fillStyle = lampGlow;
    context.beginPath();
    context.arc(0, -scale * 0.16, scale * 0.3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffe19a";
    context.beginPath();
    context.arc(0, -scale * 0.16, scale * 0.055, 0, Math.PI * 2);
    context.fill();

    // A waiting mine cart makes the rail language tangible from the first
    // frame, before the player has excavated a second location.
    context.fillStyle = "#473a39";
    context.beginPath();
    context.moveTo(scale * 0.22, scale * 0.27);
    context.lineTo(scale * 0.53, scale * 0.27);
    context.lineTo(scale * 0.45, scale * 0.45);
    context.lineTo(scale * 0.28, scale * 0.45);
    context.closePath();
    context.fill();
    context.fillStyle = "#151925";
    for (const wheelX of [scale * 0.3, scale * 0.46]) {
      context.beginPath();
      context.arc(wheelX, scale * 0.48, scale * 0.045, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.globalAlpha = 0.42;
    context.strokeStyle = "#d2f3a1";
    context.lineWidth = Math.max(1.2, scale * 0.035);
    for (let index = 0; index < 4; index += 1) {
      context.beginPath();
      context.moveTo(grove.x - scale * (0.52 - index * 0.13), grove.y + scale * 0.45);
      context.quadraticCurveTo(grove.x - scale * (0.14 - index * 0.1), grove.y - scale * 0.38, grove.x + scale * (0.35 + index * 0.07), grove.y - scale * 0.05);
      context.stroke();
    }
    context.fillStyle = "rgba(212, 244, 164, 0.42)";
    for (let index = 0; index < 7; index += 1) {
      context.beginPath();
      context.arc(grove.x + ((index % 3) - 1) * scale * 0.19, grove.y + (Math.floor(index / 3) - 1) * scale * 0.18, scale * 0.14, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.globalAlpha = 0.58;
    context.fillStyle = "#d7e9ff";
    context.strokeStyle = "#7899dd";
    context.lineWidth = Math.max(1, scale * 0.025);
    for (let index = 0; index < 4; index += 1) {
      const x = ridge.x + (index - 1.5) * scale * 0.19;
      const peak = ridge.y - scale * (0.42 + (index % 2) * 0.18);
      context.beginPath();
      context.moveTo(x - scale * 0.14, ridge.y + scale * 0.38);
      context.lineTo(x, peak);
      context.lineTo(x + scale * 0.14, ridge.y + scale * 0.38);
      context.closePath();
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  drawExplorationFog(context) {
    const start = this.tileToScreen(-0.7, -0.7);
    const end = this.tileToScreen(this.state.width - 0.05, this.state.height - 0.05);
    const left = Math.min(start.x, end.x) - this.tileSize;
    const top = Math.min(start.y, end.y) - this.tileSize;
    const width = Math.abs(end.x - start.x) + this.tileSize * 2;
    const height = Math.abs(end.y - start.y) + this.tileSize * 2;

    // One continuous veil creates four readable states without turning the
    // mine back into a board: untouched darkness, frontier shadow, saved
    // exploration and the warm trace excavated during this play session.
    context.save();
    const mist = context.createLinearGradient(left, top, left + width, top + height);
    mist.addColorStop(0, "rgba(7, 20, 42, 0.74)");
    mist.addColorStop(0.55, "rgba(5, 17, 38, 0.84)");
    mist.addColorStop(1, "rgba(2, 10, 26, 0.91)");
    context.fillStyle = mist;
    context.fillRect(left, top, width, height);

    context.globalCompositeOperation = "destination-out";
    for (let y = 0; y < this.state.height; y += 1) for (let x = 0; x < this.state.width; x += 1) {
      const visibility = visibilityAt(this.state, x, y);
      if (visibility === "dark") continue;
      const screen = this.tileToScreen(x, y);
      const radius = this.tileSize * (visibility === "shadow" ? 0.6 : 0.88);
      const clearing = context.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius);
      const alpha = visibility === "shadow" ? 0.34 : visibility === "current" ? 0.96 : 0.82;
      clearing.addColorStop(0, `rgba(0,0,0,${alpha})`);
      clearing.addColorStop(0.68, `rgba(0,0,0,${alpha * 0.72})`);
      clearing.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = clearing;
      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.globalCompositeOperation = "source-over";
    for (let y = 0; y < this.state.height; y += 1) for (let x = 0; x < this.state.width; x += 1) {
      const visibility = visibilityAt(this.state, x, y);
      if (visibility !== "shadow" && visibility !== "current") continue;
      const screen = this.tileToScreen(x, y);
      context.globalAlpha = visibility === "current" ? 0.72 : 0.2;
      context.strokeStyle = visibility === "current" ? "#ffe797" : "#9ab8d8";
      context.lineWidth = Math.max(1.2, this.tileSize * (visibility === "current" ? 0.032 : 0.018));
      context.beginPath();
      context.arc(screen.x, screen.y, this.tileSize * (visibility === "current" ? 0.41 : 0.32), 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  isSelectable(x, y) {
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nextX, nextY]) => isInBounds(this.state, nextX, nextY) && isRevealed(this.state, nextX, nextY));
  }

  drawTile(context, x, y, left, top, size, revealed, selectable) {
    const isKeyboardTile = this.keyboardTile.x === x && this.keyboardTile.y === y;
    const isHoverTile = this.hoverTile?.x === x && this.hoverTile?.y === y;
    const centerX = left + size / 2;
    const centerY = top + size / 2;
    if (revealed) {
      this.drawExcavatedSite(context, centerX, centerY, size, terrainAt(this.state, x, y).id);
      const target = targetAt(this.state, x, y);
      const animation = this.activeExcavationAt(x, y);
      if (target && this.state.foundTargetIds.includes(target.id)) {
        this.drawRelic(context, target, centerX, centerY, size, this.relicRevealProgress(animation));
      }
      const key = keyAt(this.state, x, y);
      if (key && this.state.collectedKeyIds.includes(key.id)) this.drawFoundKey(context, centerX, centerY, size, animation);
    } else if (selectable) this.drawFrontierBeacon(context, centerX, centerY, size);

    if (isKeyboardTile || isHoverTile) {
      context.save();
      context.strokeStyle = isKeyboardTile ? "#fff0a2" : "#c9f6cd";
      context.lineWidth = isKeyboardTile ? 2.6 : 1.7;
      context.beginPath();
      context.arc(centerX, centerY, size * 0.34, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    const animation = this.activeExcavationAt(x, y);
    if (animation) this.drawExcavationOverlay(context, animation, left, top, size, Math.max(8, size * 0.18));
    if (this.queuedTile?.x === x && this.queuedTile?.y === y) this.drawQueuedMarker(context, left, top, size, Math.max(8, size * 0.18));
  }

  drawDoor(context, door, x, y, size, unlocked) {
    const transition = this.doorTransition?.event?.door?.id === door.id;
    const pulse = 0.5 + Math.sin(performance.now() / 260) * 0.16;
    context.save();
    context.translate(x, y - size * 0.07);
    const glow = context.createRadialGradient(0, 0, size * 0.05, 0, 0, size * 0.62);
    glow.addColorStop(0, unlocked ? `rgba(133,247,210,${transition ? 0.9 : pulse})` : "rgba(255,194,102,0.45)");
    glow.addColorStop(1, "rgba(60,92,128,0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, size * 0.62, 0, Math.PI * 2);
    context.fill();

    context.lineWidth = Math.max(3, size * 0.07);
    context.strokeStyle = unlocked ? "#b9f4cf" : "#b98b60";
    context.fillStyle = "rgba(18,31,52,0.92)";
    context.beginPath();
    context.moveTo(-size * 0.27, size * 0.29);
    context.lineTo(-size * 0.27, -size * 0.08);
    context.arc(0, -size * 0.08, size * 0.27, Math.PI, 0);
    context.lineTo(size * 0.27, size * 0.29);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = unlocked ? "#c9ffe3" : "#ffd693";
    context.font = `bold ${Math.max(14, size * 0.24)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(unlocked ? "✦" : "🔒", 0, size * 0.02);
    context.font = `700 ${Math.max(9, size * 0.105)}px system-ui, sans-serif`;
    context.fillStyle = "#fff3c2";
    context.fillText(door.name, 0, size * 0.46);
    context.restore();
  }

  drawFrontierBeacon(context, x, y, size) {
    context.save();
    const pulse = 0.58 + Math.sin(performance.now() / 260) * 0.16;
    const glow = context.createRadialGradient(x, y, size * 0.05, x, y, size * 0.42);
    glow.addColorStop(0, "rgba(255, 242, 181, 0.72)");
    glow.addColorStop(1, "rgba(215, 244, 185, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, size * 0.42, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = pulse;
    context.strokeStyle = "#d7f4b9";
    context.lineWidth = Math.max(1.4, size * 0.04);
    context.beginPath();
    context.arc(x, y, size * 0.23, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#fff2b5";
    context.font = `bold ${Math.max(12, size * 0.25)}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("✦", x, y + 1);
    context.restore();
  }

  drawFoundKey(context, x, y, size, animation) {
    const progress = animation ? this.relicRevealProgress(animation) : 1;
    const float = Math.sin(performance.now() / 330) * size * 0.035;
    context.save();
    context.translate(x, y - size * 0.18 + float);
    context.scale(Math.max(0.05, progress), Math.max(0.05, progress));
    context.shadowColor = "#ffe47f";
    context.shadowBlur = size * 0.22;
    context.fillStyle = "#ffe18a";
    context.font = `${Math.max(18, size * 0.34)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("🔑", 0, 0);
    context.restore();
  }

  drawExcavatedSite(context, x, y, size, terrainId) {
    const soil = terrainId === "crystal" ? "#3c4e79" : terrainId === "vine" ? "#315a43" : "#795137";
    context.save();
    context.globalAlpha = 0.6;
    context.fillStyle = soil;
    context.beginPath();
    context.ellipse(x, y + size * 0.07, size * 0.28, size * 0.18, -0.08, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.52;
    context.strokeStyle = "#f5d99a";
    context.lineWidth = Math.max(1, size * 0.022);
    context.beginPath();
    context.arc(x, y + size * 0.05, size * 0.21, Math.PI * 0.12, Math.PI * 0.88);
    context.stroke();
    context.restore();
  }

  activeExcavationAt(x, y) {
    const animation = this.excavation;
    if (!animation || animation.tile.x !== x || animation.tile.y !== y) return null;
    return animation;
  }

  revealProgress(animation) {
    if (!animation) return 1;
    const { timeline } = animation;
    const revealStart = timeline.walk + timeline.aim + timeline.impact;
    return clamp((animation.elapsed - revealStart) / Math.max(0.001, timeline.reveal), 0, 1);
  }

  relicRevealProgress(animation) {
    if (!animation) return 1;
    const reveal = this.revealProgress(animation);
    if (!["discovery", "key"].includes(animation.event.type)) return 1;
    const discoveryStart = animation.timeline.walk + animation.timeline.aim + animation.timeline.impact + animation.timeline.reveal * 0.58;
    return reveal * clamp((animation.elapsed - discoveryStart) / Math.max(0.001, animation.timeline.discovery * 0.48), 0, 1);
  }

  drawExcavationOverlay(context, animation, left, top, size, radius) {
    const reveal = this.revealProgress(animation);
    const centerX = left + size / 2;
    const centerY = top + size / 2;
    const { timeline, elapsed, event } = animation;
    const aimStart = timeline.walk;
    const impactStart = aimStart + timeline.aim;
    const revealStart = impactStart + timeline.impact;
    const discoveryStart = revealStart + timeline.reveal;

    if (reveal < 1) {
      context.save();
      context.globalAlpha = 1 - reveal;
      const cover = context.createRadialGradient(centerX, centerY, size * 0.06, centerX, centerY, size * 0.78);
      cover.addColorStop(0, "#6071a5");
      cover.addColorStop(0.55, "#2e416a");
      cover.addColorStop(1, "rgba(23, 41, 78, 0)");
      context.beginPath();
      context.arc(centerX, centerY, size * 0.76, 0, Math.PI * 2);
      context.fillStyle = cover;
      context.fill();
      context.restore();
    }

    const aimProgress = clamp((elapsed - aimStart) / Math.max(0.001, timeline.aim), 0, 1);
    if (elapsed >= aimStart && elapsed < revealStart) {
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

  drawQueuedMarker(context, left, top, size, radius) {
    const pulse = 0.5 + Math.sin(performance.now() / 180) * 0.14;
    const centerX = left + size / 2;
    const centerY = top + size / 2;
    context.save();
    context.globalAlpha = pulse;
    context.setLineDash([Math.max(3, size * 0.09), Math.max(2, size * 0.06)]);
    context.strokeStyle = "#fff0a5";
    context.lineWidth = Math.max(1.5, size * 0.04);
    context.beginPath();
    context.arc(centerX, centerY, size * 0.38, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 0.94;
    context.fillStyle = "#fff7cf";
    context.font = `bold ${Math.max(9, size * 0.16)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("下一鏟", centerX, top - Math.max(8, size * 0.1));
    context.restore();
  }

  drawMovementTarget(context) {
    const destination = this.pendingMove ?? this.movement?.destination;
    if (!destination) return;
    const screen = this.tileToScreen(destination.x, destination.y);
    const pulse = 0.72 + Math.sin(performance.now() / 170) * 0.16;
    context.save();
    context.globalAlpha = pulse;
    context.strokeStyle = "#d8f3d4";
    context.lineWidth = Math.max(1.6, this.tileSize * 0.026);
    context.setLineDash([this.tileSize * 0.07, this.tileSize * 0.055]);
    context.beginPath();
    context.ellipse(screen.x, screen.y + this.tileSize * 0.18, this.tileSize * 0.22, this.tileSize * 0.09, 0, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(216, 243, 212, 0.86)";
    context.beginPath();
    context.arc(screen.x, screen.y + this.tileSize * 0.18, this.tileSize * 0.035, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  drawMiner(context) {
    const animation = this.excavation;
    const tile = this.currentMinerPosition();
    let action = this.movement ? "walk" : "idle";
    let actionProgress = this.movement ? this.movement.elapsed / Math.max(0.001, this.movement.duration) : 0;
    if (!this.movement && this.reaction) {
      action = this.reaction.type;
      actionProgress = this.reaction.elapsed / Math.max(0.001, this.reaction.duration);
    }
    if (animation) {
      const { elapsed, timeline } = animation;
      const aimAt = timeline.walk;
      const impactAt = aimAt + timeline.aim;
      const revealAt = impactAt + timeline.impact;
      const discoveryAt = revealAt + timeline.reveal;
      const rewardAt = discoveryAt + timeline.discovery;
      if (elapsed < aimAt) [action, actionProgress] = ["walk", elapsed / Math.max(0.001, timeline.walk)];
      else if (elapsed < impactAt) [action, actionProgress] = ["aim", (elapsed - aimAt) / Math.max(0.001, timeline.aim)];
      else if (elapsed < revealAt) [action, actionProgress] = ["impact", (elapsed - impactAt) / Math.max(0.001, timeline.impact)];
      else if (elapsed < discoveryAt) [action, actionProgress] = ["brush", (elapsed - revealAt) / Math.max(0.001, timeline.reveal)];
      else if (animation.event.type === "discovery" && elapsed < rewardAt) [action, actionProgress] = ["celebrate", (elapsed - discoveryAt) / Math.max(0.001, timeline.discovery)];
      else if (elapsed < rewardAt + timeline.reward) [action, actionProgress] = ["present", (elapsed - rewardAt) / Math.max(0.001, timeline.reward)];
      else [action, actionProgress] = ["settle", (elapsed - rewardAt - timeline.reward) / Math.max(0.001, timeline.settle)];
    }

    const now = performance.now();
    const screen = this.tileToScreen(tile.x, tile.y);
    const size = this.tileSize * 0.64;
    const walkCycle = (this.movement?.elapsed ?? animation?.elapsed ?? 0) * 11;
    const stride = action === "walk" ? Math.sin(walkCycle) : 0;
    const breathe = Math.sin(now / 430) * size * 0.012;
    const blink = action === "tired" || now % 4300 > 4100;
    const jump = action === "celebrate" ? Math.sin(clamp(actionProgress, 0, 1) * Math.PI) * size * 0.16 : 0;
    const crouch = action === "brush" ? size * (0.08 + Math.sin(actionProgress * Math.PI) * 0.08) : 0;
    const bob = action === "walk" ? -Math.abs(stride) * size * 0.045 : breathe;
    const toolAngle = action === "aim"
      ? -0.85 - actionProgress * 0.5
      : action === "impact"
        ? -1.35 + actionProgress * 2.05
        : action === "brush"
          ? 0.76 + Math.sin(actionProgress * Math.PI * 4) * 0.14
          : 0.34;
    const presenting = action === "present" || action === "celebrate";
    const armSwing = action === "walk" ? -stride * 0.34 : 0;
    const reactionX = action === "blocked" ? Math.sin(actionProgress * Math.PI * 7) * size * 0.045 : 0;
    const tiredDrop = action === "tired" ? Math.sin(clamp(actionProgress, 0, 1) * Math.PI) * size * 0.08 : 0;

    context.save();
    context.translate(screen.x + reactionX, screen.y + size * 0.3 + bob + crouch - jump + tiredDrop);
    context.scale(this.minerFacing, 1);
    context.shadowColor = "rgba(4, 12, 30, 0.5)";
    context.shadowBlur = size * 0.14;
    context.shadowOffsetY = size * 0.06;
    context.fillStyle = "rgba(8, 18, 40, 0.48)";
    context.beginPath();
    context.ellipse(0, size * 0.08 + jump, size * 0.3, size * 0.085, 0, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    const limb = (fromX, fromY, toX, toY, width, color) => {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();
    };

    const legLift = stride * size * 0.07;
    limb(-size * 0.1, -size * 0.13, -size * 0.13 - legLift, size * 0.03, size * 0.115, "#f3e7cf");
    limb(size * 0.1, -size * 0.13, size * 0.13 + legLift, size * 0.03, size * 0.115, "#f3e7cf");
    limb(-size * 0.14 - legLift, size * 0.03, -size * 0.2 - legLift, size * 0.055, size * 0.105, "#694d3e");
    limb(size * 0.14 + legLift, size * 0.03, size * 0.2 + legLift, size * 0.055, size * 0.105, "#694d3e");

    context.fillStyle = "#287f80";
    drawRoundedRect(context, -size * 0.32, -size * 0.45, size * 0.2, size * 0.29, size * 0.065);
    context.fill();
    context.strokeStyle = "#d3efca";
    context.lineWidth = Math.max(1, size * 0.028);
    context.stroke();

    context.fillStyle = "#d8783f";
    drawRoundedRect(context, -size * 0.235, -size * 0.48, size * 0.47, size * 0.4, size * 0.13);
    context.fill();
    context.strokeStyle = "#6d4939";
    context.lineWidth = Math.max(1.2, size * 0.03);
    context.stroke();
    context.fillStyle = "#f7bd5e";
    context.beginPath();
    context.moveTo(-size * 0.19, -size * 0.45);
    context.lineTo(0, -size * 0.31);
    context.lineTo(size * 0.19, -size * 0.45);
    context.lineTo(size * 0.12, -size * 0.51);
    context.lineTo(0, -size * 0.4);
    context.lineTo(-size * 0.12, -size * 0.51);
    context.closePath();
    context.fill();

    const frontHand = presenting
      ? { x: size * 0.2, y: -size * 0.58 }
      : { x: size * (0.25 + Math.cos(toolAngle) * 0.12), y: -size * (0.29 + Math.sin(toolAngle) * 0.14) };
    const backHand = presenting
      ? { x: -size * 0.2, y: -size * 0.58 }
      : { x: -size * (0.25 + armSwing), y: -size * (0.28 - Math.abs(armSwing) * 0.22) };
    limb(-size * 0.16, -size * 0.4, backHand.x, backHand.y, size * 0.105, "#d8783f");
    limb(size * 0.16, -size * 0.4, frontHand.x, frontHand.y, size * 0.105, "#d8783f");
    context.fillStyle = "#ffdabb";
    for (const hand of [backHand, frontHand]) {
      context.beginPath();
      context.arc(hand.x, hand.y, size * 0.061, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = "#ffe1bb";
    context.beginPath();
    context.arc(0, -size * 0.65, size * 0.235, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#604136";
    context.beginPath();
    context.arc(0, -size * 0.69, size * 0.255, Math.PI * 0.92, Math.PI * 2.08);
    context.lineTo(size * 0.2, -size * 0.62);
    context.quadraticCurveTo(size * 0.11, -size * 0.56, size * 0.08, -size * 0.78);
    context.quadraticCurveTo(-size * 0.02, -size * 0.59, -size * 0.09, -size * 0.79);
    context.quadraticCurveTo(-size * 0.14, -size * 0.58, -size * 0.22, -size * 0.62);
    context.closePath();
    context.fill();

    context.strokeStyle = "#433449";
    context.fillStyle = "#433449";
    context.lineWidth = Math.max(1.4, size * 0.03);
    if (blink) {
      context.beginPath();
      context.moveTo(-size * 0.09, -size * 0.66);
      context.lineTo(-size * 0.035, -size * 0.66);
      context.moveTo(size * 0.055, -size * 0.66);
      context.lineTo(size * 0.11, -size * 0.66);
      context.stroke();
    } else {
      context.beginPath();
      context.arc(-size * 0.06, -size * 0.66, size * 0.032, 0, Math.PI * 2);
      context.arc(size * 0.09, -size * 0.66, size * 0.032, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = "#a24f4c";
    context.lineWidth = Math.max(1, size * 0.018);
    context.beginPath();
    if (action === "tired") {
      context.arc(size * 0.025, -size * 0.545, size * 0.045, 1.08 * Math.PI, 1.92 * Math.PI);
    } else {
      context.arc(size * 0.025, -size * 0.59, size * 0.045, 0.08 * Math.PI, 0.92 * Math.PI);
    }
    context.stroke();

    context.fillStyle = "#f8cf54";
    const starX = -size * 0.19;
    const starY = -size * 0.78;
    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const radius = point % 2 === 0 ? size * 0.06 : size * 0.026;
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const x = starX + Math.cos(angle) * radius;
      const y = starY + Math.sin(angle) * radius;
      if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();

    if (presenting) {
      const glowY = -size * 0.6;
      const glow = context.createRadialGradient(0, glowY, 0, 0, glowY, size * 0.24);
      glow.addColorStop(0, "rgba(255, 244, 155, 0.96)");
      glow.addColorStop(1, "rgba(255, 218, 91, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(0, glowY, size * 0.24, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff5a8";
      context.beginPath();
      context.arc(0, glowY, size * 0.065, 0, Math.PI * 2);
      context.fill();
    } else {
      context.save();
      context.translate(frontHand.x, frontHand.y);
      context.rotate(toolAngle);
      context.strokeStyle = "#7a513b";
      context.lineWidth = Math.max(2, size * 0.045);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(size * 0.5, 0);
      context.stroke();
      context.strokeStyle = "#c6d8dc";
      context.lineWidth = Math.max(3, size * 0.075);
      context.beginPath();
      context.moveTo(size * 0.42, -size * 0.12);
      context.quadraticCurveTo(size * 0.54, 0, size * 0.42, size * 0.12);
      context.stroke();
      context.restore();
    }
    context.restore();
  }

  drawRewardPopup(context) {
    const animation = this.excavation;
    if (!animation) return;
    const { timeline, event, elapsed, tile } = animation;
    const rewardStart = timeline.walk + timeline.aim + timeline.impact + timeline.reveal + timeline.discovery;
    if (elapsed < rewardStart || !event.reward) return;
    const progress = clamp((elapsed - rewardStart) / Math.max(0.001, timeline.reward), 0, 1);
    const items = Object.entries(event.reward)
      .filter(([, amount]) => amount > 0)
      .slice(0, 3)
      .map(([resource, amount]) => ({ coins: "星幣", moonleaf: "月芽葉", starlight: "星光" }[resource] ?? resource) + ` +${amount}`);
    if (!items.length) return;
    const screen = this.tileToScreen(tile.x, tile.y);
    const rise = this.tileSize * (0.44 + progress * 0.3);
    const alpha = clamp(Math.min(progress * 3, (1 - progress) * 3 + 0.3), 0, 1);
    context.save();
    context.globalAlpha = alpha;
    context.font = `bold ${Math.max(11, this.tileSize * 0.18)}px system-ui, sans-serif`;
    const text = items.join("  ");
    const width = Math.min(this.width - 16, context.measureText(text).width + this.tileSize * 0.28);
    const height = Math.max(25, this.tileSize * 0.42);
    const x = clamp(screen.x - width / 2, 8, this.width - width - 8);
    const y = clamp(screen.y - rise, height + 6, this.height - 8);
    const fill = context.createLinearGradient(x, y - height, x, y);
    fill.addColorStop(0, "rgba(27, 58, 81, 0.98)");
    fill.addColorStop(1, "rgba(10, 26, 52, 0.96)");
    drawRoundedRect(context, x, y - height, width, height, height / 2);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = "rgba(255, 235, 152, 0.88)";
    context.lineWidth = 1.2;
    context.stroke();
    context.fillStyle = "#fff5bd";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, x + width / 2, y - height / 2 + 0.5);
    context.restore();
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
