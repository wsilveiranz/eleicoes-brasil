# Brasil em votos — comparação dos turnos de 2026

Painel independente em português para comparar os resultados finais da eleição
presidencial de 2026. React, TypeScript e Vite, sem backend, banco de dados,
credenciais ou consultas periódicas ao TSE por visitante.

**Site:** https://wsilveiranz.github.io/eleicoes-brasil/

## Leitura da comparação

As mesmas localidades estão disponíveis nos dois turnos:

- **Total geral:** Brasil e exterior, conforme a totalização oficial.
- **Brasil:** soma dos 26 estados e DF, com detalhamento por UF e município.
- **Exterior:** total oficial ZZ, com detalhamento por país/território de votação.

Cada página mostra primeiro a comparação da localidade: votos válidos dos dois
turnos e sua variação, duas barras de participação percentual, barras de votos
absolutos em escala comum e tabela dos finalistas. Lula/PT usa vermelho;
Flávio Bolsonaro/PL, azul. Os demais candidatos aparecem apenas no bloco neutro
**Outros** da barra do primeiro turno, não como uma candidatura do segundo turno.

As barras percentuais usam **os votos válidos da própria localidade e do próprio
turno**. A linha de 50% é uma referência de participação, não progresso de apuração.
As barras absolutas compartilham a mesma escala entre os dois candidatos e turnos
na localidade selecionada.

A diferença de votos é `segundo turno − primeiro turno`. A diferença de participação
é expressa em **pontos percentuais**, calculados antes do arredondamento.
O crescimento relativo do total de votos válidos usa o primeiro turno como base.
Denominadores iguais a zero produzem `—`, não percentuais inventados.

**Mudanças agregadas não identificam como eleitores individuais mudaram seu voto.**
O painel não atribui os votos de Outros a nenhum finalista.
Brancos e nulos permanecem separados dos votos válidos.

Nas páginas Brasil/Exterior, cada estado/país mostra três linhas: total de votos
válidos, Lula e Flávio Bolsonaro, com votos, percentuais e variações visíveis
simultaneamente. Os filtros e a referência de ordenação afetam apenas a tabela,
nunca o resultado geral ou o endereço. A ordenação numérica usa inicialmente o
total válido e pode usar qualquer finalista sem ocultar as demais linhas.
Os nomes das localidades abrem os detalhes, incluindo os horários das fontes.

## Executar e verificar

Requer Node.js compatível com `engines.node` em `package.json` e npm. O navegador
deve oferecer WebCrypto em contexto seguro (HTTPS ou localhost).

```powershell
npm ci
npm run dev
```

