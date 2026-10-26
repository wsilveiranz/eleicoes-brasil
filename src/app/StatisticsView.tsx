import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DatasetSummary } from '../domain/comparison'
import { regionalVotes } from '../domain/statistics'
import { regions } from '../domain/regions'
import { loadAgeData, loadParticipation, type AgeData, type AgeBand, type ParticipationData } from '../data/statistics'
import { candidateColor } from '../components/candidateColors'
import {
  difference, integer, ParticipationBar, percentage, PieChart, ratio, timeText,
} from '../components/StatisticsCharts'
import '../styles/statistics.css'

const ageColors = [
  '#1b4965', '#276749', '#7356a1', '#a66317', '#a53f62', '#126e82', '#57613a', '#864930',
  '#4460a0', '#8e466b', '#236c61', '#6a5980', '#85611d', '#596f89', '#65717c', '#954153',
  '#3a6372', '#78684b', '#43548b', '#6e8141', '#8c5f79', '#496664', '#866c60',
]
function publicationLabel(round: AgeData['first'], title: string) {
  return round.status === 'not-published'
    ? `${title}: dados de comparecimento por idade ainda não publicados.`
    : `${title}: cobertura etária incompleta; comparação ainda indisponível.`
}

function AgeStatistics({ data }: { data: AgeData }) {
  const first = data.first
  const second = data.second
  const bands = [...new Map([...first.bands, ...second.bands].map((band) => [band.code, band])).values()]
    .sort((a, b) => Number(a.code) - Number(b.code))
  const firstMap = new Map(first.bands.map((band) => [band.code, band]))
  const secondMap = new Map(second.bands.map((band) => [band.code, band]))
  const bandColors = new Map(bands.map((band, index) => [band.code, ageColors[index % ageColors.length]!]))
  const totals = {
    first: first.bands.reduce((sum, band) => sum + band.attended, 0),
    second: second.bands.reduce((sum, band) => sum + band.attended, 0),
  }
  const bandCells = (band: AgeBand | undefined, total: number) => (
    <>
      <td>{band ? integer.format(band.eligible) : '—'}</td>
      <td>{band ? integer.format(band.attended) : '—'}</td>
      <td>{band ? percentage(ratio(band.attended, band.eligible)) : '—'}</td>
      <td>{band ? percentage(ratio(band.attended, total)) : '—'}</td>
    </>
  )
  const stale = data.lastSuccessAt === null || Date.now() - Date.parse(data.lastSuccessAt) > 72 * 60 * 60_000
  return (
    <section className="statistics-card" aria-label="Comparecimento por faixa etária">
      <h3>Quem compareceu? Perfil por idade</h3>
      <p>Compare a presença de cada faixa etária nos dois turnos. Taxa de comparecimento usa os aptos da própria faixa;
        participação no comparecimento usa todos os que compareceram naquele turno. Brasil e exterior.</p>
      <p>Esta fonte tem data de geração e cadastro próprios; seus totais podem diferir dos arquivos de resultados usados nas barras acima.
        Os números de cada fonte são preservados, sem ajustes artificiais.</p>
      <p>Última tentativa: <time dateTime={data.checkedAt}>{timeText(data.checkedAt)}</time>.
        {' '}Última verificação bem-sucedida: {data.lastSuccessAt ? <time dateTime={data.lastSuccessAt}>{timeText(data.lastSuccessAt)}</time> : 'nenhuma'}.
        {' '}Verificação automática diária, sujeita à disponibilidade do TSE e do GitHub.</p>
      {data.refresh === 'error' && <p role="status" className="statistics-warning">{data.error} Os últimos dados válidos foram preservados; não são uma atualização bem-sucedida.</p>}
      {stale && <p role="status" className="statistics-warning">Verificação atrasada: não houve confirmação bem-sucedida da fonte nas últimas 72 horas.</p>}
      <div className="statistics-pair">
        {(['first', 'second'] as const).map((key) => {
          const round = data[key]
          const title = key === 'first' ? '1º turno' : '2º turno'
          return (
            <div key={key}>
              {round.status === 'available' ? (
                <PieChart title={`${title} · distribuição de quem compareceu por idade`} unit="comparecimentos" slices={round.bands.map((band) => ({
                  id: band.code, label: band.label, color: bandColors.get(band.code)!,
                  value: band.attended,
                }))} />
              ) : <p role="status" className="statistics-pending">{publicationLabel(round, title)}</p>}
              {round.sourceGeneratedAt && <p className="statistics-source-date">Fonte gerada em {timeText(round.sourceGeneratedAt)}.</p>}
            </div>
          )
        })}
      </div>
      {bands.length > 0 && (
        <div className="statistics-table-scroll statistics-age-table" role="region" aria-label="Tabela de comparecimento por idade" tabIndex={0}>
          <table className="statistics-table">
            <caption>Comparecimento por faixa etária e turno</caption>
            <thead>
              <tr><th rowSpan={2} scope="col">Faixa etária</th><th colSpan={4} scope="colgroup">1º turno</th><th colSpan={4} scope="colgroup">2º turno</th><th colSpan={3} scope="colgroup">Diferença · 2º − 1º</th></tr>
              <tr>{[1, 2].map((turn) => <Headers key={turn} />)}<th scope="col">Comparecimentos</th><th scope="col">Taxa (pp)</th><th scope="col">Participação (pp)</th></tr>
            </thead>
            <tbody>{bands.map((band) => {
              const a = firstMap.get(band.code)
              const b = secondMap.get(band.code)
              const aRate = a ? ratio(a.attended, a.eligible) : null
              const bRate = b ? ratio(b.attended, b.eligible) : null
              const aShare = a ? ratio(a.attended, totals.first) : null
              const bShare = b ? ratio(b.attended, totals.second) : null
              return (
                <tr key={band.code}>
                  <th scope="row"><span className="statistics-swatch" style={{ backgroundColor: bandColors.get(band.code) }} aria-hidden="true" />{band.label}</th>
                  {bandCells(a, totals.first)}{bandCells(b, totals.second)}
                  <td>{a && b ? difference(b.attended - a.attended) : '—'}</td>
                  <td>{difference(aRate === null || bRate === null ? null : bRate - aRate, ' pp')}</td>
                  <td>{difference(aShare === null || bShare === null ? null : bShare - aShare, ' pp')}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
      <p>Deslize a tabela horizontalmente para ver os dois turnos e as diferenças. As cores das faixas correspondem às pizzas.</p>
      <p className="statistics-warning">O voto é secreto. Participação por idade não revela votos em Lula ou Flávio, nem demonstra que uma faixa etária causou o resultado.
        Este painel permite examinar mudanças de comparecimento, não atribuir preferências individuais.</p>
    </section>
  )
}

function Headers() {
  return <><th scope="col">Aptos</th><th scope="col">Compareceram</th><th scope="col">Taxa</th><th scope="col">% dos presentes</th></>
}

function ParticipationStatistics({ data }: { data: ParticipationData }) {
  return (
    <>
      <section className="statistics-card" aria-label="Participação total nos dois turnos">
        <h3>Participação total · Brasil e exterior</h3>
        <p>Comparecimento inclui quem votou em branco ou nulo. Cada barra representa todos os eleitores aptos registrados na fonte daquele turno.</p>
        <ParticipationBar title="1º turno" value={data.first.overall} />
        <ParticipationBar title="2º turno" value={data.second.overall} />
      </section>
      <section className="statistics-card" aria-label="Participação por região brasileira">
        <h3>Participação por região brasileira</h3>
        <p>Soma das UFs de cada uma das cinco regiões; exterior excluído. Escala percentual comum de 0 a 100%.</p>
        {regions.map(({ id, name }) => (
          <section key={id} className="statistics-region" aria-label={`Participação: ${name}`}>
            <h4>{name}</h4>
            <ParticipationBar title="1º turno" value={data.first.regions[id]!} />
            <ParticipationBar title="2º turno" value={data.second.regions[id]!} />
          </section>
        ))}
      </section>
    </>
  )
}

export function StatisticsView({ summary }: { summary: DatasetSummary }) {
  const [round, setRound] = useState<'first' | 'second'>('second')
  const participation = useQuery({
    queryKey: ['participation', summary.version],
    queryFn: ({ signal }) => loadParticipation(summary.version, signal),
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
  })
  const ages = useQuery({
    queryKey: ['age-turnout', 2026],
    queryFn: ({ signal }) => loadAgeData(signal),
    staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false,
  })
  const candidateRegions = summary.finalists.map((candidate) => ({
    candidate, slices: regionalVotes(summary, round, candidate.id),
  }))
  return (
    <section className="statistics" aria-label="Participação e perfil eleitoral">
      <header className="app-geography-heading">
        <h2>Participação e perfil eleitoral</h2>
        <p>Quem compareceu, como a participação mudou e de onde vieram os votos dos finalistas.</p>
      </header>
      {participation.isPending && <p role="status">Carregando participação oficial…</p>}
      {participation.isError && <div role="alert" className="app-status app-status-error"><p>{participation.error.message}</p><button className="app-action" onClick={() => { void participation.refetch() }}>Tentar carregar participação novamente</button></div>}
      {participation.data && <ParticipationStatistics data={participation.data} />}
      <section className="statistics-card" aria-label="Distribuição regional dos votos por candidato">
        <h3>De onde vieram os votos de cada candidato?</h3>
        <p>Cada pizza divide os votos do próprio candidato entre as cinco regiões brasileiras.
          Não é a participação do candidato nos votos de cada região. Exterior excluído.</p>
        <label className="statistics-round-picker">Turno da distribuição regional
          <select value={round} onChange={(event) => setRound(event.target.value === 'first' ? 'first' : 'second')}>
            <option value="first">1º turno</option><option value="second">2º turno</option>
          </select>
        </label>
        <div className="statistics-pair">
          {candidateRegions.map(({ candidate, slices }) => (
            <div key={candidate.id} style={{ borderTop: `4px solid ${candidateColor(candidate)}` }}>
              <PieChart title={`${candidate.name} · ${candidate.party} · ${round === 'first' ? '1º' : '2º'} turno`} slices={slices} />
            </div>
          ))}
        </div>
        <div className="statistics-table-scroll" role="region" aria-label="Tabela de votos por região" tabIndex={0}>
          <table className="statistics-table">
            <caption>Origem regional dos votos · {round === 'first' ? '1º' : '2º'} turno</caption>
            <thead><tr><th scope="col">Região</th>{summary.finalists.map((candidate) => <th key={candidate.id} scope="col">{candidate.name} · votos (% do candidato)</th>)}</tr></thead>
            <tbody>{regions.map((region, index) => (
              <tr key={region.id}><th scope="row"><span className="statistics-swatch" style={{ backgroundColor: region.color }} aria-hidden="true" />{region.name}</th>
                {candidateRegions.map(({ candidate, slices }) => (
                  <td key={candidate.id}>{integer.format(slices[index]!.value)} ({percentage(ratio(slices[index]!.value, slices.reduce((sum, slice) => sum + slice.value, 0)))})</td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      {ages.isPending && <p role="status">Verificando o perfil etário publicado…</p>}
      {ages.isError && <div role="alert" className="app-status app-status-error"><p>{ages.error.message}</p><button className="app-action" onClick={() => { void ages.refetch() }}>Tentar carregar perfil etário novamente</button></div>}
      {ages.data && <AgeStatistics data={ages.data} />}
      <footer className="statistics-card statistics-sources">
        <details>
          <summary>Fontes, cobertura e metodologia das estatísticas</summary>
          <p>Participação: arquivos assinados do TSE da mesma captura dos resultados, versão {summary.version}.
            Comparecimento e abstenção usam os campos próprios da fonte, não votos válidos ou somas de candidaturas.</p>
          <p>Eleitores em seções não instaladas permanecem em “Sem informação de participação”, sem serem convertidos em abstenção.
            Percentuais das barras usam o total apto publicado, não um denominador recalculado.</p>
          <p>O <a href="https://dadosabertos.tse.jus.br/dataset/resultados-2026">TSE informa 39 registros duplicados por transferência temporária</a> no eleitorado apto dos arquivos de resultados.
            Preservamos as contagens da fonte e não distribuímos uma correção nacional arbitrariamente entre regiões.
            O perfil etário vem de outro sistema/data de geração e pode ter totais diferentes; não há ajuste artificial entre as fontes.</p>
          <p>Regiões: classificação IBGE, DF no Centro-Oeste. Norte, Nordeste, Centro-Oeste, Sudeste e Sul cobrem as 27 UFs sem sobreposição.</p>
          <p>Idade: <a href="https://dadosabertos.tse.jus.br/dataset/comparecimento-e-abstencao-2026">Comparecimento e Abstenção · TSE 2026</a>.
            Faixas oficiais preservadas, incluindo categorias desconhecidas quando presentes. Apenas contagens agregadas são publicadas neste site.</p>
          <p>A verificação diária só substitui dados após validação de ano, turnos, UFs e reconciliação.
            Falhas preservam o último conjunto válido, com aviso explícito. Uma comparação etária requer ambos os turnos com todas as UFs e exterior.</p>
          {ages.data?.sha256 && <p>SHA-256 do arquivo etário: <code>{ages.data.sha256}</code>.</p>}
        </details>
      </footer>
    </section>
  )
}
