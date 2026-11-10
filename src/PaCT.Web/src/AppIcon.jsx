const paths = {
  tasks: <><path d="m3 6 2 2 3-3m-5 8 2 2 3-3m3-5h10m-10 7h10m-10 7h10" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></>,
  home: <path d="M10.5 3.8a2.5 2.5 0 0 1 3 0l7 5.4c.6.5 1 1.2 1 2v8.3a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5v-8.3c0-.8.4-1.5 1-2Z" />,
  calendar: <path fillRule="evenodd" d="M7 2a1 1 0 0 1 1 1v2h8V3a1 1 0 1 1 2 0v2h1a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1ZM4 9v2h16V9Zm2 5v2h2v-2Zm5 0v2h2v-2Zm5 0v2h2v-2ZM6 18v2h2v-2Zm5 0v2h2v-2Z" />,
  people: <><circle cx="9" cy="7" r="4" /><circle cx="18" cy="8" r="3" /><path d="M1 21v-2a8 8 0 0 1 16 0v2Zm17 0v-2c0-1.7-.4-3.4-1.2-4.8A6 6 0 0 1 23 20v1Z" /></>,
  user: <><circle cx="12" cy="7" r="4" /><path d="M3 21v-1a9 9 0 0 1 18 0v1Z" /></>,
  clock: <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l4.5 3 1.1-1.7-3.6-2.4Z" />,
  wallet: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 9h18m-5 4h5v4h-5z" /></>,
  arrow: <path d="M3 11h14l-5-5 1.5-1.5L21 12l-7.5 7.5L12 18l5-5H3Z" />,
  arrowDown: <path d="M11 3h2v14l5-5 1.5 1.5L12 21l-7.5-7.5L6 12l5 5Z" />,
  reset: <><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7" /></>,
  leaf: <path d="M22 2C11 1 4 6 4 13c0 2 .7 3.6 1.8 4.7l-3.5 3.5 1.4 1.4 3.8-3.8c3.8 2.2 9 .5 11.4-3.6C21 11.6 22 5.3 22 2Z" />,
  pin: <path fillRule="evenodd" d="M12 2a8 8 0 0 0-8 8c0 5.4 6.8 11.4 7.1 11.7a1.3 1.3 0 0 0 1.8 0c.3-.3 7.1-6.3 7.1-11.7a8 8 0 0 0-8-8Zm0 5.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z" />,
  video: <><rect x="2" y="5" width="14" height="14" rx="3" /><path d="m15 10 7-4v12l-7-4Z" /></>,
  play: <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />,
  comment: <path d="M20.5 11.5a8.5 8.5 0 0 1-12.3 7.6L3 20.5l1.4-5.1a8.5 8.5 0 1 1 16.1-3.9Z" />,
  heart: <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />,
  sparkles: <path d="M10.4 3.7a.8.8 0 0 1 1.5 0l1.6 4.8 4.8 1.6a.8.8 0 0 1 0 1.5l-4.8 1.6-1.6 4.8a.8.8 0 0 1-1.5 0l-1.6-4.8L4 11.6a.8.8 0 0 1 0-1.5l4.8-1.6ZM18.7 2l.8 2.4 2.5.9-2.5.8-.8 2.5-.9-2.5-2.4-.8 2.4-.9ZM5.2 15.4l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9Z" />,
  instagram: <path fillRule="evenodd" d="M8 2h8a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6Zm4 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM17.5 5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" />,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z" />,
  whatsapp: <path fillRule="evenodd" d="M22 11.7A10 10 0 0 1 7.7 21L2 22.5l1.6-5.6A10 10 0 1 1 22 11.7Zm-13.8-5c-1.5.1-2.4 1.9-1.5 3.9 1.6 3.5 4.2 5.6 7.1 6.5 1.9.6 3.6-.3 3.6-1.9l-3-1.8-1.4 1.3c-1.8-.9-3.2-2.3-4-4l1.2-1.3-1.3-2.7Z" />,
  eye: <path fillRule="evenodd" d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12Zm11-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />,
  eyeOff: <><path fillRule="evenodd" d="M1 12a18 18 0 0 1 4-4.4L7 9.4a5.5 5.5 0 0 0 7.6 7.5l1.7 1.7a12 12 0 0 1-4.3.7C5 19.3 1 12 1 12Zm22 0a18 18 0 0 1-4 4.4l-2-2a5.5 5.5 0 0 0-7.4-7.5L7.8 5.2A12 12 0 0 1 12 4.7c7 0 11 7.3 11 7.3Z" /><path d="m3 2 19 19-1.4 1.4-19-19Z" /></>,
}

const solid = new Set(['home', 'calendar', 'people', 'user', 'clock', 'arrow', 'arrowDown', 'leaf', 'pin', 'video', 'comment', 'heart', 'sparkles', 'instagram', 'phone', 'whatsapp', 'eye', 'eyeOff'])

export default function AppIcon({ name, className = '' }) {
  const filled = solid.has(name)
  return <svg className={className} data-ui="icon" width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}
