import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * The hero's 3D double helix.
 *
 * A plain three.js scene (no React renderer) so the page ships one dependency and the lifecycle is
 * explicit: construct, `load`, drive `state.zoom` from a scroll timeline, `dispose`.
 *
 * `state.zoom` runs 0 to 1. At 0 the helix is small, far away and tilted; at 1 it is full size and
 * upright. GSAP scrubs that one number, and the render loop eases the visible pose toward it, so
 * scrolling feels weighted instead of mechanical.
 *
 * The model's own textures are discarded. Its surface is repainted with the chromosome-painting
 * palette (royal blue, steel, pearl) along the length of the helix, so the 3D piece matches the
 * site tokens exactly.
 */

const SPECTRUM = [0x2f49b0, 0x7d93d6, 0xc9d4f2].map((hex) => new THREE.Color(hex));
const MODEL_HEIGHT = 5;

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

/** Colour at position `t` (0 to 1) along the spectrum. */
function spectrumAt(t: number, target: THREE.Color): THREE.Color {
  const scaled = Math.min(Math.max(t, 0), 1) * (SPECTRUM.length - 1);
  const index = Math.min(Math.floor(scaled), SPECTRUM.length - 2);
  const from = SPECTRUM[index] ?? SPECTRUM[0]!;
  const to = SPECTRUM[index + 1] ?? from;
  return target.copy(from).lerp(to, scaled - index);
}

/** Direction of greatest spread of a point cloud, by power iteration on its covariance matrix. */
function principalAxis(points: THREE.Vector3[], mean: THREE.Vector3): THREE.Vector3 {
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const point of points) {
    const x = point.x - mean.x;
    const y = point.y - mean.y;
    const z = point.z - mean.z;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const axis = new THREE.Vector3(1, 1, 1).normalize();
  for (let step = 0; step < 24; step += 1) {
    axis
      .set(
        xx * axis.x + xy * axis.y + xz * axis.z,
        xy * axis.x + yy * axis.y + yz * axis.z,
        xz * axis.x + yz * axis.y + zz * axis.z
      )
      .normalize();
  }
  return axis;
}

function glowSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

export type DnaSceneOptions = {
  modelUrl: string;
  /** Skip idle spin and pointer parallax; the pose still follows `state.zoom`. */
  reducedMotion: boolean;
};

export class DnaScene {
  /** Driven by the scroll timeline. */
  readonly state = { zoom: 0 };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private readonly rig = new THREE.Group();
  private readonly spinner = new THREE.Group();
  private readonly dust: THREE.Points;
  private readonly sprite = glowSprite();
  private readonly environment: THREE.Texture;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly pointer = { x: 0, y: 0, easedX: 0, easedY: 0 };

  private shownZoom = 0;
  private spin = 0;
  private lastTime = 0;
  private frame = 0;
  private running = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: DnaSceneOptions
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.55;

    this.addLights();
    this.dust = this.createDust();
    this.scene.add(this.dust);

