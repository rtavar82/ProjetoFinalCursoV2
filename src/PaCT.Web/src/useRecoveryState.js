import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ManagerRecoveryContext } from './managerRecoveryContext'

// No provider for clients/visitors: ordinary state, with no private persistence.
export default function useRecoveryState(scope, initial) {
  const recovery = useContext(ManagerRecoveryContext)
  function firstValue() { return recovery && scope ? recovery.get(scope, initial) : typeof initial === 'function' ? initial() : initial }
  const [snapshot, setSnapshot] = useState(() => ({ scope, value: firstValue() }))
  let value = snapshot.value
  if (snapshot.scope !== scope) { value = firstValue(); setSnapshot({ scope, value }) }
  const current = useRef(value), initialValue = useRef(initial)
  useLayoutEffect(() => { initialValue.current = initial }, [initial])
  useLayoutEffect(() => { current.current = value }, [value])
  useEffect(() => { if (!scope || !recovery) return; return recovery.register(scope, next => { current.current = next; setSnapshot({ scope, value: next }) }, () => { const next = typeof initialValue.current === 'function' ? initialValue.current() : initialValue.current; current.current = next; setSnapshot({ scope, value: next }) }) }, [recovery, scope])
  const change = useCallback((update, persist = true) => {
    const next = typeof update === 'function' ? update(current.current) : update
    current.current = next
    if (scope) { if (persist) recovery?.set(scope, next); else recovery?.remove(scope) }
    setSnapshot({ scope, value: next })
  }, [recovery, scope])
  const getCurrent = useCallback(() => current.current, [])
  return [value, change, getCurrent]
}
