import { cloneElement, isValidElement } from 'react'
/** Keeps each displayed euro amount together without changing its numeric value. */
export default function moneyText(value) {
  if (Array.isArray(value)) return value.map(moneyText)
  if (isValidElement(value)) return value.props.children == null ? value : cloneElement(value, undefined, moneyText(value.props.children))
  if (typeof value !== 'string' || !value.includes('€')) return value
  return value.split(/([−+-]?\d[\d .\u00a0\u202f]*,\d{2}[\s\u00a0\u202f]*€|[−+-]?\d[\d .\u00a0\u202f]*[\s\u00a0\u202f]*€)/g).map((part, index) => part.includes('€') ? <span className="ui-money" key={index}>{part}</span> : part)
}
