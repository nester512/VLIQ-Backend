import '@testing-library/jest-dom'

// jsdom does not implement Object URLs — stub them so components that preview
// selected files (URL.createObjectURL / revokeObjectURL) work under test.
if (typeof URL.createObjectURL !== 'function') {
  let seq = 0
  URL.createObjectURL = () => `blob:mock/${++seq}`
  URL.revokeObjectURL = () => {}
}
