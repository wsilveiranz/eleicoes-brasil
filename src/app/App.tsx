import { useQuery } from '@tanstack/react-query'
import { loadDataset } from '../data/comparison'
import { useSelection } from '../hooks/useSelection'
import { GeographyNavigation } from './GeographyNavigation'
import { ResultView } from './ResultView'
import '../styles/app.css'

export default function App() {
  const navigation = useSelection()
  const dataset = useQuery({
    queryKey: ['comparison-dataset', '2026'],
    queryFn: ({ signal }) => loadDataset(signal),
    enabled: navigation.error === null,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
          <p className="app-kicker">Presidente da República · Primeiro e segundo turnos</p>
          <h1>Eleições 2026</h1>
          <p className="app-hero-subtitle">Do primeiro turno à decisão.</p>
          <p className="app-hero-description">
            Compare os votos de Lula e Bolsonaro entre os dois turnos, no Brasil e no exterior.
            Do total geral à sua cidade ou país de votação, com resultados oficiais do TSE.
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
        {!navigation.error && !dataset.data && dataset.isPending && (
          <div className="app-status" role="status">
            <h2>Preparando a comparação</h2>
            <p>Verificando os dados finais dos dois turnos e as localidades.</p>
          </div>
        )}
        {!navigation.error && dataset.isError && (
          <div className="app-status app-status-error" role="alert">
            <h2>Dados da eleição indisponíveis</h2>
            <p>{dataset.error.message}</p>
            <p>Não usamos resultados simulados ou de outra eleição como substituição.</p>
            <button
              className="app-action"
              disabled={dataset.isFetching}
              onClick={() => { void dataset.refetch() }}
            >
              Consultar novamente
            </button>
          </div>
        )}
        {dataset.data && navigation.selection && (
          <>
            <GeographyNavigation
              metadata={dataset.data.summary.metadata}
              selection={navigation.selection}
              onSelect={navigation.navigate}
            />
            <ResultView
              dataset={dataset.data}
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
          </a>. Comparações entre localidades e turnos não permitem identificar transferências individuais de votos.
        </p>
        <p>
          Países e territórios seguem a classificação publicada pelo{' '}
          <a href="https://www.tre-df.jus.br/eleicoes/mesas-receptoras-de-votos-no-exterior-2026" target="_blank" rel="noreferrer">
            TRE-DF (abre em nova aba)
          </a>, incluindo os rótulos de França e Guiana Francesa.
          O recorte identifica o local de votação, não a residência de cada eleitor.
        </p>
        <p>
          Retrato estático dos resultados finais, verificado na importação.
          Consulte as datas das fontes e a versão dos dados; eventuais correções oficiais exigem nova publicação.
        </p>
      </footer>
    </div>
  )
}
