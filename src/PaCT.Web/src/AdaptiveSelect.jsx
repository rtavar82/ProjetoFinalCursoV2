import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './AdaptiveSelect.module.css'

const minimumFont = 12
const optionsOf = select => Array.from(select.options).filter(option => !option.hidden).map(option => ({
  index: option.index, value: option.value, text: option.text, disabled: option.disabled || option.parentElement?.disabled,
}))

function fieldLabel(select) {
  const named = select.getAttribute('aria-label')
  if (named) return named
  const labelled = select.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')
  if (labelled) return labelled
  const label = select.labels?.[0]?.cloneNode(true)
  label?.querySelectorAll('select, input, button, textarea').forEach(element => element.remove())
  return label?.textContent.trim() || 'Escolher opção'
}

function SelectPicker({ id, select, onClose, onChoose }) {
  const dialog = useRef(null), list = useRef(null)
  const [options, setOptions] = useState(() => optionsOf(select))
  const [active, setActive] = useState(select.selectedIndex)
  const typing = useRef({ text: '', at: 0 })
  const label = fieldLabel(select)

  useLayoutEffect(() => {
    const element = dialog.current
    element.showModal()
    list.current.focus()
    return () => element.close()
  }, [])
  useEffect(() => {
    const observer = new MutationObserver(() => setOptions(optionsOf(select)))
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'label', 'value'] })
    return () => observer.disconnect()
  }, [select])
  useLayoutEffect(() => {
    const element = dialog.current, source = getComputedStyle(select)
    const context = document.createElement('canvas').getContext('2d')
    const base = Math.max(minimumFont, parseFloat(source.fontSize) || 16)
    element.style.fontFamily = source.fontFamily
    function fit() {
      for (const text of element.querySelectorAll('[data-option-text]')) {
        const available = text.getBoundingClientRect().width - 2
        if (!context || available <= 0) continue
        const weight = getComputedStyle(text).fontWeight
        context.font = `${weight} ${base}px ${source.fontFamily}`
        const width = context.measureText(text.textContent).width
        const size = Math.max(minimumFont, Math.floor(Math.min(base, base * available / Math.max(width, 1)) * 10) / 10)
        text.style.fontSize = `${size}px`
        context.font = `${weight} ${size}px ${source.fontFamily}`
        text.style.whiteSpace = context.measureText(text.textContent).width <= available ? 'nowrap' : 'normal'
      }
    }
    fit()
    let width = element.clientWidth, frame
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return
      width = element.clientWidth
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [select, options])
  useEffect(() => {
    list.current.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(option) {
    if (option.disabled || !select.isConnected || select.matches(':disabled')) return
    onChoose(option.index)
  }
  function keydown(event) {
    event.stopPropagation()
    const enabled = options.filter(option => !option.disabled)
    if (!enabled.length) return
    const position = enabled.findIndex(option => option.index === active)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : Math.min(enabled.length - 1, Math.max(0, position + (event.key === 'ArrowDown' ? 1 : -1)))
      setActive(enabled[next].index)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = enabled.find(option => option.index === active)
      if (option) choose(option)
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      const prefix = now - typing.current.at < 700 ? typing.current.text + event.key : event.key
      typing.current = { text: prefix, at: now }
      const option = enabled.find(option => option.text.toLocaleLowerCase('pt-PT').startsWith(prefix.toLocaleLowerCase('pt-PT')))
      if (option) setActive(option.index)
    }
  }
  return createPortal(<dialog ref={dialog} className={styles.picker} aria-labelledby={id + '-label'}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onClose={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === dialog.current) onClose() }}>
    <header className={styles.header}><h2 id={id + '-label'}>{label}</h2><button type="button" className={styles.close} aria-label="Fechar opções" onClick={onClose}>×</button></header>
    <div ref={list} id={id + '-list'} className={styles.list} role="listbox" tabIndex={0} aria-labelledby={id + '-label'}
      aria-activedescendant={options.some(option => option.index === active) ? id + '-' + active : undefined} onKeyDown={keydown}>
      {options.map(option => <div key={option.index} id={id + '-' + option.index} role="option" aria-selected={option.index === select.selectedIndex}
        aria-disabled={option.disabled || undefined} data-option-index={option.index} className={`${styles.option} ${active === option.index ? styles.active : ''}`}
        onClick={() => choose(option)}>
        <span data-option-text className={styles.text}>{option.text}</span><span className={styles.indicator} aria-hidden="true" />
      </div>)}
    </div>
  </dialog>, document.body)
}

export default function AdaptiveSelect({ onPointerDown, onClick, onKeyDown, onChange, ref, ...props }) {
  const select = useRef(null)
  const id = useId()
  const [openedSelect, setOpenedSelect] = useState(null)
  function bind(element) { select.current = element; if (typeof ref === 'function') ref(element); else if (ref) ref.current = element }
  function close() { setOpenedSelect(null); if (select.current?.isConnected) select.current.focus({ preventScroll: true }) }
  function canOpen(element) { return !props.multiple && !(props.size > 1) && !element.matches(':disabled') }
  function choose(index) {
    const element = select.current, option = element?.options[index]
    if (!option || option.disabled || option.parentElement?.disabled || !canOpen(element)) return
    // Keep the native form control, React's change event, and browser validation.
    element.selectedIndex = index
    element.dispatchEvent(new Event('change', { bubbles: true }))
    close()
  }
  return <>
    <select {...props} ref={bind} aria-expanded={!!openedSelect} aria-haspopup="dialog" aria-controls={openedSelect ? id + '-list' : undefined} onChange={event => { onChange?.(event); setOpenedSelect(null) }}
      onPointerDown={event => { onPointerDown?.(event); if (!event.defaultPrevented && canOpen(event.currentTarget)) { event.preventDefault(); if (event.pointerType !== 'touch') setOpenedSelect(event.currentTarget) } }}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented && canOpen(event.currentTarget)) { event.preventDefault(); setOpenedSelect(event.currentTarget) } }}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && canOpen(event.currentTarget) && (['Enter', ' ', 'F4'].includes(event.key) || event.altKey && event.key === 'ArrowDown')) { event.preventDefault(); setOpenedSelect(event.currentTarget) } }} />
    {openedSelect && <SelectPicker id={id} select={openedSelect} onClose={close} onChoose={choose} />}
  </>
}
