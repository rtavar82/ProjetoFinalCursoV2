import { individualRequestSteps } from './bookingRequestSteps'
import styles from './BookingRequestNotice.module.css'

export default function BookingRequestNotice({ paymentMode, visitor = false, steps, className = 'notice' }) {
  return <div className={className} role="note" aria-label="O que acontece a seguir">
    <ul className={styles.steps}>{(steps || individualRequestSteps(paymentMode, { visitor })).map(text => <li key={text}>{text}</li>)}</ul>
  </div>
}
