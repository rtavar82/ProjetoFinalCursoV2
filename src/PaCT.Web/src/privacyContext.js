import { createContext, useContext } from 'react'

export const PrivacyContext = createContext(null)
export const usePrivacy = () => useContext(PrivacyContext)
