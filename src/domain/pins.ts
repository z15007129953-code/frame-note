export type Pin = { x: number; y: number };
export type ImageRect = { left: number; top: number; width: number; height: number };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function point(value: unknown): value is Pin {
  return record(value) && finite(value.x) && finite(value.y);
}
function rectangle(value: unknown): value is ImageRect {
  return record(value) && finite(value.left) && finite(value.top)
    && finite(value.width) && finite(value.height)
    && value.width > 0 && value.height > 0
    && Number.isFinite(value.left + value.width)
    && Number.isFinite(value.top + value.height);
}

export function isValidPin(value: unknown): value is Pin {
  return point(value) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}

/** Use the rendered image bounds, excluding the surrounding stage/letterbox. */
export function normalizePin(position: Pin, image: ImageRect): Pin | null {
  if (!point(position) || !rectangle(image)) return null;
  const right = image.left + image.width;
  const bottom = image.top + image.height;
  if (position.x < image.left || position.x > right || position.y < image.top || position.y > bottom) return null;
  // Exact far-edge hits stay inclusive despite fractional CSS-pixel arithmetic.
  const pin = {
    x: position.x === right ? 1 : (position.x - image.left) / image.width,
    y: position.y === bottom ? 1 : (position.y - image.top) / image.height,
  };
  return isValidPin(pin) ? pin : null;
}

/** Project a version-specific stored pin into viewport CSS pixels after resizing. */
export function projectPin(pin: Pin, image: ImageRect): Pin | null {
  if (!isValidPin(pin) || !rectangle(image)) return null;
  const position = { x: image.left + pin.x * image.width, y: image.top + pin.y * image.height };
  return point(position) ? position : null;
}
