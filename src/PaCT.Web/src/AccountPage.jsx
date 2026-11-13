import ClientAccountPage from './ClientAccountPage'
import ManagerAccountPage from './ManagerAccountPage'

export default function AccountPage(props) {
  return props.profile.role === 'Client' ? <ClientAccountPage {...props} /> : <ManagerAccountPage {...props} />
}
