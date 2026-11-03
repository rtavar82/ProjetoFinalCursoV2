export default function Heading({ level = 2, appearance, children, ...props }) {
  const Element = `h${level}`
  return <Element {...props} data-typography={appearance}>{children}</Element>
}
