# Eleições Brasil — Presidência 2026, segundo turno

Painel independente em português, estático, feito com Vite, React e TypeScript.
Consulta resultados oficiais do TSE diretamente no navegador; não é um serviço da Justiça Eleitoral.
Não usa backend, banco de dados, credenciais de API nem proxy de desenvolvimento.

## Executar e verificar

Requer Node.js compatível com `engines.node` do `package.json`: `^22.12.0 || >=24.0.0`, e npm.
O navegador precisa oferecer WebCrypto com Ed25519 (navegador moderno e contexto seguro: HTTPS ou localhost).

```powershell
npm ci
npm run dev
```

Abra o endereço informado pelo Vite. Comandos de qualidade e produção:

```powershell
npm run typecheck
npm run lint
npm run test
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

O Playwright precisa do runtime de navegador Chromium instalado pelo comando acima.
`build` inclui a checagem de tipos e gera `dist`; `preview` serve esse artefato localmente, não é um servidor de produção.
Esses comandos são instruções de execução, não uma declaração de que todas as verificações passaram.

## Escopos e leitura dos números

- **Total geral:** agregado oficial, incluindo Brasil e exterior.
- **Brasil:** soma completa das 27 UFs domésticas (26 estados e DF), excluindo ZZ; não subtrai o exterior do total geral. Permite selecionar UF e município.
- **Exterior:** agregado oficial ZZ; cada país soma suas localidades de votação mapeadas, sem duplicações.
- As páginas principais mostram primeiro o resultado geral, seguido de busca/filtros e tabela por estado/DF ou país, com avanço da apuração e votos/% local por candidatura. Os filtros alteram somente as linhas, sem modificar os totais gerais; os nomes abrem o detalhamento. Linhas indisponíveis ou desatualizadas são sinalizadas.
- Barras e tabela mostram candidato, partido, votos e percentual sobre **votos válidos do recorte selecionado** (`v.vv`). Brancos e nulos são separados, com percentual sobre **votos totais** (`v.tv`).
- Percentuais agregados são recalculados após somar contagens inteiras; denominador zero não significa 0%. Ausência de dados não é zero.
- Progresso usa seções totalizadas/total de seções (`s.st / s.ts`), não a média dos percentuais locais.

Não há previsões nem inferência de vencedor pela liderança; eventual indicação de eleito depende do status oficial.
Horários da fonte e da consulta são distintos. Agregados podem reunir horários diferentes, não uma fotografia atômica:
totais de pai e filhos consultados separadamente podem divergir durante a atualização.

## Fontes, assinatura e atualização

Referência pública: https://resultados.tse.jus.br/oficial/app/index.html
O cliente descobre e valida eleição, turno, cargo e geografia; não usa candidatos fixos nem troca silenciosamente de eleição.
Endpoints JWS observados para o segundo turno de 2026 (eleição `6258`, cargo `0001`):

```text
https://resultados.tse.jus.br/oficial/comum/config/ele-c.jws
https://resultados.tse.jus.br/oficial/ele2026/6258/config/mun-e006258-cm.jws
https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.jws
https://resultados.tse.jus.br/oficial/ele2026/6258/dados/zz/zz-c0001-e006258-u.jws
https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp-c0001-e006258-u.jws
https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp71072-c0001-e006258-u.jws
```

`src\data\tse\trust.ts` fixa a JWK pública Ed25519 revisada no aplicativo oficial, build `26.10.17 (7216371)`.
Essa chave **não é segredo**. O build oficial inspecionado não anuncia URL pública de rotação automática.
Chave desconhecida, algoritmo incorreto ou assinatura inválida bloqueiam o dado (fail closed); não basta decodificar base64.
Antes de atualizar o pin, verifique um novo build oficial por HTTPS e sua configuração de confiança; nunca aceite chaves fornecidas pelo próprio token.
O contrato e a proveniência das capturas estão em `tests\fixtures\official-contract.json`.
Fixtures de resultados são exclusivamente para testes: nunca são dados de produção nem fallback offline.

Com a página visível, a atualização ocorre a cada 30 segundos, sujeita a falhas e backoff.
As consultas são carregadas sob demanda por visão, com limite global de quatro requisições simultâneas.
Na visão geral do Exterior, a tabela consulta todas as 186 localidades para compor os 133 países/territórios, mantendo falhas isoladas por país. Brasil reutiliza as 27 UFs já consultadas, sem duplicar requisições para a tabela.
Falha ao atualizar preserva o último snapshot bem-sucedido **da mesma visão**, com aviso de dados desatualizados; não publica soma incompleta como completa.
O cache é em memória e por visitante, sem cache compartilhado nem garantia de capacidade em alto tráfego ou de cota do TSE.

## Mapeamento de países

Fonte: https://www.tre-df.jus.br/eleicoes/mesas-receptoras-de-votos-no-exterior-2026
Os ZIPs oficiais preservados em `tests\fixtures\tre-df-*-2026.zip` contêm planilhas País/Cidade de votação eletrônica, manual e seções dispensadas.
`tests\fixtures\tre-df-sources.json` registra URLs, coleta e SHA-256; o gerador valida esses hashes e os da configuração TSE capturada.
O arquivo gerado `src\data\geography\countries.json` registra proveniência por linha e cobre 186 códigos únicos, com 133 rótulos oficiais.

```powershell
python scripts\generate-country-map.py --check
python scripts\generate-country-map.py
```

Requer Python 3 (somente biblioteca padrão). `--check` compara sem atualizar; sem opção, regenera a partir das fontes locais, sem baixá-las.
Para atualizar fontes, obtenha novamente os ZIPs oficiais e metadados TSE verificados, revise proveniência/hashes e aliases explícitos, regenere e valide cobertura completa/única e testes antes de publicar.
Nunca deduza países por nomes de cidades nem omita códigos novos sem aviso.
São preservados os rótulos **País** publicados, não uma normalização ISO de soberania: Caiena aparece como **Guiana Francesa** na planilha eletrônica e Saint Georges de Loyapock como **França** na de seções dispensadas.
“País” indica o local de votação, não residência ou cidadania do eleitor.

## Publicação estática e limites

Hospedagem: GitHub Pages em https://wsilveiranz.github.io/eleicoes-brasil/ .
O workflow `.github/workflows/pages.yml` valida e publica o site a cada push em `main`, ou manualmente pela aba Actions.
Em Settings → Pages, a origem de publicação deve ser **GitHub Actions**. O deploy usa as permissões do workflow; não exige token pessoal nos arquivos do projeto.
Para hospedar em outro provedor:
Após as verificações, execute `npm run build` e publique **o conteúdo de `dist`** em GitHub Pages, Netlify ou qualquer hospedagem estática equivalente, sem runtime Node no destino.
`vite.config.ts` usa `base: './'`, permitindo raiz ou subdiretório; mantenha a estrutura dos arquivos e a URL de diretório com barra final.
A navegação usa parâmetros de consulta, portanto não exige regras de rewrite de rotas.
Sirva por HTTPS, com MIME correto para HTML, JavaScript e CSS; teste abertura direta, recarga e links com query na raiz/subcaminho escolhido.
Antes de liberar, confira fetch real e CORS **a partir da origem final**: sucesso local não garante permissão futura.
Disponibilidade, publicação, correções e políticas de acesso dos endpoints externos do TSE estão fora do controle deste painel.
Se o tráfego exigir cache compartilhado/proxy, isso requer nova decisão de arquitetura, não configuração secreta no frontend.
