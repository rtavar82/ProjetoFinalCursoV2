import { createContext, useContext } from 'react'

export const PrivateDraftContext = createContext(null)
export function usePrivateVault() { return useContext(PrivateDraftContext) }
const writers = new Set()
export function registerDraftWriter(flush) { writers.add(flush); return () => writers.delete(flush) }
export async function flushPrivateDrafts() { await Promise.all([...writers].map(flush => flush())) }
