const appearances = { secondary: 'secondary', text: 'text-button', tinted: 'tinted-button' }

export default function ActionButton({ variant = 'primary', type = 'button', className = '', children, ...props }) {
  const appearance = appearances[variant] || ''
  return <button {...props} type={type} className={`${appearance} ${className}`}>{children}</button>
}
