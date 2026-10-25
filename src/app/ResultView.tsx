import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ResultsPanel } from '../components'
import { GeographyOverviewTable } from '../components/GeographyOverviewTable'
import { loadSelectionResult } from '../data/results'
import { AwaitingPublicationError } from '../data/tse/client'
import { OfficialRequestError } from '../data/tse/http'
import type { ElectionMetadata } from '../domain/geography'
import { selectionId, type Selection } from '../domain/selection'
import { useLiveResult } from '../hooks/useLiveResult'
import { navigate } from '../hooks/useSelection'
import { MunicipalityNavigation } from './GeographyNavigation'

function description(selection: Selection) {
  if (selection.scope === 'overall') {
    return 'Votos no Brasil e no exterior, reunidos na totalização oficial.'
  }
  if (selection.scope === 'overseas') {
    return selection.country
      ? 'Soma de todas as localidades oficiais de votação neste país ou território.'
      : 'Votação presidencial fora do Brasil. Filtre a tabela e selecione o nome de um país para detalhar.'
  }
  return selection.state
    ? 'Resultado presidencial na localidade selecionada.'
    : 'Votação no território nacional: soma dos 26 estados e do Distrito Federal.'
}

export function ResultView({
  metadata,
  selection,
}: {
  metadata: ElectionMetadata
  selection: Selection
}) {
  const id = selectionId(selection)
  const client = useQueryClient()
  const key = useMemo(() => ['results', metadata.election.id, id], [metadata.election.id, id])
  const load = useCallback(
    (signal: AbortSignal) => loadSelectionResult(metadata, selection, signal),
    [metadata, selection],
  )
  const query = useLiveResult(key, load)
  const overviewScope = selection.scope === 'domestic' && !selection.state
    ? 'domestic' : selection.scope === 'overseas' && !selection.country ? 'overseas' : null
  const coolingDown =
    query.error instanceof OfficialRequestError &&
    query.error.retryAfterMs !== null &&
    Date.now() < query.errorUpdatedAt + query.error.retryAfterMs
  const unavailable =
    query.error instanceof AwaitingPublicationError ||
    (query.error instanceof OfficialRequestError && query.error.status === 404)
  const lastGood = query.data !== undefined && query.isError
  const heading = query.data?.geography.label ?? (
    selection.scope === 'overall' ? 'Total geral' :
      selection.scope === 'domestic' ? 'Brasil' : 'Exterior'
  )

  return (
    <section aria-label="Resultados da localidade" aria-busy={query.isFetching}>
      <div className="app-geography-heading">
        <h2>{heading}</h2>
        <p>{description(selection)}</p>
      </div>
      <div className="app-toolbar">
        <span className="app-live">
          <span className="app-live-dot" aria-hidden="true" />
          Consulta automática a cada 30 segundos com a aba visível
        </span>
        <button
          type="button"
          className="app-refresh"
          disabled={query.isFetching || coolingDown}
          onClick={() => {
            void query.refetch()
            if (overviewScope === 'overseas') {
              void client.invalidateQueries({
                predicate: (item) =>
                  item.queryKey[0] === 'results' &&
                  item.queryKey[1] === metadata.election.id &&
                  typeof item.queryKey[2] === 'string' &&
                  item.queryKey[2].startsWith('country:'),
                refetchType: 'active',
              }, { cancelRefetch: false })
            }
          }}
        >
          {query.isFetching ? 'Consultando o TSE…' : coolingDown ? 'Aguarde o TSE' : 'Atualizar agora'}
        </button>
      </div>

      {query.isPending && (
        <div className="app-status" role="status">
          <h2>{query.isPaused ? 'Consulta pausada' : 'Consultando resultados oficiais'}</h2>
          <p>
            {query.isPaused
              ? 'Aguardando conexão para consultar a fonte oficial.'
              : 'Os arquivos estão sendo verificados. Agregações só aparecem quando todas as localidades respondem.'}
          </p>
        </div>
      )}

      {query.isError && (
        <div className="app-status app-status-error" role="alert">
          <h2>
            {lastGood ? 'Atualização falhou · dados podem estar desatualizados' :
              unavailable ? 'Aguardando publicação oficial' : 'Resultados indisponíveis'}
          </h2>
          <p>{query.error.message}</p>
          <p>
            {lastGood
              ? 'Mantivemos a última consulta completa desta localidade. Os valores abaixo não foram substituídos por uma soma parcial.'
              : 'Nenhum total foi apresentado como zero ou completo. Tente atualizar ou selecione outra localidade.'}
          </p>
          {coolingDown && <p>A próxima consulta respeitará o intervalo solicitado pelo TSE.</p>}
        </div>
      )}

      {query.data && (
        <>
          <ResultsPanel snapshot={query.data} />
          {overviewScope && (
            <GeographyOverviewTable key={overviewScope} metadata={metadata} scope={overviewScope} snapshot={query.data} />
          )}
          <MunicipalityNavigation metadata={metadata} selection={selection} onSelect={navigate} />
        </>
      )}
      <p role="status" aria-live="polite" className="app-sr-only">
        {query.isFetching ? 'Consultando a fonte oficial.' :
          query.isError ? 'A consulta encontrou um erro.' :
            query.data ? 'Consulta completa. Resultados apresentados abaixo.' : ''}
      </p>
    </section>
  )
}
