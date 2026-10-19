export type Vec3 = [number, number, number];
export interface Box { min: Vec3; max: Vec3 }

export function rayBox(box: Box, origin: Vec3, direction: Vec3): boolean {
  let near = 1e-8;
  let far = 1 - 1e-8;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-14) {
      if (origin[axis] < box.min[axis] - 1e-10 || origin[axis] > box.max[axis] + 1e-10) return false;
    } else {
      const a = (box.min[axis] - origin[axis]) / direction[axis];
      const b = (box.max[axis] - origin[axis]) / direction[axis];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far + 1e-12) return false;
    }
  }
  return true;
}

export function unionBounds(boxes: Box[]): Box {
  if (!boxes.length) throw new RangeError('Cannot bound an empty geometry');
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], box.min[axis]);
    max[axis] = Math.max(max[axis], box.max[axis]);
  }
  return { min, max };
}

export function createSceneIndex<T extends { bounds: Box }>(items: T[]) {
  const build = (members: T[]): {
    bounds: Box;
    items: T[];
    children: ReturnType<typeof build>[];
  } => {
    const bounds = unionBounds(members.map(item => item.bounds));
    if (members.length <= 4) return { bounds, items: members, children: [] };
    const axis = [0, 1, 2].sort((a, b) => (
      bounds.max[b] - bounds.min[b] - (bounds.max[a] - bounds.min[a])
    ))[0];
    const sorted = members.slice().sort((a, b) => (
      a.bounds.min[axis] + a.bounds.max[axis] - b.bounds.min[axis] - b.bounds.max[axis]
    ));
    const middle = Math.floor(sorted.length / 2);
    return { bounds, items: [], children: [build(sorted.slice(0, middle)), build(sorted.slice(middle))] };
  };
  const root = items.length ? build(items) : null;
  return (origin: Vec3, direction: Vec3, hit: (item: T) => boolean): boolean => {
    const visit = (node: NonNullable<typeof root>): boolean => {
      if (!rayBox(node.bounds, origin, direction)) return false;
      if (node.children.length) return node.children.some(visit);
      return node.items.some(item => rayBox(item.bounds, origin, direction) && hit(item));
    };
    return root ? visit(root) : false;
  };
}
