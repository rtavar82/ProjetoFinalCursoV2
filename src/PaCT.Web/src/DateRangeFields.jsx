import { useEffect, useRef, useState } from 'react'

// One interaction for date/date-time pairs. Presets remain the owner's responsibility.
export default function DateRangeFields({ startLabel, endLabel, type = 'datetime-local', startName = 'start', endName = 'end', defaultValue = { start: '', end: '' }, value, onChange, required = false, min, exclusive = false, ordered = true }) {
  const [draft, setDraft] = useState(() => ({ ...defaultValue }))
  const endEdited = useRef(false)
  const endInput = useRef(null)
  const current = value ?? draft
  function change(field, text) {
    if (!current.start && !current.end) endEdited.current = false
    const next = { ...current, [field]: text }
    if (field === 'end') endEdited.current = true
    else if (!endEdited.current || ordered && next.end && next.end < text) next.end = text
    setDraft(next)
    onChange?.(next, field)
  }
  useEffect(() => {
    const invalid = ordered && current.start && current.end && (exclusive ? current.end <= current.start : current.end < current.start)
    endInput.current?.setCustomValidity(invalid ? exclusive ? 'O fim deve ser posterior ao início.' : 'O fim não pode ser anterior ao início.' : '')
  }, [current.start, current.end, exclusive, ordered])
  useEffect(() => {
    const form = endInput.current?.form
    function reset() { endEdited.current = false; setDraft({ ...defaultValue }) }
    form?.addEventListener('reset', reset)
    return () => form?.removeEventListener('reset', reset)
  }, [defaultValue])
  return <>
    <label>{startLabel}<input name={startName} type={type} required={required} min={min} value={current.start} onChange={event => change('start', event.target.value)} /></label>
    <label>{endLabel}<input ref={endInput} name={endName} type={type} required={required} min={ordered ? current.start || min : min} value={current.end} onChange={event => change('end', event.target.value)} /></label>
  </>
}
