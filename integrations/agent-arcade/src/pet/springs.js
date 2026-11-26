// Secondary motion for hair, ribbons, drops and the skirt. Bones that carry
// `extras.spring` in the model are simulated as damped pendulums and pushed
// out of the sphere colliders; the result is written back as bone rotations.
import * as THREE from '../vendor/three/build/three.module.js';

const STEP = 1 / 60, MAX_STEPS = 4, HIT = 0.022;
const a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), inverse = new THREE.Matrix4();

export class Springs {
  constructor(stage) {
    this.joints = []; this.colliders = []; this.pending = 0; this.gravity = new THREE.Vector3(0, -1, 0); this.strength = 1;
    stage.root.updateMatrixWorld(true);
    stage.root.traverse(node => {
      if (!node.isBone) return;
      if (node.userData.collider) this.colliders.push({node, radius: node.userData.collider.radius, centre: new THREE.Vector3()});
      const spring = node.userData.spring;
      if (!spring) return;
      const child = node.children.find(c => c.isBone && c.userData.spring);
      const origin = node.getWorldPosition(new THREE.Vector3());
      // Rest tail in the bone's own frame; bones have no rest rotation, so the
      // offset in the bind pose is already that vector.
      const local = child ? child.position.clone() : new THREE.Vector3().fromArray(spring.tail).sub(stage.root.worldToLocal(origin.clone()));
      const tail = node.localToWorld(local.clone());
      this.joints.push({node, spring, axis: local.clone().normalize(), length: local.length(), tail, previous: tail.clone(), rest: node.quaternion.clone()});
    });
  }
  // Moves every tail by a world-space offset; used when the window itself is
  // dragged so that hair lags behind the hand.
  shift(dx, dy) {
    const limit = 0.12, x = Math.max(-limit, Math.min(limit, dx)), y = Math.max(-limit, Math.min(limit, dy));
    for (const joint of this.joints) { joint.tail.x += x; joint.tail.y += y; joint.previous.x += x * 0.6; joint.previous.y += y * 0.6; }
  }
  reset() {
    for (const joint of this.joints) {
      joint.node.quaternion.copy(joint.rest); joint.node.updateWorldMatrix(true, false);
      joint.tail.copy(joint.axis).multiplyScalar(joint.length); joint.node.localToWorld(joint.tail); joint.previous.copy(joint.tail);
    }
  }
  update(dt) {
    this.pending = Math.min(this.pending + dt, STEP * MAX_STEPS);
    while (this.pending >= STEP) { this.pending -= STEP; this.step(); }
  }
  step() {
    for (const collider of this.colliders) collider.node.getWorldPosition(collider.centre);
    for (const joint of this.joints) {
      const {node, spring} = joint, parent = node.parent;
      parent.updateWorldMatrix(false, false);
      const origin = a.copy(node.position).applyMatrix4(parent.matrixWorld);
      // Where the tail would rest given the parent's current orientation.
      parent.getWorldQuaternion(q);
      const restDirection = b.copy(joint.axis).applyQuaternion(q);
      const next = new THREE.Vector3().copy(joint.tail)
        .addScaledVector(joint.tail.clone().sub(joint.previous), 1 - spring.drag * 0.42)
        .addScaledVector(restDirection, spring.stiffness * STEP)
        .addScaledVector(this.gravity, spring.gravity * STEP * 0.5);
      next.sub(origin).setLength(joint.length).add(origin);
      for (const collider of this.colliders) {
        const reach = collider.radius + HIT, offset = next.clone().sub(collider.centre);
        if (offset.lengthSq() < reach * reach) { next.copy(collider.centre).addScaledVector(offset.normalize(), reach); next.sub(origin).setLength(joint.length).add(origin); }
      }
      joint.previous.copy(joint.tail); joint.tail.copy(next);
      // Rotation that takes the rest axis to the simulated direction, in the
      // parent's frame, eased by `strength` (0 keeps the bind pose).
      const direction = next.clone().applyMatrix4(inverse.copy(parent.matrixWorld).invert()).sub(node.position).normalize();
      q.setFromUnitVectors(joint.axis, direction);
      node.quaternion.copy(joint.rest).slerp(q, this.strength);
      node.updateWorldMatrix(false, false);
    }
  }
}
