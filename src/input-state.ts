export type InputOwner = { ticketId: string; generation: number; token: string };
export type InputSink = {
  keyEvent: (keysym: number, down: boolean) => void;
  pointerEvent: (x: number, y: number, buttons: number) => void;
};
export class HeldInput {
  owner: InputOwner | null = null;
  private keys = new Set<number>();
  private position = { x: 0, y: 0, buttons: 0 };
  release(sink: InputSink) {
    const keys = [...this.keys],
      position = this.position;
    this.keys.clear();
    this.position = { ...position, buttons: 0 };
    this.owner = null;
    for (const key of keys) sink.keyEvent(key, false);
    if (position.buttons) sink.pointerEvent(position.x, position.y, 0);
  }
  select(sink: InputSink, owner: InputOwner) {
    if (this.owner?.ticketId !== owner.ticketId || this.owner.generation !== owner.generation)
      this.release(sink);
    this.owner = owner;
  }
  key(sink: InputSink, keysym: number, down: boolean) {
    if (!Number.isInteger(keysym) || keysym < 0 || keysym > 0x1fffffff || typeof down !== "boolean")
      return false;
    if (down && this.keys.size >= 32 && !this.keys.has(keysym)) return false;
    sink.keyEvent(keysym, down);
    if (down) this.keys.add(keysym);
    else this.keys.delete(keysym);
    return true;
  }
  pointer(sink: InputSink, x: number, y: number, buttons: number, width: number, height: number) {
    if (
      ![x, y, buttons].every(Number.isInteger) ||
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height ||
      buttons < 0 ||
      buttons > 255
    )
      return false;
    sink.pointerEvent(x, y, buttons);
    this.position = { x, y, buttons };
    return true;
  }
}
