import { useState } from 'react'
import { LiveResourceContext } from './liveResourceContext'

export default function LiveResourceProvider({ children }) {
  const [pendingReads] = useState(() => new Map())
  return <LiveResourceContext.Provider value={pendingReads}>{children}</LiveResourceContext.Provider>
}
