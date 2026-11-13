const paths = {
  bank: <path d="M248,208a8,8,0,0,1-8,8H16a8,8,0,0,1,0-16H240A8,8,0,0,1,248,208ZM16.3,98.18a8,8,0,0,1,3.51-9l104-64a8,8,0,0,1,8.38,0l104,64A8,8,0,0,1,232,104H208v64h16a8,8,0,0,1,0,16H32a8,8,0,0,1,0-16H48V104H24A8,8,0,0,1,16.3,98.18ZM144,160a8,8,0,0,0,16,0V112a8,8,0,0,0-16,0Zm-48,0a8,8,0,0,0,16,0V112a8,8,0,0,0-16,0Z" />,
  conversations: <path d="M232.07,186.76a80,80,0,0,0-62.5-114.17A80,80,0,1,0,23.93,138.76l-7.27,24.71a16,16,0,0,0,19.87,19.87l24.71-7.27a80.39,80.39,0,0,0,25.18,7.35,80,80,0,0,0,108.34,40.65l24.71,7.27a16,16,0,0,0,19.87-19.86Zm-16.25,1.47L224,216l-27.76-8.17a8,8,0,0,0-6,.63,64.05,64.05,0,0,1-85.87-24.88A79.93,79.93,0,0,0,174.7,89.71a64,64,0,0,1,41.75,92.48A8,8,0,0,0,215.82,188.23Z" />,
  tasks: <path d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM117.66,149.66l-32,32a8,8,0,0,1-11.32,0l-16-16a8,8,0,0,1,11.32-11.32L80,164.69l26.34-26.35a8,8,0,0,1,11.32,11.32Zm0-64-32,32a8,8,0,0,1-11.32,0l-16-16A8,8,0,0,1,69.66,90.34L80,100.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM192,168H144a8,8,0,0,1,0-16h48a8,8,0,0,1,0,16Zm0-64H144a8,8,0,0,1,0-16h48a8,8,0,0,1,0,16Z" />,
  settings: <><path d="M3 6h18v2H3Zm0 10h18v2H3Z" /><circle cx="8" cy="7" r="4" /><circle cx="16" cy="17" r="4" /></>,
  home: <path d="M10.5 3.8a2.5 2.5 0 0 1 3 0l7 5.4c.6.5 1 1.2 1 2v8.3a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5v-8.3c0-.8.4-1.5 1-2Z" />,
  calendar: <path fillRule="evenodd" d="M7 2a1 1 0 0 1 1 1v2h8V3a1 1 0 1 1 2 0v2h1a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1ZM4 9v2h16V9Zm2 5v2h2v-2Zm5 0v2h2v-2Zm5 0v2h2v-2ZM6 18v2h2v-2Zm5 0v2h2v-2Z" />,
  people: <><circle cx="9" cy="7" r="4" /><circle cx="18" cy="8" r="3" /><path d="M1 21v-2a8 8 0 0 1 16 0v2Zm17 0v-2c0-1.7-.4-3.4-1.2-4.8A6 6 0 0 1 23 20v1Z" /></>,
  user: <><circle cx="12" cy="7" r="4" /><path d="M3 21v-1a9 9 0 0 1 18 0v1Z" /></>,
  clock: <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l4.5 3 1.1-1.7-3.6-2.4Z" />,
  wallet: <path fillRule="evenodd" d="M5 3h14a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v1h16V6a1 1 0 0 0-1-1Zm12 6a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h3v-5Z" />,
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

// Bank, conversations and task list: Phosphor Icons 2.1.1 (fill), MIT; /licenses/phosphor-icons.txt.
const largeViewBox = new Set(['bank', 'conversations', 'tasks'])
const solid = new Set(['bank', 'conversations', 'tasks', 'settings', 'wallet', 'home', 'calendar', 'people', 'user', 'clock', 'leaf', 'pin', 'video', 'comment', 'heart', 'sparkles', 'instagram', 'phone', 'whatsapp', 'eye', 'eyeOff'])

export default function AppIcon({ name, className = '' }) {
  const filled = solid.has(name)
  return <svg className={className} data-ui="icon" width="20" height="20" viewBox={largeViewBox.has(name) ? '0 0 256 256' : '0 0 24 24'} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}
