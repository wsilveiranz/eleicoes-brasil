import { useId, useState } from 'react'
import type { ElectionMetadata } from '../domain/geography'
import { normalizeGeographySearch } from '../domain/geography'
import type { Selection } from '../domain/selection'
import '../styles/navigation.css'

export interface GeographyNavigationProps {
  metadata: ElectionMetadata
  selection: Selection
  onSelect: (selection: Selection) => void
}

interface SearchableSelectProps {
  label: string
  searchLabel: string
  placeholder: string
  options: { code: string; name: string }[]
  value: string
  onChange: (value: string) => void
}

function SearchableSelect({
  label,
  searchLabel,
  placeholder,
  options,
  value,
  onChange,
}: SearchableSelectProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const term = normalizeGeographySearch(query.trim())
  const visible = options.filter(
    (option) => option.code === value || normalizeGeographySearch(`${option.name} ${option.code}`).includes(term),
  )
  const matches = visible.filter((option) => normalizeGeographySearch(`${option.name} ${option.code}`).includes(term))
  return (
    <div className="geography-field">
      <label htmlFor={`${id}-search`}>{searchLabel}</label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-controls={`${id}-select`}
        aria-describedby={`${id}-status`}
        autoComplete="off"
      />
      <label htmlFor={`${id}-select`}>{label}</label>
      <select id={`${id}-select`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {value && !options.some((option) => option.code === value) && (
          <option value={value}>{value}</option>
        )}
        {visible.map((option) => (
          <option key={option.code} value={option.code}>{option.name}</option>
        ))}
      </select>
      <small id={`${id}-status`} role="status">
        {matches.length === 0 ? 'Nenhuma opção encontrada.' : `${matches.length} opções encontradas.`}
        {term && value && !matches.some((option) => option.code === value)
          ? ' A seleção atual foi mantida.'
          : ''}
      </small>
    </div>
  )
}

export function GeographyNavigation({ metadata, selection, onSelect }: GeographyNavigationProps) {
  const headingId = useId()
  const state = selection.scope === 'domestic'
    ? metadata.states.find((item) => item.code === selection.state)
    : undefined
  const municipality = selection.scope === 'domestic'
    ? state?.municipalities.find((item) => item.code === selection.municipality)
    : undefined
  const country = selection.scope === 'overseas'
    ? metadata.countries.find((item) => item.code === selection.country)
    : undefined
  const breadcrumbs: { label: string; selection: Selection }[] = [
    { label: 'Total geral', selection: { scope: 'overall' } },
  ]
  if (selection.scope === 'domestic') {
    breadcrumbs.push({ label: 'Brasil', selection: { scope: 'domestic' } })
    if (selection.state) {
      breadcrumbs.push({
        label: state?.name ?? selection.state,
        selection: { scope: 'domestic', state: selection.state },
      })
    }
    if (selection.municipality) {
      breadcrumbs.push({ label: municipality?.name ?? selection.municipality, selection })
    }
  } else if (selection.scope === 'overseas') {
    breadcrumbs.push({ label: 'Exterior', selection: { scope: 'overseas' } })
    if (selection.country) breadcrumbs.push({ label: country?.name ?? selection.country, selection })
  }

  return (
    <section className="geography-navigation" aria-labelledby={headingId}>
      <h2 id={headingId}>Navegar por localidade</h2>
      <nav className="geography-scopes" aria-label="Abrangência dos resultados">
        {([
          ['overall', 'Total geral'],
          ['domestic', 'Brasil'],
          ['overseas', 'Exterior'],
        ] as const).map(([scope, label]) => (
          <button
            type="button"
            key={scope}
            aria-current={selection.scope === scope ? 'true' : undefined}
            onClick={() => onSelect({ scope })}
          >
            {label}
          </button>
        ))}
      </nav>
      <nav className="geography-breadcrumbs" aria-label="Localidade atual">
        <ol>
          {breadcrumbs.map((item, index) => (
            <li key={index}>
              {index === breadcrumbs.length - 1
                ? <span aria-current="page">{item.label}</span>
                : <button type="button" onClick={() => onSelect(item.selection)}>{item.label}</button>}
            </li>
          ))}
        </ol>
      </nav>
    </section>
  )
}

export function MunicipalityNavigation({ metadata, selection, onSelect }: GeographyNavigationProps) {
  if (selection.scope !== 'domestic' || !selection.state) return null
  const state = metadata.states.find((item) => item.code === selection.state)
  if (!state) return null
  return (
    <section className="geography-navigation municipality-navigation" aria-label="Detalhar por município">
      <h2>Detalhar por município</h2>
      <div className="geography-selectors">
        <SearchableSelect
          key={state.code}
          label="Município"
          searchLabel="Buscar município"
          placeholder="Todos os municípios do estado"
          options={state.municipalities}
          value={selection.municipality ?? ''}
          onChange={(code) => onSelect({
            scope: 'domestic',
            state: state.code,
            ...(code ? { municipality: code } : {}),
          })}
        />
      </div>
    </section>
  )
}
