import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Não foi possível apresentar o painel de resultados.', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="app-shell">
        <h1>Não foi possível apresentar os resultados</h1>
        <p role="alert">
          O painel encontrou um erro. Nenhum resultado deve ser interpretado como zero.
          Recarregue a página ou consulte os dados diretamente no TSE.
        </p>
        <button className="app-action" onClick={() => window.location.reload()}>
          Recarregar página
        </button>{' '}
        <a href="https://resultados.tse.jus.br/oficial/app/index.html">
          Consultar o TSE
        </a>
      </main>
    )
  }
}
