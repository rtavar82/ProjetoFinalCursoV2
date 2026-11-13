import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ActionButton from './ActionButton'
import AppIcon from './AppIcon'
import DialogHeader from './DialogHeader'
import { localDate } from './agendaTime'
import styles from './CalendarInput.module.css'

const pad = value => String(value).padStart(2, '0')
const monthName = new Intl.DateTimeFormat('pt-PT', { month: 'short', timeZone: 'UTC' })
const months = Array.from({ length: 12 }, (_, month) => monthName.format(new Date(Date.UTC(2024, month, 1))).replace(/\.$/, ''))
const periods = ['AM', 'PM']

function fromInput(value, type) {
  const [date, time] = type === 'time' ? ['', value] : value.split('T')
  const [year, month, day] = date ? date.split('-').map(Number) : []
  const [hour = 0, minute = 0] = time ? time.split(':').map(Number) : []
  return { year, month, day, hour: hour % 12 || 12, minute, period: hour >= 12 ? 1 : 0 }
}

function toInput(value, type) {
  const time = pad(value.hour % 12 + value.period * 12) + ':' + pad(value.minute)
  if (type === 'time') return time
  const date = String(value.year).padStart(4, '0') + '-' + pad(value.month) + '-' + pad(value.day)
  return type === 'date' ? date : date + 'T' + time
}

function daysInMonth(year, month) {
  const date = new Date(0)
  date.setUTCFullYear(year, month, 0)
  return date.getUTCDate()
}

function Wheel({ label, value, min, max, onChange, format = pad, wrap = true, editable = false }) {
  const column = useRef(null)
  const gesture = useRef(null)
  const [typed, setTyped] = useState(null)
  function move(start, steps) {
    if (!wrap) return Math.min(max, Math.max(min, start + steps))
    const count = max - min + 1
    return ((start - min + steps) % count + count) % count + min
  }
  useEffect(() => {
    const node = column.current
    function scroll(event) {
      if (!event.deltaY) return
      event.preventDefault()
      setTyped(null)
      onChange(move(value, Math.sign(event.deltaY)))
    }
    const preventTouchScroll = event => event.preventDefault()
    node.addEventListener('wheel', scroll, { passive: false })
    node.addEventListener('touchmove', preventTouchScroll, { passive: false })
    return () => {
      node.removeEventListener('wheel', scroll)
      node.removeEventListener('touchmove', preventTouchScroll)
    }
  })
  function keyDown(event) {
    const steps = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }
    if (event.key in steps) {
      event.preventDefault()
      setTyped(null)
      onChange(move(value, steps[event.key]))
    }
  }
  function startDrag(event) {
    gesture.current = null
    if (event.button !== 0 || event.target instanceof HTMLInputElement) return
    gesture.current = { id: event.pointerId, y: event.clientY, value, steps: 0, moved: false }
    event.target.setPointerCapture(event.pointerId)
  }
  function drag(event) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    const steps = Math.trunc((active.y - event.clientY) / 36)
    if (steps === active.steps) return
    active.steps = steps
    active.moved = true
    setTyped(null)
    onChange(move(active.value, steps))
  }
  function changeText(event) {
    const text = event.target.value.replace(/\D/g, '').slice(0, 4)
    setTyped(text)
    const year = Number(text)
    if (text.length === 4 && year >= min && year <= max) onChange(year)
  }
  const spin = { role: 'spinbutton', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max,
    'aria-valuenow': value, 'aria-valuetext': format(value), onKeyDown: keyDown }
  return <div className={styles.wheel} ref={column} onPointerDown={startDrag} onPointerMove={drag}
    onPointerCancel={() => { gesture.current = null }} onClickCapture={event => {
      if (gesture.current?.moved) { event.preventDefault(); event.stopPropagation() }
      gesture.current = null
    }}>
    {[-1, 0, 1].map(offset => {
      if (offset === 0) return editable
        ? <input key={0} {...spin} className={styles.current} type="text" inputMode="numeric" value={typed ?? format(value)}
          onChange={changeText} onFocus={event => event.currentTarget.select()} onBlur={() => setTyped(null)} />
        : <div key={0} {...spin} className={styles.current} tabIndex={0}>{format(value)}</div>
      const option = move(value, offset)
      return <button key={offset} type="button" className={styles.neighbor} tabIndex={-1}
        aria-label={label + (offset < 0 ? ' anterior' : ' seguinte')} disabled={option === value}
        onClick={() => { setTyped(null); onChange(option) }}>{option === value ? '' : format(option)}</button>
    })}
  </div>
}

function initialValue(input) {
  if (input.value) return input.value
  const now = localDate(new Date())
  const probe = document.createElement('input')
  probe.type = input.type
  probe.min = input.min
  probe.max = input.max
  probe.value = input.type === 'date' ? now.slice(0, 10) : input.type === 'time' ? now.slice(11) : now
  if (probe.validity.rangeUnderflow) return input.min
  if (probe.validity.rangeOverflow) return input.max
  return probe.value
}

