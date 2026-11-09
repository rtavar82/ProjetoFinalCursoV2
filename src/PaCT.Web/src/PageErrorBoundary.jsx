import { Component } from 'react'
import ActionButton from './ActionButton'
import Heading from './Heading'

export default class PageErrorBoundary extends Component {
  state = { page: this.props.page, failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps({ page }, state) {
    return page === state.page ? null : { page, failed: false }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return <div className="notice error" role="alert">
      <Heading>Não foi possível mostrar esta página.</Heading>
      <ActionButton variant="secondary" onClick={() => this.setState({ failed: false })}>Voltar a tentar</ActionButton>
    </div>
  }
}
