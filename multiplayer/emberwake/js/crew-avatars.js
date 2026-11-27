import * as THREE from '../vendor/three.module.min.js';

// Every voyager wears a distinct coat and carries the same canvas shoulder bag.
export class CrewAvatars {
  constructor(scene) {
    this.scene = scene;
    this.people = new Map();
    this.cube = new THREE.BoxGeometry();
    this.materials = new Map();
  }
  sailor(peer) {
    const group = new THREE.Group();
    const box = (x, y, z, w, h, d, color) => {
      if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshLambertMaterial({ color }));
      const mesh = new THREE.Mesh(this.cube, this.materials.get(color));
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      group.add(mesh);
      return mesh;
    };
    const skin = ['#aa694e', '#e5b794', '#875e4d', '#c18c6e'][peer.number % 4];
    box(0, 1.02, 0, 0.52, 0.67, 0.34, peer.color);
    box(0, 1.54, -0.01, 0.4, 0.39, 0.38, skin);
    box(0, 1.76, 0, 0.46, 0.17, 0.43, '#243648');
    box(0, 1.69, -0.15, 0.49, 0.08, 0.32, peer.color);
    box(0, 1.28, -0.185, 0.45, 0.085, 0.05, '#f7dbad');
    box(0.1, 1.05, 0.23, 0.32, 0.41, 0.17, '#b07446');
    const legs = [],
      arms = [];
    for (const sign of [-1, 1]) {
      box(sign * 0.095, 1.55, -0.21, 0.045, 0.05, 0.025, '#342b2a');
      arms.push(box(sign * 0.335, 1.01, 0, 0.15, 0.53, 0.21, peer.color));
      box(sign * 0.335, 0.72, 0, 0.14, 0.15, 0.17, skin);
      legs.push(box(sign * 0.145, 0.37, 0, 0.225, 0.65, 0.25, '#294354'));
      box(sign * 0.145, 0.09, -0.06, 0.23, 0.18, 0.34, '#493a36');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#17222ee8';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = peer.color;
    ctx.fillRect(0, 55, 256, 7);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 33px system-ui';
    ctx.fillStyle = '#fff6e4';
    ctx.fillText(peer.name, 128, 29, 246);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    tag.scale.set(1.6, 0.4, 1);
    tag.position.y = 2.12;
    group.add(tag);
    group.position.set(peer.x, peer.y, peer.z);
    this.scene.add(group);
    return { group, legs, arms, tag, phase: 0 };
  }
  update(peers, dt) {
    for (const [id, person] of this.people) {
      if (peers.some(p => p.number === id)) continue;
      this.scene.remove(person.group);
      person.tag.material.map.dispose();
      person.tag.material.dispose();
      this.people.delete(id);
    }
    for (const peer of peers) {
      if (!this.people.has(peer.number)) this.people.set(peer.number, this.sailor(peer));
      const p = this.people.get(peer.number),
        v = p.group.position;
      const dist = Math.hypot(peer.x - v.x, peer.z - v.z);
      const blend = dist > 3 ? 1 : 1 - Math.exp(-dt * 20);
      v.x += (peer.x - v.x) * blend;
      v.y += (peer.y - v.y) * blend;
      v.z += (peer.z - v.z) * blend;
      p.group.rotation.y = peer.yaw;
      const walking = dist > 0.025 && peer.boat === null;
      if (walking) p.phase += dt * 10;
      p.legs.forEach((leg, i) => {
        leg.rotation.x = walking ? Math.sin(p.phase + i * Math.PI) * 0.36 : 0;
        p.arms[i].rotation.x = -leg.rotation.x;
      });
    }
  }
  dispose() {
    this.update([], 0);
    this.cube.dispose();
    for (const material of this.materials.values()) material.dispose();
  }
}
