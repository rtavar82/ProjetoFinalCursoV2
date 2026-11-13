import { useLayoutEffect, useRef } from 'react'
import ActionButton from './ActionButton'
import AppArrow from './AppArrow'
import InformationCard from './InformationCard'
import styles from './ListDetailLayout.module.css'

export default function ListDetailLayout({ label, list, detailOpen = false, selectedId, onBack, disabled = false, detailLabel = 'Detalhe do registo', emptyLabel = 'Seleciona um registo para consultar os dados.', children }) {
  const results = useRef(null), detail = useRef(null)
  const previous = useRef({ detailOpen, selectedId })
  useLayoutEffect(() => {
    const changed = previous.current.detailOpen !== detailOpen || previous.current.selectedId !== selectedId
    if (changed && detailOpen) {
      detail.current?.focus({ preventScroll: true })
      if (results.current && getComputedStyle(results.current).display === 'none') detail.current?.scrollIntoView({ block: 'start' })
    } else if (changed && !detailOpen && previous.current.selectedId) {
      const row = results.current?.querySelector(`[data-list-id="${CSS.escape(previous.current.selectedId)}"]`)
      row?.focus({ preventScroll: true })
      row?.scrollIntoView({ block: 'nearest' })
    }
    previous.current = { detailOpen, selectedId }
  }, [detailOpen, selectedId])
  return <section className={styles.layout} aria-label={label} data-ui="list-detail" data-detail-open={detailOpen}>
    <div className={styles.workspace}>
      <div className={styles.list} ref={results}>{list}</div>
      <div className={styles.detail} ref={detail} tabIndex={-1} aria-label={detailLabel}>
        <InformationCard cardId="directory-detail" className={styles.panel}>
          {detailOpen ? <>
            <ActionButton variant="text" className={styles.back} disabled={disabled} onClick={onBack}><AppArrow direction="left" />Voltar aos resultados</ActionButton>
            {children}
          </> : <p className={styles.empty}>{emptyLabel}</p>}
        </InformationCard>
      </div>
    </div>
  </section>
}
