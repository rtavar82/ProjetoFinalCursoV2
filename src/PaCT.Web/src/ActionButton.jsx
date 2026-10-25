export default function ActionButton({ variant = 'primary', type = 'button', className = '', children, ...props }) {
  const appearance = variant === 'secondary' ? 'secondary' : variant === 'text' ? 'text-button' : ''
  return <button {...props} type={type} className={`${appearance} ${className}`}>{children}</button>
}
