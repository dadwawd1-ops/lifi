const STORAGE_KEY = 'ui-app-runtime-config'

export function loadStoredRuntimeConfig() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveStoredRuntimeConfig(config) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    return null
  }
  return null
}