function invalidSelection(input, value, excludeMinimum) {
  const probe = document.createElement('input')
  probe.type = input.type
  probe.min = input.min
  probe.max = input.max
  probe.step = input.step
  if (input.hasAttribute('value')) probe.defaultValue = input.defaultValue
  probe.value = value
  if (excludeMinimum && probe.value === probe.min) return 'O fim deve ser posterior ao início.'
  if (!probe.value || !probe.validity.valid) return 'A escolha está fora dos limites deste campo.'
  return ''
}

function CalendarPicker({ input, id, excludeMinimum, onClose, onChoose }) {
  const dialog = useRef(null)
  const type = input.type
  const [original] = useState(() => input.value)
  const [draft, setDraft] = useState(() => fromInput(initialValue(input), type))
  const [changed, setChanged] = useState(false)
  const selected = !changed && original ? original : toInput(draft, type)
  const error = invalidSelection(input, selected, excludeMinimum)
  const title = type === 'date' ? 'Escolher data' : type === 'time' ? 'Escolher hora' : 'Escolher data e hora'
  function change(field, value) {
    setChanged(true)
    setDraft(current => {
      const next = { ...current, [field]: value }
      if (field === 'month' || field === 'year') next.day = Math.min(next.day, daysInMonth(next.year, next.month))
      return next
    })
  }
  useLayoutEffect(() => {
    const node = dialog.current
    node.showModal()
    node.querySelector('[role="spinbutton"]').focus()
    return () => {
      node.close()
      if (input.isConnected) input.focus({ preventScroll: true })
    }
  }, [input])
  return createPortal(<dialog ref={dialog} id={id} className={`ui-dialog ${styles.dialog}`} aria-labelledby={id + '-title'}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onClose={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <DialogHeader title={title} titleId={id + '-title'} className={styles.header} onClose={onClose} />
    <div className={styles.body}>
      {type !== 'time' && <div className={styles.wheels} role="group" aria-label="Data">
        <Wheel label="Mês" value={draft.month} min={1} max={12} format={value => months[value - 1]} onChange={value => change('month', value)} />
        <Wheel label="Dia" value={draft.day} min={1} max={daysInMonth(draft.year, draft.month)} onChange={value => change('day', value)} />
        <Wheel label="Ano" value={draft.year} min={1} max={9999} wrap={false} editable format={value => String(value).padStart(4, '0')} onChange={value => change('year', value)} />
      </div>}
      {type !== 'date' && <div className={styles.wheels} role="group" aria-label="Hora">
        <Wheel label="Hora" value={draft.hour} min={1} max={12} format={String} onChange={value => change('hour', value)} />
        <Wheel label="Minutos" value={draft.minute} min={0} max={59} onChange={value => change('minute', value)} />
        <Wheel label="Período do dia" value={draft.period} min={0} max={1} wrap={false} format={value => periods[value]} onChange={value => change('period', value)} />
      </div>}
      {error && <p role="status" className={styles.error}>{error}</p>}
    </div>
    <footer className={styles.actions}>
      {!input.required && <ActionButton variant="text" className={styles.clear} onClick={() => onChoose('')}>Limpar</ActionButton>}
      <ActionButton variant="secondary" onClick={onClose}>Cancelar</ActionButton>
      <ActionButton disabled={!!error} onClick={() => onChoose(selected)}>Confirmar</ActionButton>
    </footer>
  </dialog>, document.body)
}

// Keep the native input as the form control, including its value, constraints and reset behavior.
export default function CalendarInput({ type = 'datetime-local', ref, excludeMinimum = false, ...props }) {
  const field = useRef(null)
  const id = useId()
  const [activeInput, setActiveInput] = useState(null)
  function bind(element) {
    field.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }
  function show(event) {
    if (event.currentTarget.readOnly || event.currentTarget.matches(':disabled')) return
    event.preventDefault()
    setActiveInput(event.currentTarget)
  }
  function close() {
    setActiveInput(null)
  }
  function choose(value) {
    const input = field.current
    if (input?.isConnected && !input.readOnly && !input.matches(':disabled') && value !== input.value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    close()
  }
  return <span className={styles.field}>
    <input {...props} data-recovery-controlled={props.value !== undefined || undefined} type={type} ref={bind} className={styles.input} aria-haspopup="dialog" aria-expanded={!!activeInput}
      aria-controls={activeInput ? id : undefined} onClick={show}
      onPointerDown={event => { if (!event.currentTarget.readOnly && !event.currentTarget.matches(':disabled')) event.preventDefault() }}
      onKeyDown={event => {
        if (['Enter', ' ', 'F4'].includes(event.key) || event.altKey && event.key === 'ArrowDown') show(event)
      }} />
    <AppIcon name={type === 'time' ? 'clock' : 'calendar'} className={styles.icon} />
    {activeInput && <CalendarPicker input={activeInput} id={id} excludeMinimum={excludeMinimum} onClose={close} onChoose={choose} />}
  </span>
}