```powershell
npm run typecheck
npm run lint
npm run test
npm run data:check
python scripts\generate-country-map.py --check
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

`build` inclui a checagem de tipos e gera `dist`. Os testes de navegador exercitam
o artefato de produção com os dados estáticos, incluindo alterações indevidas
em arquivos, navegação, filtros, cache por UF e disposição em telas pequenas.

## Dados estáticos e proveniência

Os dados publicados ficam em `public\data\2026\`. Um manifesto versionado descreve
o resumo e os arquivos municipais por UF, com tamanho e SHA-256. O navegador
valida os arquivos antes de apresentá-los; não usa fixtures ou resultados de outra
eleição como fallback.

O resumo reúne os dois turnos para os totais geral/Brasil/exterior e para todas
as UFs e países. Os resultados municipais são carregados apenas ao selecionar
um município: uma consulta obtém o arquivo de sua UF e o reutiliza para os demais
municípios daquele estado. Não há download de todos os resultados municipais na
entrada nem tempestade de consultas individuais por país.

O conjunto inicial contém 5.571 municípios brasileiros e 133 países/territórios
nos dois turnos. Manifesto e resumo somam aproximadamente **371 KB sem compressão**;
o maior arquivo municipal por UF tem aproximadamente **681 KB**. O conjunto
completo, incluindo a proveniência das 11.575 fontes assinadas, ocupa cerca de
**9,25 MB**, mas não é carregado inteiro na entrada.

O manifesto e a interface registram a data da importação. Cada resultado preserva
os horários da fonte, a cobertura e o status final de ambos os turnos.
**Final não significa imutável:** eventuais retificações oficiais exigem uma nova
importação revisada e publicação. O site não mistura automaticamente um retrato
estático com resultados ao vivo.

### Atualizar a captura

```powershell
npm run data:import
npm run data:check
```

A execução padrão retoma a mesma captura e reutiliza arquivos já verificados.
Para obter eventuais **retificações**, inicie uma captura com um nome novo:

```powershell
npm run data:import -- --capture correction-2026-11-01
```

Use o mesmo nome para retomar essa nova captura caso seja interrompida. Os nomes
são identificadores locais; não selecionam outra eleição nem alteram o escopo.
Revise os dados e execute as verificações antes de publicar a nova versão.

A importação consulta as fontes oficiais, verifica suas assinaturas e valida
eleição, turno, cargo, candidatos, localidade, contagens, finalização e cobertura.
Ela reutiliza capturas bem-sucedidas de um cache local para permitir retomada,
limita a concorrência e respeita falhas e intervalos solicitados pela fonte.
O cache de captura não integra o site publicado.

Antes de publicar, é necessário verificar todos os municípios/localidades e
reconciliar seus totais com UFs, exterior, países e total geral. Ausência de
dados não é zero. Uma importação incompleta não substitui o conjunto publicado.
Revise o manifesto, a proveniência e os relatórios de verificação junto com os
arquivos gerados. `data:check` e o CI validam os arquivos locais sem baixar
novamente os resultados oficiais.

### Fontes oficiais e confiança

Aplicativo oficial: https://resultados.tse.jus.br/oficial/app/index.html

Descoberta das eleições:
https://resultados.tse.jus.br/oficial/comum/config/ele-c.jws

Os identificadores verificados para presidente em 2026 são **6257**, primeiro
turno de 04/10, e **6258**, segundo turno de 25/10, ciclo `ele2026`, cargo `0001`.
Os arquivos oficiais são JWS assinados, não JSON que possa ser aceito apenas
decodificando base64.

`src\data\tse\trust.ts` fixa a chave pública Ed25519 revisada no aplicativo
oficial, build `26.10.17 (7216371)`. Essa chave **não é segredo**.
Chave/algoritmo desconhecido ou assinatura inválida bloqueiam a importação.
O build inspecionado não anuncia endereço público de rotação automática:
revise o aplicativo oficial antes de atualizar a chave; nunca aceite material
de confiança fornecido pelo próprio token.

Votos válidos usam `v.vv`, não `v.tv` nem um denominador recalculado para ocultar
divergências. Seções contabilizadas usam `s.st`, e a finalização usa o indicador
oficial `tf`, não apenas um percentual visual de 100%.
Os contratos e as capturas de testes anteriores continuam documentados em
`tests\fixtures\official-contract.json`; fixtures nunca são dados de produção.

## Mapeamento dos países

Fonte:
https://www.tre-df.jus.br/eleicoes/mesas-receptoras-de-votos-no-exterior-2026

O mapeamento em `src\data\geography\countries.json` deriva das planilhas oficiais
do TRE-DF, com proveniência por linha. A cobertura é conferida contra o inventário
dos dois turnos: 186 localidades em 133 países/territórios.

```powershell
python scripts\generate-country-map.py --check
```

O gerador usa apenas a biblioteca padrão do Python e verifica os hashes das
fontes preservadas em `tests\fixtures`. Não deduza países por nomes de cidades.
Os rótulos são os publicados pelo TRE-DF, não uma classificação ISO inferida:
Caiena aparece como Guiana Francesa e Saint Georges de Loyapock como França.
O recorte indica o **local de votação**, não residência ou cidadania do eleitor.

## Publicação

O workflow `.github\workflows\pages.yml` valida os dados, código e build, e publica
o conteúdo de `dist` no GitHub Pages a cada push em `main`. Não importa novamente
milhares de arquivos do TSE durante builds comuns.

O site é portátil para qualquer hospedagem estática HTTPS. `vite.config.ts`
usa `base: './'`; mantenha a estrutura dos arquivos e a barra final do diretório.
A navegação usa parâmetros de consulta e não requer rewrites:

```text
?visao=brasil
?visao=brasil&uf=sp&municipio=71072
?visao=exterior&pais=portugal
```

Verifique abertura direta, recarga, voltar/avançar e carregamento dos arquivos
de dados no subcaminho real antes de divulgar uma nova publicação.
