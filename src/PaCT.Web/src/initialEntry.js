// Only a document startup resets ordinary navigation. In-app navigation is unchanged.
export function prepareInitialEntry(browser = window) {
  const { location, history, performance } = browser
  const hash = location.hash
  const linkedDestination = hash.includes('=') || hash.includes('?')
    || new URLSearchParams(location.search).get('view') === 'payments'
  if (linkedDestination) return
  const navigation = performance.getEntriesByType('navigation')[0]?.type
  if (history.state?.workspace || history.state?.returnTo || navigation === 'reload' || navigation === 'back_forward') {
    history.replaceState(null, '', location.pathname + location.search)
  }
}
