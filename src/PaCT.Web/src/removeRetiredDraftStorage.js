// Removal of the retired local-draft feature. Never open or recreate this database.
export function removeRetiredDraftStorage() {
  try { window.indexedDB?.deleteDatabase('PaCT.PrivateDrafts.v1') } catch { /* Storage may be unavailable in this browser. */ }
}
