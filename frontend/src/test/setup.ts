import '@testing-library/jest-dom/vitest'

// jsdom does not implement Object URLs — stub them so components that preview
// selected files (URL.createObjectURL / revokeObjectURL) work under test.
if (typeof URL.createObjectURL !== 'function') {
  let seq = 0
  URL.createObjectURL = () => `blob:mock/${++seq}`
  URL.revokeObjectURL = () => {}
}

// jsdom has no pointer capture — the swipe sheets (vaul) call it on every press; browsers do.
// (Files that run without a DOM have no Element at all.)
if (typeof Element !== 'undefined') {
  for (const name of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (typeof Element.prototype[name] !== 'function') Element.prototype[name] = () => {}
  }
  if (typeof Element.prototype.hasPointerCapture !== 'function') Element.prototype.hasPointerCapture = () => false
}
