import { useQuery } from '@tanstack/react-query'
import { ResultsPanel } from '../components'
import { GeographyOverviewTable } from '../components/GeographyOverviewTable'
import { ResultsProvenance } from '../components/ResultsPanel'
import { RunoffStateMap } from '../components/RunoffStateMap'
import { loadComparison, type LoadedDataset } from '../data/comparison'
import { selectionId, type Selection } from '../domain/selection'
import { navigate } from '../hooks/useSelection'
import { MunicipalityNavigation } from './GeographyNavigation'

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})

function description(selection: Selection) {
  if (selection.scope === 'overall') {
    return 'Comparação dos votos no Brasil e no exterior, reunidos na totalização oficial.'
  }
  if (selection.scope === 'overseas') {
    return selection.country
      ? 'Comparação da soma de todas as localidades oficiais de votação neste país ou território.'
      : 'Compare a votação fora do Brasil. Filtre a tabela e selecione um país para detalhar.'
  }
  return selection.state
    ? 'Primeiro e segundo turnos na localidade selecionada.'
    : 'Comparação no território nacional: soma dos 26 estados e do Distrito Federal.'
}

export function ResultView({
  dataset,
  selection,
}: {
  dataset: LoadedDataset
  selection: Selection
}) {
  const { summary, manifest } = dataset
  const metadata = summary.metadata
  const query = useQuery({
    queryKey: ['comparison', manifest.version, selectionId(selection)],
    queryFn: ({ signal }) => loadComparison(dataset, selection, signal),
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const overviewScope = selection.scope === 'domestic' && !selection.state
    ? 'domestic' : selection.scope === 'overseas' && !selection.country ? 'overseas' : null
  const heading = query.data?.geography.label ?? (
    selection.scope === 'overall' ? 'Total geral' :
      selection.scope === 'domestic' ? 'Brasil' : 'Exterior'
  )

  return (
    <section aria-label="Comparação da localidade" aria-busy={query.isFetching}>
      <div className="app-geography-heading">
        <h2>{heading}</h2>
        <p>{description(selection)}</p>
        <p className="app-dataset-note">
          Resultados finais dos dois turnos · Dados importados em{' '}
          <time dateTime={summary.generatedAt}>{dateFormat.format(new Date(summary.generatedAt))}</time>
          {' '}· Versão <code>{manifest.version}</code>
        </p>
      </div>
      {query.isPending && (
        <div className="app-status" role="status">
          <h2>{query.isPaused ? 'Carregamento pausado' : 'Carregando comparação'}</h2>
          <p>
            {query.isPaused
              ? 'Aguardando conexão para carregar os dados desta localidade.'
              : 'Verificando os dados finais dos dois turnos para esta localidade.'}
          </p>
        </div>
      )}
      {query.isError && (
        <div className="app-status app-status-error" role="alert">
          <h2>Comparação indisponível</h2>
          <p>{query.error.message}</p>
          <p>Dados ausentes não são apresentados como zero. Nenhuma soma parcial foi usada.</p>
          <button
            type="button"
            className="app-action"
            disabled={query.isFetching}
            onClick={() => { void query.refetch() }}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {query.data && !query.isError && (
        <>
          <ResultsPanel
            comparison={query.data}
            finalists={summary.finalists}
            elections={summary.elections}
          />
          {overviewScope === 'domestic' && (
            <RunoffStateMap
              metadata={metadata}
              comparisons={summary.comparisons}
              finalists={summary.finalists}
            />
          )}
          {overviewScope && (
            <GeographyOverviewTable
              key={`overview:${overviewScope}`}
              metadata={metadata}
              scope={overviewScope}
              comparisons={summary.comparisons}
              finalists={summary.finalists}
            />
          )}
          <MunicipalityNavigation metadata={metadata} selection={selection} onSelect={navigate} />
          <ResultsProvenance key={`provenance:${selectionId(selection)}`} comparison={query.data} />
        </>
      )}
    </section>
  )
}
