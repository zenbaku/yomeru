/**
 * Vitest setup file.
 *
 * jsdom provides a basic DOM but some APIs (like ImageData constructor and
 * canvas 2d context) need polyfilling for Node.js tests.
 */

// ImageData polyfill for jsdom (which doesn't provide it natively)
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly width: number
    readonly height: number
    readonly data: Uint8ClampedArray

    constructor(width: number, height: number)
    constructor(data: Uint8ClampedArray, width: number, height?: number)
    constructor(
      widthOrData: number | Uint8ClampedArray,
      widthOrHeight: number,
      maybeHeight?: number,
    ) {
      if (widthOrData instanceof Uint8ClampedArray) {
        this.data = widthOrData
        this.width = widthOrHeight
        this.height = maybeHeight ?? (widthOrData.length / 4 / widthOrHeight)
      } else {
        this.width = widthOrData
        this.height = widthOrHeight
        this.data = new Uint8ClampedArray(widthOrData * widthOrHeight * 4)
      }
    }
  }

  ;(globalThis as Record<string, unknown>).ImageData = ImageDataPolyfill
}
