import { useQuery } from '@tanstack/react-query'
import { loadMetadata } from '../data/tse/client'
import { useSelection } from '../hooks/useSelection'
import { GeographyNavigation } from './GeographyNavigation'
import { ResultView } from './ResultView'
import '../styles/app.css'

export default function App() {
  const navigation = useSelection()
  const metadata = useQuery({
    queryKey: ['metadata', '2026', '2'],
    queryFn: ({ signal }) => loadMetadata(signal),
    enabled: navigation.error === null,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  })

  return (
    <div className="app-shell">
      <a href="#conteudo" className="app-skip">Ir para os resultados</a>
      <header>
        <div className="app-masthead">
          <div className="app-brand">
            <span className="app-brand-mark" aria-hidden="true">◇</span>
            Brasil em votos
          </div>
          <span className="app-masthead-note">Painel independente<br />Fontes oficiais</span>
        </div>
        <div className="app-hero">
          <p className="app-kicker">Presidente da República · Segundo turno</p>
          <h1>Eleições 2026</h1>
          <p className="app-hero-subtitle">Um país. Cada voto. Todos os detalhes.</p>
          <p className="app-hero-description">
            Acompanhe a apuração no Brasil e no exterior, do total geral à sua cidade
            ou país de votação. Dados publicados pelo Tribunal Superior Eleitoral.
          </p>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1}>
        {navigation.error && (
          <div className="app-status app-status-error" role="alert">
            <h2>Localidade inválida</h2>
            <p>{navigation.error.message}</p>
            <button className="app-action" onClick={() => navigation.navigate({ scope: 'overall' })}>
              Voltar ao total geral
            </button>
          </div>
        )}
        {!navigation.error && !metadata.data && metadata.isPending && (
          <div className="app-status" role="status">
            <h2>Preparando a consulta oficial</h2>
            <p>Verificando a eleição, as localidades e o mapeamento de países.</p>
          </div>
        )}
        {!navigation.error && metadata.isError && (
          <div className="app-status app-status-error" role="alert">
            <h2>{metadata.data ? 'Não foi possível atualizar as localidades' : 'Dados da eleição indisponíveis'}</h2>
            <p>{metadata.error.message}</p>
            <p>Não usamos resultados simulados ou de outra eleição como substituição.</p>
            <button
              className="app-action"
              disabled={metadata.isFetching}
              onClick={() => { void metadata.refetch() }}
            >
              Consultar novamente
            </button>
          </div>
        )}
        {metadata.data && navigation.selection && (
          <>
            <GeographyNavigation
              metadata={metadata.data}
              selection={navigation.selection}
              onSelect={navigation.navigate}
            />
            <ResultView
              metadata={metadata.data}
              selection={navigation.selection}
            />
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Painel independente, sem vínculo com a Justiça Eleitoral. Fonte dos resultados:{' '}
          <a href="https://resultados.tse.jus.br/oficial/app/index.html" target="_blank" rel="noreferrer">
            TSE (abre em nova aba)
          </a>. Uma vantagem parcial não é uma declaração de eleição.
        </p>
        <p>
          Países e territórios seguem a classificação publicada pelo{' '}
          <a href="https://www.tre-df.jus.br/eleicoes/mesas-receptoras-de-votos-no-exterior-2026" target="_blank" rel="noreferrer">
            TRE-DF (abre em nova aba)
          </a>, incluindo os rótulos de França e Guiana Francesa.
          O recorte identifica o local de votação, não a residência de cada eleitor.
        </p>
        <p>
          Fontes podem ser atualizadas em horários diferentes.
          Consulte o horário da fonte e a cobertura junto a cada resultado.
        </p>
      </footer>
    </div>
  )
}
