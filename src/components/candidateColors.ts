import type { CandidateResult } from '../domain/results'

const partyColors: Readonly<Record<string, string>> = {
  PT: '#c41e3a',
  PL: '#155eab',
}
const fallbackColors = ['#355e85', '#865339', '#586c3e', '#79547e', '#316f70', '#85546a']

export function candidateColor(candidate: CandidateResult): string {
  const partyColor = partyColors[candidate.party.toUpperCase()]
  if (partyColor) return partyColor
  const hash = Array.from(candidate.number || candidate.id).reduce(
    (value, character) => (value * 33 + character.charCodeAt(0)) >>> 0,
    5381,
  )
  return fallbackColors[hash % fallbackColors.length]!
}
