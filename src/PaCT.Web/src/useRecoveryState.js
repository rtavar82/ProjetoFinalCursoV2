import { useContext, useEffect, useRef, useState } from 'react'
import { ManagerRecoveryContext } from './managerRecoveryContext'

// Without the manager provider these are ordinary, non-persistent React hooks.
export default function useRecoveryState(scope, initial) {
  const recovery = useContext(ManagerRecoveryContext)
  const [value, setValue] = useState(() => recovery ? recovery.get(scope, initial) : typeof initial === 'function' ? initial() : initial)
  const current = useRef(value)
  useEffect(() => recovery?.register(scope, () => current.current), [recovery, scope])
  function change(update) {
    const next = typeof update === 'function' ? update(current.current) : update
    current.current = next; recovery?.set(scope, next); setValue(next)
  }
  return [value, change]
}

export function useRecoveryRef(scope, initial) {
  const recovery = useContext(ManagerRecoveryContext)
  const [reference] = useState(() => {
    let value = recovery?.get(scope, initial) ?? initial
    return { get current() { return value }, set current(next) { value = next; recovery?.set(scope, next) } }
  })
  useEffect(() => recovery?.register(scope, () => reference.current), [recovery, scope, reference])
  return reference
}
