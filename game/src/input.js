// Input: pointer lock for the mouse, a key set, and edge-triggered actions.
// The game reads this once per fixed step; nothing here knows about rounds,
// weapons or menus — it only reports what the player's hands are doing.
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const released = new Set();
  let mouseDX = 0;
  let mouseDY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;

  const onKeyDown = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (e.code === 'Tab') e.preventDefault();
    if (e.code === 'Space') e.preventDefault();
  };
  const onKeyUp = (e) => {
    keys.delete(e.code);
    released.add(e.code);
  };
  const onMouseMove = (e) => {
    if (!locked) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  };
  const onMouseDown = (e) => {
    if (!locked) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  };
  const onMouseUp = (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  };
  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      firing = false;
      aiming = false;
    }
  };
  const onContextMenu = (e) => e.preventDefault();
  const onBlur = () => {
    keys.clear();
    firing = false;
    aiming = false;
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', onBlur);

  return {
    get locked() { return locked; },
    get firing() { return firing; },
    get aiming() { return aiming; },
    isDown(code) { return keys.has(code); },
    wasPressed(code) { return pressed.has(code); },
    wasReleased(code) { return released.has(code); },
    consumeMouse() {
      const dx = mouseDX;
      const dy = mouseDY;
      mouseDX = 0;
      mouseDY = 0;
      return { dx, dy };
    },
    requestLock() {
      if (!locked) {
        try {
          const p = canvas.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch { /* pointer lock unavailable; the game still runs */ }
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    endFrame() {
      pressed.clear();
      released.clear();
    },
    // Test hooks: let automated checks drive the game without a mouse.
    test: {
      press(code) { pressed.add(code); keys.add(code); },
      release(code) { keys.delete(code); released.add(code); },
      setFiring(value) { firing = value; },
      addMouse(dx, dy) { mouseDX += dx; mouseDY += dy; },
    },
  };
}
