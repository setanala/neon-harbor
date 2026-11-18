const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyP', 'KeyH', 'KeyC', 'KeyN', 'Escape', 'Enter', 'Space',
]);

/** Attach explicitly; creation has no DOM side effects. Coordinates use canvas backing pixels. */
export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, inside: false, buttons: new Set(), pressed: new Set() };
  let attached = false;
  let host = null;
  let doc = null;

  function clear() {
    keys.clear();
    pressed.clear();
    mouse.buttons.clear();
    mouse.pressed.clear();
    mouse.inside = false;
  }
  function editable(event) {
    const target = event.target;
    return target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '');
  }
  function keydown(event) {
    if (editable(event)) return;
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    if (!keys.has(event.code) && !event.repeat) pressed.add(event.code);
    keys.add(event.code);
  }
  function keyup(event) { keys.delete(event.code); }
  function position(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = rect.width ? (event.clientX - rect.left) * canvas.width / rect.width : 0;
    mouse.y = rect.height ? (event.clientY - rect.top) * canvas.height / rect.height : 0;
    mouse.inside = rect.width > 0 && rect.height > 0 && event.clientX >= rect.left
      && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
  }
  function pointerdown(event) {
    position(event);
    if (!mouse.buttons.has(event.button)) mouse.pressed.add(event.button);
    mouse.buttons.add(event.button);
    event.preventDefault();
  }
  function pointerup(event) { position(event); mouse.buttons.delete(event.button); }
  function leave() { mouse.inside = false; }
  function contextmenu(event) { event.preventDefault(); }
  function visibility() { if (doc.hidden) clear(); }

  function attach() {
    if (attached) return;
    doc = canvas.ownerDocument;
    host = doc.defaultView;
    host.addEventListener('keydown', keydown);
    host.addEventListener('keyup', keyup);
    host.addEventListener('blur', clear);
    host.addEventListener('pointermove', position);
    host.addEventListener('pointerup', pointerup);
    host.addEventListener('pointercancel', clear);
    doc.addEventListener('visibilitychange', visibility);
    canvas.addEventListener('pointerdown', pointerdown);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('contextmenu', contextmenu);
    attached = true;
  }
  function detach() {
    if (!attached) { clear(); return; }
    host.removeEventListener('keydown', keydown);
    host.removeEventListener('keyup', keyup);
    host.removeEventListener('blur', clear);
    host.removeEventListener('pointermove', position);
    host.removeEventListener('pointerup', pointerup);
    host.removeEventListener('pointercancel', clear);
    doc.removeEventListener('visibilitychange', visibility);
    canvas.removeEventListener('pointerdown', pointerdown);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('contextmenu', contextmenu);
    attached = false;
    clear();
  }
  return {
    keys, pressed, mouse, attach, detach, clear,
    isDown: (...codes) => codes.some((code) => keys.has(code)),
    wasPressed: (...codes) => codes.some((code) => pressed.has(code)),
    endFrame() { pressed.clear(); mouse.pressed.clear(); },
  };
}
