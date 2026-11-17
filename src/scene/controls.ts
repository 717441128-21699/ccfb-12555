import * as THREE from 'three';

/** 编辑模式轨道控制：左键旋转、右键平移、滚轮缩放（自实现，无外部依赖） */
export class OrbitRig {
  target = new THREE.Vector3(0, 4, 0);
  private sph = new THREE.Spherical(95, Math.PI / 3.2, Math.PI / 4);
  private dragging: null | 'rotate' | 'pan' = null;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLElement;
  camera: THREE.PerspectiveCamera;
  enabled = true;
  /** 左键旋转开关；种植笔刷激活时关闭，避免拖动种树同时旋转相机 */
  leftRotateEnabled = true;

  constructor(camera: THREE.PerspectiveCamera, el: HTMLElement) {
    this.camera = camera;
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.update();
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    if (e.button === 0 && !this.leftRotateEnabled) return;
    this.dragging = e.button === 2 ? 'pan' : 'rotate';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.dragging === 'rotate') {
      this.sph.theta -= dx * 0.005;
      this.sph.phi = THREE.MathUtils.clamp(this.sph.phi - dy * 0.005, 0.15, Math.PI / 2 - 0.04);
    } else {
      const panScale = this.sph.radius * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      this.target.addScaledVector(right, -dx * panScale);
      this.target.addScaledVector(up, dy * panScale);
      this.target.y = THREE.MathUtils.clamp(this.target.y, 1, 40);
    }
    this.update();
  };

  private onUp = () => {
    this.dragging = null;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.sph.radius = THREE.MathUtils.clamp(this.sph.radius * (1 + Math.sign(e.deltaY) * 0.08), 8, 260);
    this.update();
  };

  update(): void {
    const pos = new THREE.Vector3().setFromSpherical(this.sph).add(this.target);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
  }
}

/** 第一人称漫游：指针锁定 + WASD，重力贴地 */
export class WalkRig {
  camera: THREE.PerspectiveCamera;
  private el: HTMLElement;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  speed = 4;
  active = false;
  private eyeHeight = 1.7;

  constructor(camera: THREE.PerspectiveCamera, el: HTMLElement) {
    this.camera = camera;
    this.el = el;
    document.addEventListener('mousemove', this.onMouse);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  enter(): void {
    this.active = true;
    this.el.requestPointerLock();
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  exit(): void {
    this.active = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onLockChange = () => {
    if (!document.pointerLockElement && this.active) {
      this.active = false;
      this.onExit?.();
    }
  };

  onExit?: () => void;

  private onMouse = (e: MouseEvent) => {
    if (!this.active || document.pointerLockElement !== this.el) return;
    this.yaw -= e.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.2, 1.2);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  update(dt: number): void {
    if (!this.active) return;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (move.lengthSq() > 0) move.normalize();
    const v = this.speed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.2 : 1);
    this.camera.position.addScaledVector(move, v * dt);
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -98, 98);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -98, 98);
    this.camera.position.y = this.eyeHeight;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMouse);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
}