    this.rig.add(this.spinner);
    this.scene.add(this.rig);
    this.applyPose(0);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();

    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
  }

  /** Loads the model and repaints it. Resolves once the helix is in the scene. */
  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(this.options.modelUrl);
    if (this.disposed) return;

    const pivot = new THREE.Group();
    pivot.add(gltf.scene);
    this.spinner.add(pivot);
    this.normalise(pivot);
    this.repaint(pivot);
    this.renderOnce();
  }

  /** Starts or pauses the render loop (paused when the hero is off screen). */
  setActive(active: boolean) {
    if (active === this.running || this.disposed) return;
    this.running = active;
    if (active) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    } else {
      cancelAnimationFrame(this.frame);
    }
  }

  /** One frame without the loop; used for reduced motion and right after load. */
  renderOnce() {
    if (this.disposed) return;
    this.shownZoom = this.state.zoom;
    this.applyPose(0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("pointermove", this.onPointerMove);
    this.resizeObserver.disconnect();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material: THREE.Material) => material.dispose());
      }
    });
    this.disposables.forEach((item) => item.dispose());
    this.sprite.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private addLights() {
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 5, 6);
    const magenta = new THREE.PointLight(0x5470e0, 170, 0, 2);
    magenta.position.set(-5, 2, 4);
    const cyan = new THREE.PointLight(0x9db0e8, 120, 0, 2);
    cyan.position.set(5, -3, -2);
    const gold = new THREE.PointLight(0xdfe6fa, 70, 0, 2);
    gold.position.set(0, 5, -4);
    this.scene.add(new THREE.AmbientLight(0x2c3a7a, 0.35), key, magenta, cyan, gold);
  }

  private createDust(): THREE.Points {
    const count = 180;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const radius = 3 + Math.random() * 7;
      const theta = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 2] = Math.sin(theta) * radius - 2;
      spectrumAt(Math.random(), color).toArray(colors, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.09,
      map: this.sprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
  }

  /**
   * Stands the helix upright, centres it and scales it to MODEL_HEIGHT.
   *
   * The file carries a tilted, 100x-scaled node transform, so its bounding box says nothing about
   * which way the helix runs. The axis is found from the vertices themselves: the direction of
   * greatest spread (principal component) is the helix's length.
   */
  private normalise(pivot: THREE.Group) {
    const points: THREE.Vector3[] = [];
    this.forEachVertex(pivot, (point) => points.push(point.clone()));
    if (points.length === 0) return;

    const mean = points
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .divideScalar(points.length);
    const axis = principalAxis(points, mean);
    const upright = new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0));

    let low = Infinity;
    let high = -Infinity;
    const local = new THREE.Vector3();
    for (const point of points) {
      local.copy(point).sub(mean).applyQuaternion(upright);
      low = Math.min(low, local.y);
      high = Math.max(high, local.y);
    }

    const scale = MODEL_HEIGHT / (high - low);
    // Rotate and scale about the mean, then lift so the helix is centred on the origin.
    const shift = mean
      .clone()
      .applyQuaternion(upright)
      .add(new THREE.Vector3(0, (low + high) / 2, 0));
    pivot.quaternion.copy(upright);
    pivot.scale.setScalar(scale);
    pivot.position.copy(shift).multiplyScalar(-scale);
    pivot.updateMatrixWorld(true);
  }

  /** Replaces the authored material with a spectrum painted along the helix. */
  private repaint(pivot: THREE.Group) {
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      metalness: 0.2,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      emissive: new THREE.Color(0x0a1a4a),
      emissiveIntensity: 0.55,
    });
    this.disposables.push(material);

    const color = new THREE.Color();
    pivot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const colors = new Float32Array(object.geometry.getAttribute("position").count * 3);
      this.forEachVertex(object, (point, index) => {
        const along = (point.y + MODEL_HEIGHT / 2) / MODEL_HEIGHT;
        const around = Math.atan2(point.z, point.x);
        spectrumAt(along + Math.sin(around) * 0.14, color).toArray(colors, index * 3);
      });
      object.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      object.material = material;
    });
  }

  /**
   * Visits every vertex under `root` in the spinner's own coordinate space. Using world space here
   * would bake the rig's current zoom pose into the measurements.
   */
  private forEachVertex(
    root: THREE.Object3D,
    visit: (point: THREE.Vector3, index: number) => void
  ) {
    this.scene.updateMatrixWorld(true);
    const intoSpinner = this.spinner.matrixWorld.clone().invert();
    const point = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const position = object.geometry.getAttribute("position");
      matrix.multiplyMatrices(intoSpinner, object.matrixWorld);
      for (let i = 0; i < position.count; i += 1) {
        visit(point.fromBufferAttribute(position, i).applyMatrix4(matrix), i);
      }
    });
  }

  private applyPose(deltaSeconds: number) {
    const zoom = easeOutCubic(this.shownZoom);
    const { reducedMotion } = this.options;

    if (!reducedMotion) this.spin += deltaSeconds * 0.28;
    this.pointer.easedX = lerp(this.pointer.easedX, this.pointer.x, 0.06);
    this.pointer.easedY = lerp(this.pointer.easedY, this.pointer.y, 0.06);

    this.rig.scale.setScalar(lerp(0.62, 1, zoom));
    this.rig.position.x = lerp(this.startOffset.x, 0, zoom);
    this.rig.position.y = lerp(this.startOffset.y, 0, zoom);
    this.rig.rotation.z = lerp(0.62, 0.1, zoom);
    this.rig.rotation.x = this.pointer.easedY * 0.12;
    this.spinner.rotation.y =
      this.spin + this.shownZoom * Math.PI * 2.4 + this.pointer.easedX * 0.35;

    this.camera.position.set(0, 0, lerp(13.5, 10, zoom) * this.framing);
    this.camera.lookAt(0, 0, 0);

    this.dust.rotation.y = this.spin * 0.35 + this.shownZoom * 0.9;
    this.dust.position.y = lerp(0, 1.2, this.shownZoom);
  }

  /** Pulls the camera back on tall, narrow screens so the helix is never clipped. */
  private framing = 1;
  /** Where the small helix rests before the zoom: beside the headline, or below it on phones. */
  private startOffset = { x: 2.6, y: 0.5 };

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.framing = this.camera.aspect < 0.9 ? 1 + (0.9 - this.camera.aspect) * 0.9 : 1;
    this.startOffset = this.camera.aspect > 1.15 ? { x: 2.6, y: 0.5 } : { x: 0, y: -3.1 };
    if (!this.running) this.renderOnce();
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    this.pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
    this.pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
  };

  private readonly tick = (now: number) => {
    if (!this.running || this.disposed) return;
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.shownZoom = lerp(this.shownZoom, this.state.zoom, 1 - Math.exp(-delta * 7));
    this.applyPose(delta);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };
}
